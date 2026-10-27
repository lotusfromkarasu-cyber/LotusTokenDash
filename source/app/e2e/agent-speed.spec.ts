import {test,expect} from '@playwright/test';
import {mockApiRoutes} from './fixtures.js';

const totals={requests:3,input:1200,cachedInput:800,output:500,total:1700};
const snapshot={state:'Running',timestamp:new Date().toISOString(),live:42,estimatedShare:.25,peak:88,average:36,
  today:totals,generating:1,tools:0,sources:[{name:'Codex',available:true,sessions:2,live:42,today:totals,agents:1}],
  agents:[{id:'one',source:'Codex',project:'LotusTokenDash',model:'gpt-6.1-terra',phase:'Generating',isSubagent:false,live:42,recentSpeed:36}],
  chart:[{time:new Date().toISOString(),measured:30,estimated:12}]};
const history={state:'Ready',progress:1,days:[{day:new Date().toISOString().slice(0,10),source:'Codex',totals,averageSpeed:36,peak:88,agents:1,
  models:[{model:'gpt-6.1-terra',requests:3,output:500,measuredOutput:360,measuredMs:10000,averageSpeed:36}]}]};

test('speed analysis and quota styling coexist with the existing usage view',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('lotus-language','en'));
  await mockApiRoutes(page,{agents:['codex']});
  await page.route('**/api/lotus/speed',route=>route.fulfill({json:{available:true,snapshot}}));
  await page.route('**/api/lotus/speed/history',route=>route.fulfill({json:{available:true,history}}));
  await page.route('**/api/quota',route=>route.fulfill({json:{providers:[{provider:'codex',displayName:'OpenAI Codex',status:{state:'ok'},windows:[
    {id:'five',label:'5-Hour',durationMins:300,usedPercent:25,resetsAt:new Date(Date.now()+3600000).toISOString()},
    {id:'week',label:'Weekly',durationMins:10080,usedPercent:40,resetsAt:new Date(Date.now()+86400000).toISOString()}]}]}}));
  await page.setViewportSize({width:1360,height:1000});
  await page.goto('/');
  await expect(page.getByText('Total tokens',{exact:true}).first()).toBeVisible();
  const tracks=page.locator('.lotus-quota-track');await expect(tracks).toHaveCount(2);
  expect(await tracks.nth(0).locator('i').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(175, 131, 105)');
  expect(await tracks.nth(1).locator('i').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(156, 77, 85)');
  await page.getByRole('button',{name:'Agent speed'}).click();
  await expect(page.getByText('Live output speed',{exact:true})).toBeVisible();
  await expect(page.locator('.speed-cards')).toContainText('42');
  await expect(page.locator('.speed-agents')).toContainText('gpt-6.1-terra');
  await expect(page.locator('.speed-history')).toContainText('36 tok/s');
  await page.screenshot({path:'../../build/v018-speed-preview.png',fullPage:true});
  await page.getByRole('button',{name:'Usage analytics'}).click();
  await expect(page.getByText('Total tokens',{exact:true}).first()).toBeVisible();
});

test('docked source menu stays open while the pointer leaves before selecting',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('lotus-language','en'));
  await page.route('**/api/lotus/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const custom=route.request().headers()['x-lotus-source']==='custom:custom';
    const json=path.endsWith('/speed')?{available:true,snapshot}
      :path.endsWith('/sources')?[{id:'openai',label:'OpenAI',sessions:1},{id:'custom:custom',label:'custom',sessions:1}]
      :path.endsWith('/today')?{tokens:custom?22000:11000,cacheHitRate:60}
      :{status:{state:'ok'},freshness:'live',windows:[]};
    return route.fulfill({json});
  });
  await page.setViewportSize({width:500,height:300});await page.goto('/hud.html');
  await expect(page.locator('.hud-speed')).toContainText('42');
  await page.locator('.hud').hover();await page.getByTitle('Dock to top bar').click();
  await page.mouse.move(450,250);await page.locator('.hud').hover();
  await page.getByLabel('Source',{exact:true}).click();
  await page.mouse.move(450,250);await page.waitForTimeout(500);
  await expect(page.locator('.hud')).not.toHaveClass(/thin/);
  await expect(page.getByRole('option',{name:'custom'})).toBeVisible();
  await page.screenshot({path:'../../build/v018-hud-preview.png'});
  await page.getByRole('option',{name:'custom'}).click();
  await expect(page.locator('.daily')).toContainText('22K');
  await page.getByLabel('Source',{exact:true}).click();
  await page.mouse.move(450,250);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.hud')).toHaveClass(/thin/);
});
