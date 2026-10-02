import { describe,it,expect,vi,afterEach } from 'vitest';
import { HudLayoutController, type HudLayout } from '../../hud/layout.js';

function controller(command=vi.fn(async()=>undefined)) {
  let displayed:HudLayout={mode:'hud',expanded:true,scale:1};
  const instance=new HudLayoutController(displayed,command,next=>{displayed=next;},error=>{throw error;});
  return {instance,command,displayed:()=>displayed};
}
afterEach(()=>vi.useRealTimers());
describe('HUD user interactions',()=>{
  it('a queued mouseleave cannot undo a redock after releasing the bar',async()=>{
    vi.useFakeTimers();
    const {instance,displayed,command}=controller();
    await instance.mode('strip');await instance.mode('hud');
    instance.hover(false);
    await instance.mode('strip');
    await vi.advanceTimersByTimeAsync(400);
    expect(displayed().mode).toBe('strip');
    expect(command.mock.calls.at(-1)).toEqual(['set_layout',{mode:'strip',expanded:false,scale:1}]);
  });
  it('late drag completion cannot undo an explicit dock click',async()=>{
    let release!:()=>void;
    const finishing=new Promise<void>(resolve=>{release=resolve;});
    const command=vi.fn(async(name:string)=>{
      if(name==='begin_drag')return 1;
      if(name==='finish_drag'){await finishing;return {mode:'hud',scale:1,revision:1};}
      return {mode:'strip',scale:1,revision:2};
    });
    const {instance,displayed}=controller(command as never);
    const dragging=instance.drag(async()=>{});
    await vi.waitFor(()=>expect(command).toHaveBeenCalledWith('finish_drag',{revision:1}));
    await instance.mode('strip');release();await dragging;
    expect(displayed().mode).toBe('strip');
  });
  it('out-of-order native hover responses cannot overwrite the latest mode',async()=>{
    let finish!:()=>void;
    const first=new Promise<void>(resolve=>{finish=resolve;});
    const command=vi.fn(async()=>{if(command.mock.calls.length===1){await first;return {mode:'hud',scale:1,revision:1};}return {mode:'strip',scale:1,revision:2};});
    const {instance,displayed}=controller(command as never);
    instance.hover(true); // Already expanded; use a scale request as an in-flight HUD resize.
    const older=instance.scale(.1);
    await vi.waitFor(()=>expect(command).toHaveBeenCalledTimes(1));
    const newer=instance.mode('strip');
    finish();await older;await newer;
    expect(displayed().mode).toBe('strip');
  });
  it('independent plus and minus steps stay within their bounds without wrapping',async()=>{
    const {instance,displayed}=controller();
    await instance.scale(.1);expect(displayed().scale).toBe(1.1);
    await instance.scale(-.1);expect(displayed().scale).toBe(1);
    for(let i=0;i<10;i++)await instance.scale(.1);
    expect(displayed().scale).toBe(1.5);
    for(let i=0;i<20;i++)await instance.scale(-.1);
    expect(displayed().scale).toBe(.75);
  });
});
