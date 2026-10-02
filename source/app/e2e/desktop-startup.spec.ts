import { test, expect } from '@playwright/test';
import { mockApiRoutes } from './fixtures.js';

for(const path of ['/','/hud.html']) {
  test(`native startup failure stays visible and can recover: ${path}`,async({page})=>{
    await mockApiRoutes(page,{agents:['codex']});
    await page.route('**/api/lotus/**',route=>{
      const path=new URL(route.request().url()).pathname;
      const json=path.endsWith('sources')?[{id:'openai',label:'OpenAI 官方',sessions:1}]
        :path.endsWith('today')?{tokens:11000,cacheHitRate:60}
        :{provider:'codex',status:{state:'ok'},freshness:'live',windows:[]};
      return route.fulfill({json});
    });
    await page.addInitScript(()=>{
      let attempts=0;
      const calls:string[]=[];
      Object.assign(window,{isTauri:true,__nativeCalls:calls,__TAURI_INTERNALS__:{
        transformCallback:()=>1,
        invoke:async(command:string,args?:{event?:string})=>{
          calls.push(command+(args?.event?`:${args.event}`:''));
          if(command==='service_address') {
            if(++attempts===1)throw new Error('测试：服务未启动');
            return {port:3458,token:'test-token'};
          }
          if(command==='layout_state')return {mode:'hud',scale:1};
          return 1;
        },
      },__TAURI_EVENT_PLUGIN_INTERNALS__:{unregisterListener:()=>{}}});
    });
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText('本地数据服务连接失败');
    await expect(page.getByRole('alert')).toContainText('测试：服务未启动');
    await page.getByRole('button',{name:'重试',exact:true}).click();
    if(path==='/')await expect(page.getByLabel('Codex 数据来源')).toBeVisible();
    else await expect(page.locator('.daily')).toContainText('11K');
    const calls=await page.evaluate(()=>(window as unknown as {__nativeCalls:string[]}).__nativeCalls);
    expect(calls.filter(call=>call==='service_address')).toHaveLength(2);
    expect(calls.filter(call=>call==='plugin:event|listen:lotus-source')).toHaveLength(1);
    expect(calls.filter(call=>call==='plugin:event|listen:lotus-refresh')).toHaveLength(1);
  });
}

test('quota failures show a disconnected state and refresh retries both data streams',async({page})=>{
  let requests=0;
  await page.route('**/api/lotus/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('sources'))await route.fulfill({json:[{id:'openai',label:'OpenAI 官方',sessions:1}]});
    else if(path.endsWith('today'))await route.fulfill({json:{tokens:11000,cacheHitRate:60}});
    else if(++requests===1)await route.fulfill({status:500,json:{error:'unavailable'}});
    else await route.fulfill({json:{status:{state:'ok'},freshness:'live',windows:[{durationMins:300,usedPercent:25},{durationMins:10080,usedPercent:40}]}});
  });
  await page.goto('/hud.html');
  await expect(page.locator('.live')).toContainText('未连接');
  await page.getByTitle('刷新统计').click();
  await expect(page.locator('.live')).toContainText('LIVE');
  await expect(page.locator('.quota-row').first()).toContainText('25%');
  await expect(page.locator('.quota-row').last()).toContainText('40%');
});
