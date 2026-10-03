import { test, expect } from '@playwright/test';
import { mockApiRoutes } from './fixtures.js';
import prices from '../src/data/openai-prices.json' with { type: 'json' };

const ids = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'];
async function setup(page: import('@playwright/test').Page, unknown = false, language = 'en') {
  await page.addInitScript(lang => localStorage.setItem('lotus-language', lang), language);
  await mockApiRoutes(page, { agents: ['codex'] });
  await page.route('**/api/daily?**', route => {
    const models = [...ids, ...(unknown ? ['private-model'] : [])];
    const entry = { date: new Date().toISOString().slice(0, 10), inputTokens: 800, cacheReadTokens: 800, cacheCreationTokens: 0, outputTokens: 80, totalTokens: 1680, totalCost: 0.02, modelsUsed: models,
      modelBreakdowns: models.map(modelName => ({ modelName, inputTokens: 100, cacheReadTokens: 100, cacheCreationTokens: 0, outputTokens: 10, cost: 0.0025, pricing: prices.models[modelName as keyof typeof prices.models] ?? null, cacheSavingsUSD: 0.001 })) };
    return route.fulfill({ json: { daily: [entry], totals: entry, pricing: { source: prices.source, fetchedAt: prices.fetchedAt, checkedAt: prices.fetchedAt, nextCheckAt: '2026-10-10T08:00:00Z', lastError: null, revision: 'test' } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: language === 'en' ? 'Cost' : '费用', exact: true }).click();
  await page.getByRole('button', { name: language === 'en' ? 'Show model prices' : '查看模型定价' }).click();
  return page.getByRole('region', { name: language === 'en' ? 'Model prices' : '模型定价' });
}
test('all eight Codex model prices come from API data, with weekly current-price information', async ({ page }) => {
  const panel = await setup(page);
  for (const id of ids) await expect(panel.getByText(id, { exact: true })).toBeVisible();
  const sol = panel.getByText('gpt-6.1-sol', { exact: true }).locator('..');
  const astra = panel.getByText('gpt-6-astra', { exact: true }).locator('..');
  await expect(sol).toContainText('in $2'); await expect(sol).toContainText('ca $0.1'); await expect(sol).toContainText('out $10');
  await expect(astra).toContainText('in $10'); await expect(astra).toContainText('ca $1'); await expect(astra).toContainText('out $50');
  await expect(panel).toContainText('Automatic price sync every 7 days');
  await expect(panel).toContainText('Official and custom');
});
test('unknown models are clearly excluded instead of assigned a fallback price', async ({ page }) => {
  const panel = await setup(page, true);
  await expect(panel).toContainText('Price unavailable');
  await expect(page.getByText('Estimate excludes models without a published price')).toBeVisible();
});
test('pricing information is translated in Chinese', async ({ page }) => {
  const panel = await setup(page, false, 'zh');
  await expect(panel).toContainText('每 7 天自动同步价格');
  await expect(panel).toContainText('OpenAI 当前标准单价');
});
