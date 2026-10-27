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
  const cells = (line: string) => line.trim().slice(1, -1).split('|').map(cell => cell.trim());
  const amount = (cell: string): number | null => {
    if (cell === '-') return null;
    if (!/^\$\d+(?:\.\d+)?$/.test(cell)) throw new Error(`Invalid official price: ${cell}`);
    return Number(cell.slice(1));
  };
  const models: Record<string, ModelPricing> = {};
  const lines = section.split(/\r?\n/);
  for (let pos=0;pos<lines.length;pos++) {
    if (!/^\|\s*Model\s*\|/.test(lines[pos].trim())) continue;
    const headings = cells(lines[pos]);
    const column = (name:string) => {
      const index=headings.indexOf(name);
      if(index<0)throw new Error(`Official pricing column missing: ${name}`);
      return index;
    };
    const extended=headings.includes('Short context input');
    const modelColumn=column('Model');
    const input=column(extended?'Short context input':'Input');
    const cached=column(extended?'Short context cached input':'Cached input');
    const output=column(extended?'Short context output':'Output');
    const longInput=extended?column('Long context input'):-1;
    const longCached=extended?column('Long context cached input'):-1;
    const longOutput=extended?column('Long context output'):-1;
    if (!/^\|\s*-/.test(lines[pos+1]?.trim()??'')) throw new Error('Invalid official pricing table');
    pos+=2;
    for (;pos<lines.length && lines[pos].trim().startsWith('|');pos++) {
      const row=cells(lines[pos]);
      const model=row[modelColumn]?.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
      if (!model || !/^[a-z0-9][a-z0-9.-]*$/.test(model) || row.length !== headings.length || models[model]) throw new Error('Invalid or duplicate official model row');
      const i=amount(row[input]),o=amount(row[output]),c=amount(row[cached]);
      if(i===null||o===null)throw new Error(`Missing text pricing for ${model}`);
      const li=extended?amount(row[longInput]):null,lo=extended?amount(row[longOutput]):null,lc=extended?amount(row[longCached]):null;
      if((li===null)!==(lo===null))throw new Error(`Incomplete long-context prices for ${model}`);
      models[model]={inputPer1M:i,cachedInputPer1M:c,outputPer1M:o,
        ...(li!==null&&lo!==null?{longContextInputPer1M:li,longContextCachedInputPer1M:lc,longContextOutputPer1M:lo}:{})};
    }
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
