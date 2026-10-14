import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeCodexWorker, getCodexBlocksResponse, getCodexDailyResponse, resolveCodexWorkerPath } from '../../server/codexResponseService.js';
import { cache } from '../../server/cache.js';
import { clearUsageFileIndexMemory } from '../../server/usageFileIndex.js';
import { getPricingStore, setWorkerPricing } from '../../server/pricingStore.js';
import { updateCodexCustomDataPaths } from '../../server/appSettings.js';
import { validateBlocks } from '../../shared/schemas.js';

const tempDirs: string[] = [];
const originalCodexHome = process.env.CODEX_HOME;
const originalSettingsFile = process.env.TOKENDASH_SETTINGS_FILE;
const originalIndexDir = process.env.TOKENDASH_USAGE_INDEX_DIR;
const originalDisableWorker = process.env.TOKENDASH_DISABLE_CODEX_WORKER;

function tokenCount(timestamp: string, totalTokens: number): unknown {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: totalTokens - 10,
          cached_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 0,
          total_tokens: totalTokens,
        },
      },
    },
  };
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'tokendash-codex-worker-'));
  const settingsDir = mkdtempSync(join(tmpdir(), 'tokendash-codex-worker-settings-'));
  const indexDir = mkdtempSync(join(tmpdir(), 'tokendash-codex-worker-index-'));
  tempDirs.push(root, settingsDir, indexDir);
  process.env.CODEX_HOME = root;
  process.env.TOKENDASH_SETTINGS_FILE = join(settingsDir, 'settings.json');
  process.env.TOKENDASH_USAGE_INDEX_DIR = indexDir;
  delete process.env.TOKENDASH_DISABLE_CODEX_WORKER;

  const sessionDir = join(root, 'sessions', '2026', '09', '02');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'rollout-worker.jsonl'), [
    {
      type: 'session_meta',
      payload: {
        id: 'worker-session',
        cwd: '/tmp/project-a',
        timestamp: '2026-09-02T00:00:00.000Z',
      },
    },
    { type: 'turn_context', payload: { model: 'gpt-5.5' } },
    tokenCount('2026-09-02T00:00:01.000Z', 100),
    tokenCount('2026-09-02T00:00:02.000Z', 175),
  ].map(line => JSON.stringify(line)).join('\n'));
});

