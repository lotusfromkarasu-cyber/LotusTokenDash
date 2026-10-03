import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import seed from '../data/openai-prices.json' with { type: 'json' };
import { OPENAI_PRICING_URL, PRICING_SYNC_INTERVAL_MS, parseOpenAIPrices, type PricingSnapshot } from '../shared/pricing.js';

function validate(value: unknown): PricingSnapshot {
  const data = value as PricingSnapshot;
  if (data?.schemaVersion !== 1 || data.source !== OPENAI_PRICING_URL || !Number.isFinite(Date.parse(data.fetchedAt))
    || (data.checkedAt !== null && !Number.isFinite(Date.parse(data.checkedAt)))
    || !(data.longContextThreshold > 0) || !data.models || Object.keys(data.models).length < 8 || !data.aliases) throw new Error('Invalid price snapshot');
  for (const price of Object.values(data.models)) {
    for (const [name, amount] of Object.entries(price)) {
      if (amount === null && name.includes('Cached') || amount === null && name === 'cachedInputPer1M') continue;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new Error('Invalid price amount');
    }
    if (typeof price.inputPer1M !== 'number' || typeof price.outputPer1M !== 'number'
      || !(price.cachedInputPer1M === null || typeof price.cachedInputPer1M === 'number')) throw new Error('Incomplete price');
  }
  return data;
}

/** One public HTTP request, with the same proxy support as the desktop network tools. */
async function download(url: string, init: RequestInit): Promise<Response> {
  let proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (!proxy && process.platform === 'win32') {
    try {
      const registry = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
      const read = (name: string) => execFileSync('reg.exe', ['query', registry, '/v', name], { encoding: 'utf8', windowsHide: true });
      if (/REG_DWORD\s+0x1/.test(read('ProxyEnable'))) {
        const value = read('ProxyServer').match(/REG_SZ\s+([^\r\n]+)/)?.[1].trim();
        const address = value?.includes('=') ? value.match(/(?:^|;)https=([^;]+)/)?.[1] : value;
        if (address) proxy = address.includes('://') ? address : `http://${address}`;
      }
    } catch { /* Use direct HTTPS when no system proxy is configured. */ }
  }
  if (!proxy) return fetch(url, init);
  const { ProxyAgent, fetch: proxyFetch } = await import('undici');
  const dispatcher = new ProxyAgent(proxy);
  try {
    const response = await proxyFetch(url, { ...init, dispatcher } as Parameters<typeof proxyFetch>[1]);
    // Consume before closing the dispatcher; a 304 intentionally has no body.
    return new Response(response.status === 304 ? null : await response.text(), { status: response.status, headers: Object.fromEntries(response.headers.entries()) });
  } finally { await dispatcher.close(); }
}

export class PricingStore {
  snapshot: PricingSnapshot;
  lastError: string | null = null;
  private pending?: Promise<PricingSnapshot>;
  constructor(private path?: string, private request: typeof download = download, private now = Date.now) {
    this.snapshot = structuredClone(validate(seed));
    if (path) {
      try { this.snapshot = validate(JSON.parse(readFileSync(path, 'utf8'))); } catch { /* Bundled official snapshot supports offline first launch. */ }
    }
  }
  get revision(): string {
    return createHash('sha256').update(JSON.stringify([this.snapshot.models, this.snapshot.aliases, this.snapshot.longContextThreshold])).digest('hex').slice(0, 16);
  }
  get nextCheckAt(): string { return new Date((Date.parse(this.snapshot.checkedAt ?? '') || 0) + PRICING_SYNC_INTERVAL_MS).toISOString(); }
  sync(): Promise<PricingSnapshot> {
    if (this.pending) return this.pending;
    if (this.snapshot.checkedAt && this.now() - Date.parse(this.snapshot.checkedAt) < PRICING_SYNC_INTERVAL_MS) return Promise.resolve(this.snapshot);
    this.pending = this.performSync().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async performSync(): Promise<PricingSnapshot> {
    try {
      const response = await this.request(OPENAI_PRICING_URL, { headers: { Accept: 'text/markdown', ...(this.snapshot.etag ? { 'If-None-Match': this.snapshot.etag } : {}) }, signal: AbortSignal.timeout(20_000) });
      const checkedAt = new Date(this.now()).toISOString();
      let next: PricingSnapshot;
      if (response.status === 304) next = { ...this.snapshot, checkedAt };
      else {
        if (!response.ok) throw new Error(`Official pricing HTTP ${response.status}`);
        const body = await response.text();
        if (body.length > 1_000_000) throw new Error('Unexpected pricing document size');
        const parsed = parseOpenAIPrices(body);
        next = { ...this.snapshot, ...parsed, fetchedAt: checkedAt, checkedAt, etag: response.headers.get('etag') ?? undefined };
      }
      validate(next);
      if (this.path) {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(`${this.path}.tmp`, JSON.stringify(next, null, 2), 'utf8');
        renameSync(`${this.path}.tmp`, this.path);
      }
      this.snapshot = next;
      this.lastError = null;
    } catch (error) { this.lastError = error instanceof Error ? error.message : String(error); }
    return this.snapshot;
  }
}

let store: PricingStore | undefined;
export function getPricingStore(): PricingStore {
  return store ??= new PricingStore(join(process.env.LOTUS_DATA_DIR ?? join(homedir(), '.lotus-token-dash'), 'openai-prices.json'));
}
export function getPricingRevision(): string { return getPricingStore().revision; }
export function getPricingStatus() {
  const store = getPricingStore();
  const { source, fetchedAt, checkedAt } = store.snapshot;
  return { source, fetchedAt, checkedAt, nextCheckAt: store.nextCheckAt, lastError: store.lastError, revision: store.revision };
}
export function setWorkerPricing(snapshot: PricingSnapshot): void { getPricingStore().snapshot = validate(snapshot); }
export function startPricingSync(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    const store = getPricingStore();
    await store.sync();
    if (stopped) return;
    // Schedule the actual next due time; a failed request retries the next day.
    const delay = store.lastError ? 24 * 60 * 60 * 1000 : Math.max(1000, Math.min(PRICING_SYNC_INTERVAL_MS, Date.parse(store.nextCheckAt) - Date.now()));
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  void run();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
