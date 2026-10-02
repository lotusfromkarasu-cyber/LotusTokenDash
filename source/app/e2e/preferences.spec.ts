import { test, expect, type Page } from '@playwright/test';
import { mockApiRoutes } from './fixtures.js';

async function hudData(page:Page,missing=false) {
  await page.route('**/api/lotus/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const json=path.endsWith('sources')?[{id:'openai',label:'OpenAI 官方',sessions:1}]
      :path.endsWith('today')?{tokens:11000,cacheHitRate:60}
      :{status:{state:'ok'},freshness:'live',windows:missing?[]:[{durationMins:300,usedPercent:25},{durationMins:10080,usedPercent:40}]};
    await route.fulfill({json});
  });
}

test('language changes filters, charts, details and settings without resetting data selection',async({page})=>{
  await mockApiRoutes(page,{agents:['codex']});
  await page.goto('/');
  await expect(page.getByText('Total tokens',{exact:true}).first()).toBeVisible();
  await page.getByLabel('Codex data source',{exact:true}).selectOption('custom:proxy');
  await page.getByRole('button',{name:'7D',exact:true}).click();
  await page.getByLabel('Language / 语言').selectOption('zh');
  await expect(page.getByRole('heading',{name:'使用分析',exact:true})).toBeVisible();
  await expect(page.getByLabel('Codex 数据来源',{exact:true})).toHaveValue('custom:proxy');
  await expect(page.getByRole('button',{name:'7 天',exact:true})).toHaveClass(/bg-stone-800/);
  await expect(page.getByRole('heading',{name:'模型用量趋势',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'会话',exact:true}).click();
  await expect(page.getByRole('heading',{name:'会话分析',exact:true})).toBeVisible();
  await page.locator('[data-od-id="session-detail-table"] tbody tr').first().click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText('会话概览',{exact:true})).toBeVisible();
  await expect(dialog.getByText('Review the dashboard’s session analytics detail and make the run history easier to inspect.',{exact:true}).last()).toBeVisible();
  await expect(dialog.getByRole('button',{name:'读取完整推理',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'配置 Codex 数据来源',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Codex 数据来源',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存路径',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.reload();
  await expect(page.getByLabel('Language / 语言')).toHaveValue('zh');
  await page.getByLabel('Language / 语言').selectOption('en');
  await expect(page.getByRole('heading',{name:'Usage analytics',exact:true})).toBeVisible();
  await expect(page.getByLabel('Codex data source',{exact:true})).toHaveValue('custom:proxy');
});

test('HUD toggles used and remaining percentages and remembers the choice',async({page})=>{
  await hudData(page);
  await page.goto('/hud.html');
  await expect(page.locator('.quota-row').first()).toContainText('25%');
  await expect(page.locator('.quota-row').last()).toContainText('40%');
  await page.getByTitle('Show remaining quota').click();
  await expect(page.locator('.quota-row').first()).toContainText('75%');
  await expect(page.locator('.quota-row').last()).toContainText('60%');
  await expect(page.locator('.track i').first()).toHaveAttribute('style','width: 75%;');
  await expect(page.locator('.daily')).toContainText('11K');
  await expect(page.locator('.daily')).toContainText('60.0%');
  await page.reload();
  await expect(page.getByTitle('Show used quota')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.quota-row').first()).toContainText('75%');
  await page.getByTitle('Show used quota').click();
  await expect(page.locator('.quota-row').first()).toContainText('25%');
});

test('remaining mode keeps missing quota unknown',async({page})=>{
  await hudData(page,true);
  await page.goto('/hud.html');
  await page.getByTitle('Show remaining quota').click();
  await expect(page.locator('.quota-row b')).toHaveText(['—','—']);
});

test('HUD provider arrow moves left and independent size buttons preserve scale',async({page})=>{
  await hudData(page);
  await page.goto('/hud.html');
  await page.locator('.hud').hover();
  await expect(page.getByTitle('Increase HUD size')).toBeVisible();
  const hud=await page.locator('.hud').boundingBox();
  const arrow=await page.locator('.source-picker>span').boundingBox();
  expect(arrow!.x).toBeLessThan(hud!.x+hud!.width-120);
  await page.getByTitle('Increase HUD size').click();
  await expect.poll(async()=> (await page.locator('.hud').boundingBox())!.width).toBeCloseTo(356.4,1);
  await page.getByTitle('Decrease HUD size').click();
  await expect.poll(async()=> (await page.locator('.hud').boundingBox())!.width).toBeCloseTo(324,1);
  await page.reload();
  await expect.poll(async()=> (await page.locator('.hud').boundingBox())!.width).toBeCloseTo(324,1);
});

test('restoring and redocking remains docked after the previous hover timeout',async({page})=>{
  await hudData(page);
  await page.goto('/hud.html');
  for(let cycle=0;cycle<3;cycle++) {
    await page.locator('.hud').hover();
    await page.getByTitle('Dock to top bar').click();
    await page.mouse.move(600,400);
    await page.locator('.hud').hover();
    await page.getByTitle('Restore floating HUD').click();
    await page.mouse.move(600,400);
    await page.locator('.hud').hover();
    await page.getByTitle('Dock to top bar').click();
    await page.mouse.move(600,400);
    await expect(page.locator('.hud')).toHaveClass(/docked/);
    await expect(page.locator('.hud')).toHaveClass(/thin/);
    await page.waitForTimeout(400);
    await expect(page.locator('.hud')).toHaveClass(/thin.*docked/);
    await page.locator('.hud').hover();
    await page.getByTitle('Restore floating HUD').click();
  }
});
