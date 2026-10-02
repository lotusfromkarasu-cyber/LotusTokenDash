import express from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './index.js';
import { currentProvider, providerScope } from './providerScope.js';
import { closeCodexWorker, getCodexResponse } from './codexResponseService.js';
import { quotaService } from './quota/index.js';
import type { QuotaProviderId } from './quota/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LOTUS_DATA_DIR ?? join(homedir(), '.lotus-token-dash');
mkdirSync(dataDir, { recursive: true });
process.env.LOTUS_DATA_DIR = dataDir;
process.env.TOKENDASH_SETTINGS_FILE = join(dataDir, 'settings.json');
process.env.TOKENDASH_USAGE_INDEX_DIR = join(dataDir, 'usage-index');
process.env.LOTUS_WORKER_FILE = join(here, 'worker.mjs');
const token = randomBytes(32).toString('hex');
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (/^(https?:\/\/(tauri\.localhost|localhost|127\.0\.0\.1)(:\d+)?)$/.test(origin) || origin === 'tauri://localhost')) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Lotus-Token, X-Lotus-Source');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  if (req.headers['x-lotus-token'] !== token) { res.status(401).json({ error: 'Local service authorization required' }); return; }
  const source = typeof req.headers['x-lotus-source'] === 'string' ? req.headers['x-lotus-source'] : 'openai';
  providerScope.run(source, next);
});
app.use(express.json({ limit: '16kb' }));
app.get('/api/lotus/sources', async (_req, res) => {
  try { res.json(await getCodexResponse('groups')); }
  catch (error) { res.status(500).json({ error: String(error) }); }
});
app.get('/api/lotus/today', async (_req, res) => {
  try {
    // Local day follows the computer's timezone, including DST.
    const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const response = await getCodexResponse('daily', { since: start, until: end });
    const totals = response.totals;
    const input = totals.inputTokens + totals.cacheReadTokens;
    res.json({ source: currentProvider(), tokens: totals.totalTokens, inputTokens: input, cachedTokens: totals.cacheReadTokens,
      cacheHitRate: input ? totals.cacheReadTokens / input * 100 : 0, fetchedAt: new Date().toISOString() });
  } catch (error) { res.status(500).json({ error: String(error) }); }
});
app.get('/api/lotus/codex-quota', async (_req, res) => {
  res.json(await quotaService.fetchOne('codex'));
});
app.put('/api/lotus/credentials', async (req, res) => {
  const provider = req.body?.provider as QuotaProviderId;
  if (!['glm', 'kimi', 'minimax'].includes(provider) || typeof req.body?.apiKey !== 'string') {
    res.status(400).json({ error: 'Invalid credential' }); return;
  }
  const credential = { apiKey: req.body.apiKey.trim(), baseUrl: req.body.baseUrl || undefined };
  if (credential.apiKey) {
    const result = await quotaService.validateCredential(provider, credential);
    if (!result.valid) { res.status(422).json(result); return; }
  }
  const path = join(dataDir, 'credentials.json');
  let entries: Record<string, unknown> = {};
  try { if (existsSync(path)) entries = JSON.parse(readFileSync(path, 'utf8')); } catch { /* Rebuild invalid settings. */ }
  if (credential.apiKey) entries[provider] = credential; else delete entries[provider];
  writeFileSync(path, JSON.stringify(entries), { mode: 0o600 });
  res.json({ saved: true });
});
app.use(createApp(0, join(here, '..')));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') process.stdout.write(JSON.stringify({ port: address.port, token }) + '\n');
});
function shutdown() { server.close(); closeCodexWorker(); process.exit(0); }
process.stdin.resume();
process.stdin.on('end', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
