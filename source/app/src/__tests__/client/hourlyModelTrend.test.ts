import { describe, expect, it } from 'vitest';
import { buildHourlyModelTrend } from '../../client/utils/hourlyModelTrend.js';
import type { BlockEntry } from '../../shared/types.js';

const now = new Date('2026-10-14T21:30:00');
function block(overrides: Partial<BlockEntry> = {}): BlockEntry {
  return {
    id: 'mixed-hour', startTime: '2026-10-14T21:00:00', endTime: '2026-10-14T21:59:59',
    actualEndTime: null, isActive: false, isGap: false, entries: 2,
    tokenCounts: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    totalTokens: 4_400_000, costUSD: 5.02, models: ['gpt-6.1-sol', 'gpt-6-astra'],
    modelBreakdowns: [
      { modelName: 'gpt-6.1-sol', totalTokens: 1_800_000, costUSD: 1.12 },
      { modelName: 'gpt-6-astra', totalTokens: 2_600_000, costUSD: 3.90 },
    ],
    ...overrides,
  };
}

describe('hourly model attribution', () => {
  it('keeps unequal real usage and fees for models in the same hour', () => {
    const input = block();
    const tokens = buildHourlyModelTrend([input], 'tokens', now)[21];
    const costs = buildHourlyModelTrend([input], 'usd', now)[21];
    expect(tokens).toEqual({ hour: '21:00', 'gpt-6.1-sol': 1_800_000, 'gpt-6-astra': 2_600_000 });
    expect(costs).toEqual({ hour: '21:00', 'gpt-6.1-sol': 1.12, 'gpt-6-astra': 3.90 });
    expect(Number(tokens['gpt-6.1-sol']) + Number(tokens['gpt-6-astra'])).toBe(input.totalTokens);
    expect(Number(costs['gpt-6.1-sol']) + Number(costs['gpt-6-astra'])).toBeCloseTo(input.costUSD, 12);
  });

  it('adds the same model across multiple blocks without reallocating its fees', () => {
    const extra = block({
      models: ['gpt-6.1-sol'], totalTokens: 200_000, costUSD: 0.23,
      modelBreakdowns: [{ modelName: 'gpt-6.1-sol', totalTokens: 200_000, costUSD: 0.23 }],
    });
    expect(buildHourlyModelTrend([block(), extra], 'tokens', now)[21]['gpt-6.1-sol']).toBe(2_000_000);
    expect(buildHourlyModelTrend([block(), extra], 'usd', now)[21]['gpt-6.1-sol']).toBeCloseTo(1.35, 12);
  });

  it('does not invent per-model shares for older multi-model responses', () => {
    const legacy = block({ modelBreakdowns: undefined });
    expect(buildHourlyModelTrend([legacy], 'tokens', now)[21]).toEqual({ hour: '21:00', Other: 4_400_000 });
    expect(buildHourlyModelTrend([legacy], 'usd', now)[21]).toEqual({ hour: '21:00', Other: 5.02 });
  });

  it('can attribute an older single-model response exactly', () => {
    const legacy = block({ models: ['gpt-6.1-sol'], modelBreakdowns: [] });
    expect(buildHourlyModelTrend([legacy], 'tokens', now)[21]['gpt-6.1-sol']).toBe(4_400_000);
  });

  it('excludes other days, gaps and future hours while preserving empty hours', () => {
    const buckets = buildHourlyModelTrend([
      block({ startTime: '2026-10-13T21:00:00' }),
      block({ isGap: true }),
      block({ startTime: '2026-10-14T22:00:00' }),
    ], 'tokens', now);
    expect(buckets).toHaveLength(22);
    expect(buckets[21]).toEqual({ hour: '21:00' });
  });
});
