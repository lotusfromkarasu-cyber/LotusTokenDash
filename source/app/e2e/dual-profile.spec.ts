import { test, expect } from '@playwright/test';
import { mockApiRoutes } from './fixtures.js';

test('analysis updates its provider list when a second Codex profile becomes available', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('lotus-language', 'en'); localStorage.setItem('lotus-refresh-seconds', '30'); });
  await mockApiRoutes(page, { agents: ['codex'] });
  let secondProfile = false;
  await page.route('**/api/lotus/sources', route => route.fulfill({ json: [
    { id: 'openai', label: 'OpenAI', sessions: 1 },
    ...(secondProfile ? [{ id: 'custom:custom', label: 'custom', sessions: 2 }] : []),
  ] }));
  await page.clock.install();
  await page.goto('/');
  const select = page.getByLabel('Codex data source', { exact: true });
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveCount(1);
  secondProfile = true;
  await page.clock.runFor(30_100);
  await expect(select.locator('option[value="custom:custom"]')).toHaveCount(1);
  const customRequest = page.waitForRequest(request => request.url().includes('/api/daily') && request.headers()['x-lotus-source'] === 'custom:custom');
  await select.selectOption('custom:custom');
  await customRequest;
});

test('HUD discovers a second profile and shows its independently scoped usage', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('lotus-language', 'en'); localStorage.setItem('lotus-refresh-seconds', '30'); });
  let secondProfile = false;
  await page.route('**/api/lotus/**', route => {
    const path = new URL(route.request().url()).pathname;
    const custom = route.request().headers()['x-lotus-source'] === 'custom:custom';
    const data = path.endsWith('sources') ? [{ id: 'openai', label: 'OpenAI', sessions: 1 }, ...(secondProfile ? [{ id: 'custom:custom', label: 'custom', sessions: 2 }] : [])]
      : path.endsWith('today') ? { tokens: custom ? 33_000 : 11_000, cacheHitRate: custom ? 90 : 60 }
      : { status: { state: 'ok' }, freshness: 'live', windows: [] };
    return route.fulfill({ json: data });
  });
  await page.clock.install();
  await page.goto('/hud.html');
  await expect(page.locator('.daily')).toContainText('11K');
  secondProfile = true;
  await page.clock.runFor(30_100);
  await page.locator('.hud').hover();
  const select = page.getByLabel('Source', { exact: true });
  await expect(select.locator('option[value="custom:custom"]')).toHaveCount(1);
  await select.selectOption('custom:custom');
  await expect(page.locator('.daily')).toContainText('33K');
  await expect(page.locator('.daily')).toContainText('90.0%');
});
