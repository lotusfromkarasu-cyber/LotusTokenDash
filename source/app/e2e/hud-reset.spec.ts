import { test, expect, type Page } from '@playwright/test';

const fiveReset='2026-10-02T18:30:00Z';
const weekReset='2026-10-06T16:05:00Z';
async function mockHud(page:Page,windows:()=>unknown[]) {
  await page.route('**/api/lotus/**',route=>{
    const path=new URL(route.request().url()).pathname;
    return route.fulfill({json:path.endsWith('sources')?[{id:'openai',label:'OpenAI',sessions:1}]
      :path.endsWith('today')?{tokens:11000,cacheHitRate:60}
      :{status:{state:'ok'},freshness:'live',windows:windows()}});
  });
}
async function expectFits(page:Page) {
  expect(await page.locator('.hud').evaluate(node=>{
    const bounds=node.getBoundingClientRect();
    return [...node.querySelectorAll('.quota-row,.quota-switch')].every(row=>{
      const box=row.getBoundingClientRect();
      const children=[...row.children].map(child=>child.getBoundingClientRect());
      return box.right<=bounds.right&&box.bottom<=bounds.bottom
        &&children.every(child=>child.left>=box.left&&child.right<=box.right+.1)
        &&children.every((child,index)=>index===0||child.left>=children[index-1].right-.1);
    });
  })).toBe(true);
}

for(const config of [
  {language:'zh',zone:'Asia/Shanghai',expected:['10/03 02:30','10/07 00:05'],toggle:'显示剩余额度',dock:'吸附顶部细条'},
  {language:'en',zone:'America/Los_Angeles',expected:['10/02 11:30','10/06 09:05'],toggle:'Show remaining quota',dock:'Dock to top bar'},
]) {
  test.describe(`${config.language} reset times`,()=>{
    test.use({timezoneId:config.zone});
    test('both windows show local dates in HUD and strip without overlaps at all scales',async({page})=>{
      await page.addInitScript(language=>localStorage.setItem('lotus-language',language),config.language);
      await mockHud(page,()=>[
        {durationMins:300,usedPercent:25,resetsAt:fiveReset},
        {durationMins:10080,usedPercent:40,resetsAt:weekReset},
      ]);
      await page.goto('/hud.html');
      await expect(page.locator('.reset-time time')).toHaveText(config.expected);
      await expect(page.locator('.reset-time time').first()).toHaveAttribute('datetime',fiveReset.replace('Z','.000Z'));
      await page.getByTitle(config.toggle,{exact:true}).click();
      await expect(page.locator('.quota-row b')).toHaveText(['75%','60%']);
      await expect(page.locator('.reset-time time')).toHaveText(config.expected);
      for(const scale of [.75,1,1.5]) {
        await page.locator('.hud').evaluate((node,value)=>(node as HTMLElement).style.setProperty('--scale',String(value)),scale);
        await expectFits(page);
      }
      await page.locator('.hud').screenshot({path:`../../build/reset-hud-${config.language}.png`});
      await page.locator('.hud').hover();
      await page.getByTitle(config.dock,{exact:true}).click();
      await page.mouse.move(600,400);
      await expect(page.locator('.hud')).toHaveClass(/thin/);
      await expect(page.locator('.reset-time time')).toHaveText(config.expected);
      for(const scale of [.75,1,1.5]) {
        await page.locator('.hud').evaluate((node,value)=>(node as HTMLElement).style.setProperty('--scale',String(value)),scale);
        await expectFits(page);
        expect((await page.locator('.hud').boundingBox())!.height).toBeCloseTo(20*scale,1);
      }
      await page.locator('.hud').screenshot({path:`../../build/reset-bar-${config.language}.png`});
    });
  });
}

test('missing and malformed reset dates stay unknown; refresh updates both timestamps',async({page})=>{
  let dates:(string|undefined)[]=[undefined,'invalid'];
  await mockHud(page,()=>[
    {durationMins:300,usedPercent:25,resetsAt:dates[0]},
    {durationMins:10080,usedPercent:40,resetsAt:dates[1]},
  ]);
  await page.goto('/hud.html');
  await expect(page.locator('.quota-row b')).toHaveText(['25%','40%']);
  await expect(page.locator('.reset-time>span:last-child')).toHaveText(['—','—']);
  for(const index of [0,1])await expect(page.locator('.reset-time').nth(index)).toHaveAttribute('title','Reset time unavailable');
  dates=[fiveReset,weekReset];
  await page.getByTitle('Refresh usage',{exact:true}).click();
  await expect(page.locator('.reset-time time')).toHaveCount(2);
  await expect(page.locator('.reset-time time').last()).toHaveAttribute('datetime',weekReset.replace('Z','.000Z'));
  await expect(page.locator('.bars')).not.toContainText('Invalid Date');
});
