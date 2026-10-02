import { test,expect } from '@playwright/test';
import { mockApiRoutes } from './fixtures.js';

test('analytics refresh interval applies immediately and manual mode persists',async({page})=>{
  await mockApiRoutes(page,{agents:['codex']});
  let requests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/daily')requests++;});
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByText('Total tokens',{exact:true}).first()).toBeVisible();
  await page.getByLabel('Refresh interval',{exact:true}).selectOption('30');
  const before=requests;
  await page.clock.runFor(30_100);
  await expect.poll(()=>requests).toBeGreaterThan(before);
  await expect(page.getByText('Total tokens',{exact:true}).first()).toBeVisible();
  await page.getByLabel('Refresh interval',{exact:true}).selectOption('0');
  const paused=requests;
  await page.clock.runFor(120_100);
  expect(requests).toBe(paused);
  await page.getByTitle('Refresh data · Manual',{exact:true}).click();
  await expect.poll(()=>requests).toBeGreaterThan(paused);
  await page.reload();
  await expect(page.getByLabel('Refresh interval',{exact:true})).toHaveValue('0');
});

test('HUD interval changes synchronize through storage and leave drag controls working',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('lotus-refresh-seconds','30'));
  let today=0,quota=0;
  await page.route('**/api/lotus/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const json=path.endsWith('sources')?[{id:'openai',label:'OpenAI',sessions:1}]
      :path.endsWith('today')?(today++,{tokens:11000,cacheHitRate:60})
      :(quota++,{status:{state:'ok'},freshness:'live',windows:[]});
    return route.fulfill({json});
  });
  await page.clock.install();await page.goto('/hud.html');
  await expect(page.locator('.daily')).toContainText('11K');
  await expect.poll(()=>quota).toBeGreaterThan(0);
  const first=[today,quota];
  await page.clock.runFor(30_100);
  await expect.poll(()=>today).toBeGreaterThan(first[0]);
  await expect.poll(()=>quota).toBeGreaterThan(first[1]);
  await page.evaluate(()=>{
    localStorage.setItem('lotus-refresh-seconds','0');
    window.dispatchEvent(new StorageEvent('storage',{key:'lotus-refresh-seconds',newValue:'0'}));
  });
  await expect(page.locator('.daily')).toContainText('11K');
  const paused=[today,quota];
  await page.clock.runFor(120_100);
  expect([today,quota]).toEqual(paused);
  await page.getByTitle('Refresh usage',{exact:true}).click();
  await expect.poll(()=>today).toBeGreaterThan(paused[0]);
  await expect.poll(()=>quota).toBeGreaterThan(paused[1]);
  await page.locator('.hud').hover();
  await page.getByTitle('Dock to top bar').click();
  await expect(page.locator('.hud')).toHaveClass(/thin/);
  await page.mouse.move(600,400);await page.locator('.hud').hover();
  await expect(page.getByTitle('Restore floating HUD')).toBeVisible();
});
