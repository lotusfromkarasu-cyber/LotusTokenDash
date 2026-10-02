import { test, expect } from '@playwright/test';
import { mockApiRoutes, generateDailyResponse } from './fixtures.js';

test('switching provider changes requests and never reuses the previous provider totals',async({page})=>{
  await mockApiRoutes(page,{agents:['codex']});
  await page.route('**/api/daily**',async route=>{
    const source=route.request().headers()['x-lotus-source'];
    const response=generateDailyResponse('codex');
    const factor=source==='custom:proxy'?2:1;
    for(const row of response.daily) {row.totalTokens*=factor;row.inputTokens*=factor;row.outputTokens*=factor;row.cacheReadTokens*=factor;}
    response.totals.totalTokens*=factor;
    await route.fulfill({json:response});
  });
  await page.goto('/'); await expect(page.getByLabel('Codex 数据来源')).toBeVisible();
  const changed=page.waitForRequest(req=>req.url().includes('/api/daily')&&req.headers()['x-lotus-source']==='custom:proxy');
  await page.getByLabel('Codex 数据来源').selectOption('custom:proxy'); await changed;
  const back=page.waitForRequest(req=>req.url().includes('/api/daily')&&req.headers()['x-lotus-source']==='openai');
  await page.getByLabel('Codex 数据来源').selectOption('openai'); await back;
});
test('HUD keeps both quota windows, source-specific today stats and hover strip expansion',async({page})=>{
  await page.route('**/api/lotus/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const custom=route.request().headers()['x-lotus-source']==='custom:proxy';
    if(path.endsWith('sources')) await route.fulfill({json:[{id:'openai',label:'OpenAI 官方',sessions:1},{id:'custom:proxy',label:'proxy',sessions:1}]});
    else if(path.endsWith('today')) await route.fulfill({json:{tokens:custom?22000:11000,cacheHitRate:custom?20:60,fetchedAt:new Date().toISOString()}});
    else await route.fulfill({json:{provider:'codex',freshness:'live',status:{state:'ok'},windows:[{id:'five',durationMins:300,usedPercent:25},{id:'week',durationMins:10080,usedPercent:40}]}});
  });
  await page.goto('/hud.html');await expect(page.locator('.daily')).toContainText('11K'); await expect(page.locator('.daily')).toContainText('60.0%');
  await page.locator('.hud').hover(); await expect(page.getByLabel('统计来源')).toBeVisible();
  await page.getByLabel('统计来源').selectOption('custom:proxy'); await expect(page.locator('.daily')).toContainText('22K');await expect(page.locator('.daily')).toContainText('20.0%');
  await page.getByTitle('吸附顶部细条').click(); await expect(page.locator('.hud')).toHaveClass(/thin/);
  await expect(page.locator('.quota-row')).toHaveCount(2);
  await page.mouse.move(600,400);await page.locator('.hud').hover();await expect(page.getByLabel('统计来源')).toBeVisible();
  await page.screenshot({path:'../../build/hud-preview.png'});
});
