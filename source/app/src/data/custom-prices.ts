import type { ModelPricing } from '../shared/pricing.js';

/**
 * Local price overrides for custom providers, applied on top of the official
 * catalogue at load and after every weekly sync, so they are never overwritten.
 *
 * - ecnu-max  -> DeepSeek-V4.1-Flash. Official list price (peak): cache hit
 *   $0.006 / cache miss $0.30 / output $1.20 per 1M; off-peak is half and the
 *   snapshot bills the conservative peak rate.
 * - ecnu-plus -> Qwen3.8-Flash-Next. Listed at $0.12 in / $0.01 cached /
 *   $0.40 out per 1M (verified 2026-10-12).
 */
export const CUSTOM_MODEL_PRICES: Record<string, ModelPricing> = {
  'deepseek-v4.1-flash': { inputPer1M: 0.30, cachedInputPer1M: 0.006, outputPer1M: 1.20 },
  'qwen3.8-flash-next': { inputPer1M: 0.12, cachedInputPer1M: 0.01, outputPer1M: 0.40 },
};

/** Custom model aliases resolved by `resolvePricedModel` after official IDs. */
export const CUSTOM_MODEL_ALIASES: Record<string, string> = {
  'ecnu-max': 'deepseek-v4.1-flash',
  'ecnu-plus': 'qwen3.8-flash-next',
};

/** Merge local price overrides and aliases into a snapshot (returns a new object). */
export function withCustomPricing<T extends { models: Record<string, ModelPricing>; aliases: Record<string, string> }>(snapshot: T): T {
  return {
    ...snapshot,
    models: { ...snapshot.models, ...CUSTOM_MODEL_PRICES },
    aliases: { ...snapshot.aliases, ...CUSTOM_MODEL_ALIASES },
  };
}
