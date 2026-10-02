import { test,expect } from '@playwright/test';

test('both native drag entry points can hover-expand without a new mouseenter',async({page})=>{
  await page.route('**/api/lotus/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const json=path.endsWith('sources')?[{id:'openai',label:'OpenAI',sessions:1}]
      :path.endsWith('today')?{tokens:11000,cacheHitRate:60}
      :{status:{state:'ok'},freshness:'live',windows:[]};
    return route.fulfill({json});
  });
  await page.addInitScript(()=>{
    let revision=0;let mode='hud';let scale=1;let next=1;
    const callbacks=new Map<number,(value:unknown)=>void>();
    const listeners=new Map<string,number>();
    let release=()=>{};let finishing=0;
    Object.assign(window,{isTauri:true,
      __testHover:(inside:boolean)=>callbacks.get(listeners.get('lotus-hover')!)?.({event:'lotus-hover',payload:{inside,revision}}),
      __testRelease:()=>release(),__testFinishing:()=>finishing,
      __TAURI_INTERNALS__:{
        metadata:{currentWindow:{label:'hud'},currentWebview:{label:'hud'}},
        transformCallback:(callback:(value:unknown)=>void)=>{const id=next++;callbacks.set(id,callback);return id;},
        invoke:async(command:string,args?:Record<string,unknown>)=>{
          if(command==='service_address')return {port:3458,token:'test'};
          if(command==='plugin:event|listen'){listeners.set(args!.event as string,args!.handler as number);return next++;}
          if(command==='layout_state')return {mode,scale,revision};
          if(command==='begin_drag')return {revision:++revision,waitsForRelease:true};
          if(command==='plugin:window|start_dragging')return new Promise(()=>{});
          if(command==='finish_drag'){finishing++;await new Promise<void>(resolve=>{release=resolve;});mode='strip';return {mode,scale,revision};}
          if(command==='set_layout'){mode=args!.mode as string;scale=args!.scale as number;return {mode,scale,revision:++revision};}
          return 1;
        },
      },__TAURI_EVENT_PLUGIN_INTERNALS__:{unregisterListener:()=>{}},
    });
  });
  await page.goto('/hud.html');
  await expect(page.locator('.daily')).toContainText('11K');
  for(let round=1;round<=2;round++) {
    await page.locator('.hud').dispatchEvent('pointerdown',{button:0,buttons:1,pointerId:1});
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {__testFinishing:()=>number}).__testFinishing())).toBe(round);
    await page.evaluate(()=>(window as unknown as {__testHover:(inside:boolean)=>void}).__testHover(false));
    await page.evaluate(()=>(window as unknown as {__testRelease:()=>void}).__testRelease());
    await expect(page.locator('.hud')).toHaveClass(/thin.*docked/);
    await page.evaluate(()=>(window as unknown as {__testHover:(inside:boolean)=>void}).__testHover(true));
    await expect(page.getByTitle('Restore floating HUD')).toBeVisible();
    await expect(page.locator('.hud')).not.toHaveClass(/thin/);
    await page.evaluate(()=>(window as unknown as {__testHover:(inside:boolean)=>void}).__testHover(false));
    await expect(page.locator('.hud')).toHaveClass(/thin/);
  }
});
