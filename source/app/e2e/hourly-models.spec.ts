import { test, expect, type Page } from '@playwright/test';
import { mockApiRoutes } from './fixtures.js';

test.use({ timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 1000 } });

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-10-14T21:30:00+08:00') });
  await page.addInitScript(() => {
    localStorage.setItem('lotus-language', 'en');
    localStorage.setItem('dashboard_timeRange', JSON.stringify('today'));
  });
  await mockApiRoutes(page, { agents: ['codex'] });
  const modelBreakdowns = [
    { modelName: 'gpt-6.1-sol', inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 700_000, cacheCreationTokens: 0, cost: 1.12 },
    { modelName: 'gpt-6-astra', inputTokens: 1_500_000, outputTokens: 200_000, cacheReadTokens: 900_000, cacheCreationTokens: 0, cost: 3.90 },
  ];
  const entry = {
    date: '2026-10-14', inputTokens: 2_500_000, outputTokens: 300_000,
    cacheReadTokens: 1_600_000, cacheCreationTokens: 0, totalTokens: 4_400_000,
    totalCost: 5.02, modelsUsed: modelBreakdowns.map(m => m.modelName), modelBreakdowns,
  };
  await page.route('**/api/daily?**', route => route.fulfill({ json: { daily: [entry], totals: entry } }));
  await page.route('**/api/blocks?**', route => route.fulfill({ json: { blocks: [{
    id: 'mixed', startTime: '2026-10-14T21:00:00', endTime: '2026-10-14T21:59:59',
    actualEndTime: null, isActive: false, isGap: false, entries: 2,
    tokenCounts: { inputTokens: 2_500_000, outputTokens: 300_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 1_600_000 },
    totalTokens: 4_400_000, costUSD: 5.02, models: entry.modelsUsed,
    modelBreakdowns: [
      { modelName: 'gpt-6.1-sol', totalTokens: 1_800_000, costUSD: 1.12 },
      { modelName: 'gpt-6-astra', totalTokens: 2_600_000, costUSD: 3.90 },
    ],
  }] } }));
  await page.goto('/');
  const panel = page.getByRole('heading', { name: 'Model trend', exact: true }).locator('../..');
  await expect(panel.locator('.recharts-bar')).toHaveCount(2);
  return panel;
}

for (const metric of ['tokens', 'usd'] as const) {
  test(`same-hour tooltip shows each model's actual ${metric}`, async ({ page }) => {
    const panel = await setup(page);
    if (metric === 'usd') await page.getByRole('button', { name: 'Cost', exact: true }).click();
    await page.clock.runFor(2_000);
    const rects = panel.locator('.recharts-bar-rectangle');
    const index = await rects.evaluateAll(elements => elements.findIndex(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 2 && bounds.height > 2;
    }));
    expect(index).toBeGreaterThanOrEqual(0);
    await rects.nth(index).hover();
    const tooltip = panel.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('21:00');
    await expect(tooltip.getByText('gpt-6.1-sol', { exact: true }).locator('..')).toContainText(metric === 'tokens' ? '1.8M' : '$1.12');
    await expect(tooltip.getByText('gpt-6-astra', { exact: true }).locator('..')).toContainText(metric === 'tokens' ? '2.6M' : '$3.90');
  });
}
