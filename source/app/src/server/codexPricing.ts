import { getPricingStore } from './pricingStore.js';
import { resolvePricedModel, type ModelPricing } from '../shared/pricing.js';

interface TokenCounts {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  longContextInputTokens?: number;
  longContextCachedInputTokens?: number;
  longContextOutputTokens?: number;
}

/** Normalize names against the price catalogue, including exact dated prices. */
export function normalizeCodexModelName(model: string): string {
  return resolvePricedModel(model, getPricingStore().snapshot);
}

export function isLongContextCodexRequest(inputTokens: number): boolean {
  return inputTokens > getPricingStore().snapshot.longContextThreshold;
}

/**
 * Calculate cost in USD from token counts and model pricing.
 * Long-context fields must be populated while aggregating individual requests;
 * they cannot be recovered from a summed input token total afterwards.
 */
export function calculateCost(tokens: TokenCounts, models: Set<string>): number {
  const model = normalizeCodexModelName([...models][0] ?? '');
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  const longInput = Math.min(tokens.longContextInputTokens ?? 0, tokens.inputTokens);
  const longCached = Math.min(tokens.longContextCachedInputTokens ?? 0, tokens.cachedInputTokens, longInput);
  const longOutput = Math.min(tokens.longContextOutputTokens ?? 0, tokens.outputTokens);

  const shortInput = Math.max(tokens.inputTokens - longInput, 0);
  const shortCached = Math.min(Math.max(tokens.cachedInputTokens - longCached, 0), shortInput);
  const shortOutput = Math.max(tokens.outputTokens - longOutput, 0);

  const shortNonCachedInput = Math.max(shortInput - shortCached, 0);
  const longNonCachedInput = Math.max(longInput - longCached, 0);

  const longInputRate = pricing.longContextInputPer1M ?? pricing.inputPer1M;
  const longCachedRate = pricing.longContextCachedInputPer1M ?? pricing.cachedInputPer1M ?? pricing.longContextInputPer1M ?? pricing.inputPer1M;
  const longOutputRate = pricing.longContextOutputPer1M ?? pricing.outputPer1M;

  const inputCost = (shortNonCachedInput / 1_000_000) * pricing.inputPer1M;
  const cachedCost = (shortCached / 1_000_000) * (pricing.cachedInputPer1M ?? pricing.inputPer1M);
  const outputCost = (shortOutput / 1_000_000) * pricing.outputPer1M;
  const longInputCost = (longNonCachedInput / 1_000_000) * longInputRate;
  const longCachedCost = (longCached / 1_000_000) * longCachedRate;
  const longOutputCost = (longOutput / 1_000_000) * longOutputRate;

  return inputCost + cachedCost + outputCost + longInputCost + longCachedCost + longOutputCost;
}

export function getModelPricing(model: string): ModelPricing | undefined {
  return getPricingStore().snapshot.models[normalizeCodexModelName(model)];
}

export function calculateCacheSavings(tokens: TokenCounts, model: string): number {
  const price = getModelPricing(model);
  if (!price) return 0;
  const long = Math.min(tokens.longContextCachedInputTokens ?? 0, tokens.cachedInputTokens);
  const short = tokens.cachedInputTokens - long;
  const longInput = price.longContextInputPer1M ?? price.inputPer1M;
  return (short * (price.inputPer1M - (price.cachedInputPer1M ?? price.inputPer1M))
    + long * (longInput - (price.longContextCachedInputPer1M ?? price.cachedInputPer1M ?? longInput))) / 1_000_000;
}
