export interface ModelPricing {
  inputPer1M: number;
  cachedInputPer1M: number | null;
  outputPer1M: number;
  longContextInputPer1M?: number;
  longContextCachedInputPer1M?: number | null;
  longContextOutputPer1M?: number;
}

export interface PricingSnapshot {
  schemaVersion: 1;
  source: string;
  fetchedAt: string;
  checkedAt: string | null;
  etag?: string;
  longContextThreshold: number;
  models: Record<string, ModelPricing>;
  aliases: Record<string, string>;
}

export const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing.md';
export const PRICING_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Only the Standard text-token table; Batch/Flex/Fast must never overwrite it. */
export function parseOpenAIPrices(markdown: string): Pick<PricingSnapshot, 'models' | 'longContextThreshold'> {
  const section = markdown.match(/^### Standard pricing data\s*\n([\s\S]*?)(?=^### |$(?![\s\S]))/m)?.[1];
  if (!section) throw new Error('Official Standard pricing table not found');
  const lines = section.split('\n').filter(line => line.trim().startsWith('|'));
  const cells = (line: string) => line.trim().slice(1, -1).split('|').map(cell => cell.trim());
  const headings = cells(lines[0] ?? '');
  const column = (name: string) => {
    const index = headings.indexOf(name);
    if (index < 0) throw new Error(`Official pricing column missing: ${name}`);
    return index;
  };
  const modelColumn = column('Model');
  const input = column('Short context input'), cached = column('Short context cached input'), output = column('Short context output');
  const longInput = column('Long context input'), longCached = column('Long context cached input'), longOutput = column('Long context output');
  const amount = (cell: string): number | null => {
    if (cell === '-') return null;
    if (!/^\$\d+(?:\.\d+)?$/.test(cell)) throw new Error(`Invalid official price: ${cell}`);
    return Number(cell.slice(1));
  };
  const models: Record<string, ModelPricing> = {};
  for (const line of lines.slice(2)) {
    const row = cells(line);
    const model = row[modelColumn]?.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
    if (!model || !/^[a-z0-9][a-z0-9.-]*$/.test(model) || row.length !== headings.length || models[model]) throw new Error('Invalid or duplicate official model row');
    const i = amount(row[input]), o = amount(row[output]), c = amount(row[cached]);
    if (i === null || o === null) throw new Error(`Missing text pricing for ${model}`);
    const li = amount(row[longInput]), lo = amount(row[longOutput]), lc = amount(row[longCached]);
    if ((li === null) !== (lo === null)) throw new Error(`Incomplete long-context prices for ${model}`);
    models[model] = { inputPer1M: i, cachedInputPer1M: c, outputPer1M: o,
      ...(li !== null && lo !== null ? { longContextInputPer1M: li, longContextCachedInputPer1M: lc, longContextOutputPer1M: lo } : {}) };
  }
  const threshold = markdown.match(/Short context:\s*≤([\d.]+)K input tokens/);
  if (!threshold || Object.keys(models).length < 8) throw new Error('Incomplete official pricing document');
  return { models, longContextThreshold: Number(threshold[1]) * 1000 };
}

/** Preserve explicitly priced dated models, then resolve undated log aliases. */
export function resolvePricedModel(model: string, snapshot: PricingSnapshot): string {
  const exact = model.trim().toLowerCase();
  if (snapshot.models[exact]) return exact;
  const stripped = exact.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '');
  return snapshot.aliases[stripped] ?? stripped;
}