afterEach(() => {
  closeCodexWorker();
  cache.clear();
  clearUsageFileIndexMemory();
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  if (originalSettingsFile === undefined) delete process.env.TOKENDASH_SETTINGS_FILE;
  else process.env.TOKENDASH_SETTINGS_FILE = originalSettingsFile;
  if (originalIndexDir === undefined) delete process.env.TOKENDASH_USAGE_INDEX_DIR;
  else process.env.TOKENDASH_USAGE_INDEX_DIR = originalIndexDir;
  if (originalDisableWorker === undefined) delete process.env.TOKENDASH_DISABLE_CODEX_WORKER;
  else process.env.TOKENDASH_DISABLE_CODEX_WORKER = originalDisableWorker;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('codex response worker', () => {
  it.each([
    {},
    { timezone: 'UTC' },
    { project: 'project-a', granularity: '5m' as const },
  ])('preserves per-model usage and prices through block validation: %j', async options => {
    const sessionDir = join(process.env.CODEX_HOME!, 'sessions', '2026', '09', '02');
    for (const [file, model, tokens] of [
      ['rollout-worker.jsonl', 'gpt-6.1-sol', 5_000],
      ['rollout-astra.jsonl', 'gpt-6-astra', 2_000],
    ] as const) {
      writeFileSync(join(sessionDir, file), [
        { type: 'session_meta', payload: { id: model, cwd: '/tmp/project-a', timestamp: '2026-09-02T00:00:00Z' } },
        { type: 'turn_context', payload: { model } },
        tokenCount('2026-09-02T00:01:00Z', tokens),
      ].map(line => JSON.stringify(line)).join('\n'));
    }

    const response = validateBlocks(await getCodexBlocksResponse(options));
    expect(response.blocks).toHaveLength(1);
    const block = response.blocks[0];
    expect(Object.fromEntries(block.modelBreakdowns.map(b => [b.modelName, b.totalTokens]))).toEqual({
      'gpt-6.1-sol': 5_000, 'gpt-6-astra': 2_000,
    });
    const prices = getPricingStore().snapshot.models;
    const expectedSol = (4_990 * prices['gpt-6.1-sol'].inputPer1M + 10 * prices['gpt-6.1-sol'].outputPer1M) / 1_000_000;
    const expectedAstra = (1_990 * prices['gpt-6-astra'].inputPer1M + 10 * prices['gpt-6-astra'].outputPer1M) / 1_000_000;
    expect(block.modelBreakdowns.find(b => b.modelName === 'gpt-6.1-sol')!.costUSD).toBeCloseTo(expectedSol, 12);
    expect(block.modelBreakdowns.find(b => b.modelName === 'gpt-6-astra')!.costUSD).toBeCloseTo(expectedAstra, 12);
    expect(expectedSol).not.toBeCloseTo(expectedAstra, 6);
    expect(block.totalTokens).toBe(7_000);
    expect(block.costUSD).toBeCloseTo(expectedSol + expectedAstra, 12);
  });

  it('adds a second home to an already cached default bundle without restarting the service', async () => {
    const first = await getCodexDailyResponse();
    const secondHome = join(process.env.CODEX_HOME!, 'second-profile');
    mkdirSync(join(secondHome, 'sessions'), { recursive: true });
    writeFileSync(join(secondHome, 'sessions', 'rollout-b.jsonl'), [
      { type: 'session_meta', payload: { id: 'b-session', cwd: '/tmp/project-b', model_provider: 'custom', timestamp: '2026-09-02T00:00:00Z' } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      tokenCount('2026-09-02T00:01:00Z', 400),
    ].map(line => JSON.stringify(line)).join('\n'));
    updateCodexCustomDataPaths([secondHome]);
    const second = await getCodexDailyResponse();
    expect(second.totals.totalTokens).toBe(first.totals.totalTokens + 400);
    expect(second.daily[0].modelBreakdowns.find(model => model.modelName === 'gpt-6.1-sol')?.cost).toBeGreaterThan(0);
    updateCodexCustomDataPaths([]);
    expect((await getCodexDailyResponse()).totals.totalTokens).toBe(first.totals.totalTokens);
  });
  it('reprices a cached default bundle when the catalogue changes', async () => {
    const original = structuredClone(getPricingStore().snapshot);
    try {
      const first = await getCodexDailyResponse();
      setWorkerPricing({ ...original, models: { ...original.models, 'gpt-5.5': { ...original.models['gpt-5.5'], inputPer1M: 10 } } });
      const second = await getCodexDailyResponse();
      expect(second.totals.totalTokens).toBe(first.totals.totalTokens);
      expect(second.totals.totalCost - first.totals.totalCost).toBeCloseTo(165 * 5 / 1_000_000, 8);
    } finally { setWorkerPricing(original); }
  });
  it('computes Codex usage through the non-blocking response service', async () => {
    const daily = await getCodexDailyResponse({ timezone: 'UTC' });

    expect(daily.daily).toHaveLength(1);
    expect(daily.daily[0]).toMatchObject({
      date: '2026-09-02',
      inputTokens: 165,
      outputTokens: 10,
      totalTokens: 175,
    });
  });

  it('resolves the sidecar worker next to the compiled bundled daemon', () => {
    const location = join(tmpdir(), 'tokendash', 'dist');
    const worker = resolveCodexWorkerPath(pathToFileURL(join(location, 'daemon.cjs')).href);

    expect(dirname(worker)).toBe(join(location, 'server'));
    expect(worker.endsWith('codexResponseWorker.js')).toBe(true);
  });

  it('keeps fine-grained block requests off the hourly bundle cache', async () => {
    // An event at 08:07 Shanghai time lands in different buckets per
    // granularity (hour -> 08:00, 5m -> 08:05), so a shared cache key or a
    // bundle hit would surface the wrong startTime here.
    const sessionDir = join(process.env.CODEX_HOME!, 'sessions', '2026', '09', '02');
    writeFileSync(join(sessionDir, 'rollout-granularity.jsonl'), [
      {
        type: 'session_meta',
        payload: { id: 'granularity-session', cwd: '/tmp/project-b', timestamp: '2026-09-02T00:00:00.000Z' },
      },
      { type: 'turn_context', payload: { model: 'gpt-5.5' } },
      tokenCount('2026-09-02T00:07:31.000Z', 300),
    ].map(line => JSON.stringify(line)).join('\n'));

    const hourly = await getCodexBlocksResponse();
    const hourly0800 = hourly.blocks.find(b => b.startTime === '2026-09-02T08:00:00');
    expect(hourly0800?.totalTokens).toBe(475, 'hourly: 175 (shared fixture) + 300 merged into 08:00');

    const fine = await getCodexBlocksResponse({ granularity: '5m' });
    const fine0805 = fine.blocks.find(b => b.startTime === '2026-09-02T08:05:00');
    expect(fine0805?.totalTokens).toBe(300, '5m: the 08:07 event lands alone in the 08:05 bucket');
    const fine0800 = fine.blocks.find(b => b.startTime === '2026-09-02T08:00:00');
    expect(fine0800?.totalTokens).toBe(175, '5m: the shared fixture stays in its own 08:00 bucket');
  });
});
