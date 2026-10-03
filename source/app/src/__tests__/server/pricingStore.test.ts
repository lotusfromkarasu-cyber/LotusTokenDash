import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PricingStore, getPricingStore, setWorkerPricing } from '../../server/pricingStore.js';
import { parseOpenAIPrices, PRICING_SYNC_INTERVAL_MS, resolvePricedModel } from '../../shared/pricing.js';
import { calculateCost, calculateCacheSavings, getModelPricing } from '../../server/codexPricing.js';
import { cache } from '../../server/cache.js';

const header = '| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |';
const separator = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
function markdown(input = 2) {
  const rows = Object.keys(new PricingStore().snapshot.models).map(id => `| ${id} | $${input} | $0.1 | - | $10 | $4 | $0.2 | - | $15 |`).join('\n');
  return `# Pricing\n### Standard pricing data\n${header}\n${separator}\n${rows}\n### Batch pricing data\n${header}\n${separator}\n| gpt-6.1-sol | $999 | $99 | - | $999 | - | - | - | - |\nShort context: ≤272K input tokens. Long context: >272K input tokens.`;
}
const tokens = { inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 1_000_000, reasoningOutputTokens: 100_000, totalTokens: 2_000_000 };

describe('Official price catalogue', () => {
  it('parses the Standard section and never overwrites with another service tier', () => {
    const prices = parseOpenAIPrices(markdown());
    expect(prices.models['gpt-6.1-sol'].inputPer1M).toBe(2);
    expect(prices.longContextThreshold).toBe(272_000);
    expect(() => parseOpenAIPrices('<html>unavailable</html>')).toThrow();
    expect(() => parseOpenAIPrices(markdown().replace('$2 |', 'invalid |'))).toThrow();
  });
  it('normalizes annotations and retains explicitly dated prices', () => {
    expect(parseOpenAIPrices(markdown().replace('| gpt-5.5 |', '| gpt-5.5 (<272K context length) |')).models['gpt-5.5']).toBeDefined();
    const snapshot = new PricingStore().snapshot;
    expect(resolvePricedModel('GPT-6.1-SOL-2026-09-01', snapshot)).toBe('gpt-6.1-sol');
    expect(resolvePricedModel('gpt-4o-2024-05-13', snapshot)).toBe('gpt-4o-2024-05-13');
  });
  it.each([
    ['gpt-6.1-sol', 11.05], ['gpt-6-astra', 55.5], ['gpt-6-sol', 11.1], ['gpt-6-luna', 0.555],
    ['gpt-5.6-sol', 22.2], ['gpt-5.6-terra', 13.1], ['gpt-5.6-luna', 1.31], ['gpt-5.5', 32.75],
  ])('prices %s at the verified current Standard rates', (id, expected) => {
    expect(calculateCost(tokens, new Set([id as string]))).toBeCloseTo(expected as number, 8);
  });
  it('prices long-context cache savings per model and exposes missing prices', () => {
    expect(calculateCacheSavings({ ...tokens, longContextCachedInputTokens: 200_000 }, 'gpt-6.1-sol')).toBeCloseTo(1.33, 8);
    expect(getModelPricing('not-an-openai-model')).toBeUndefined();
    expect(calculateCost(tokens, new Set(['not-an-openai-model']))).toBe(0);
  });
});

describe('Weekly background sync', () => {
  it('downloads once, coalesces calls, persists across restarts, and checks by ETag after exactly 7 days', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lotus-pricing-'));
    let now = Date.parse('2026-10-03T08:00:00Z');
    const request = vi.fn().mockResolvedValueOnce(new Response(markdown(), { headers: { etag: '"prices-1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    try {
      const path = join(root, 'prices.json');
      const store = new PricingStore(path, request, () => now);
      await Promise.all([store.sync(), store.sync()]);
      expect(request).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readFileSync(path, 'utf8')).etag).toBe('"prices-1"');
      const restarted = new PricingStore(path, request, () => now);
      now += PRICING_SYNC_INTERVAL_MS - 1;
      await restarted.sync(); expect(request).toHaveBeenCalledTimes(1);
      const revision = restarted.revision;
      now += 1;
      await restarted.sync(); expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1][1].headers['If-None-Match']).toBe('"prices-1"');
      expect(restarted.revision).toBe(revision);
      expect(Date.parse(restarted.snapshot.checkedAt!)).toBe(now);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('retains the previous price set when offline, malformed, or HTTP fails', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('broken Markdown'))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    const store = new PricingStore(undefined, request);
    const before = structuredClone(store.snapshot);
    for (let i = 0; i < 3; i++) { await store.sync(); expect(store.snapshot).toEqual(before); expect(store.lastError).toBeTruthy(); }
  });
  it('changes derived cache revisions and reprices history without changing token counts', () => {
    const store = getPricingStore(); const original = structuredClone(store.snapshot);
    try {
      cache.set('pricing-repro', { old: true });
      const cost = calculateCost(tokens, new Set(['gpt-6.1-sol']));
      setWorkerPricing({ ...original, models: { ...original.models, 'gpt-6.1-sol': { ...original.models['gpt-6.1-sol'], inputPer1M: 4 } } });
      expect(cache.get('pricing-repro')).toBeNull();
      expect(cache.getStale('pricing-repro')).toBeNull();
      expect(calculateCost(tokens, new Set(['gpt-6.1-sol'])) - cost).toBeCloseTo(1, 8);
      expect(tokens.inputTokens).toBe(1_000_000);
    } finally { setWorkerPricing(original); }
  });
});
