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
  it('Windows release can settle even if the move-loop promise never resolves',async()=>{
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const command=vi.fn(async(name:string)=>{
      if(name==='begin_drag')return {revision:1,waitsForRelease:true};
      if(name==='finish_drag')await held;
      return {mode:'strip',scale:1,revision:1};
    });
    const {instance,displayed}=controller(command as never);
    const dragging=instance.drag(()=>new Promise(()=>{}));
    await vi.waitFor(()=>expect(command).toHaveBeenCalledWith('finish_drag',{revision:1}));
    instance.hover(true); // An enter that arrives before the native result.
    release();await dragging;
    await vi.waitFor(()=>expect(displayed()).toMatchObject({mode:'strip',expanded:true}));
  });
  it.each(['hud','strip'] as const)('native hover restores a %s drag without another DOM mouseenter',async(mode)=>{
    const command=vi.fn(async(name:string)=>name==='begin_drag'?{revision:2,waitsForRelease:true}:{mode:'strip',scale:1,revision:2});
    const {instance,displayed}=controller(command as never);
    instance.receive({mode,scale:1,revision:1});
    await instance.drag(async()=>{});
    expect(displayed()).toMatchObject({mode:'strip',expanded:false});
    instance.receiveHover(true,2);
    await vi.waitFor(()=>expect(displayed().expanded).toBe(true));
  });
  it('repeated outside signals do not postpone collapse indefinitely',async()=>{
    vi.useFakeTimers();
    const {instance,displayed}=controller();
    instance.hover(false);
    await vi.advanceTimersByTimeAsync(150);instance.hover(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(displayed().expanded).toBe(false);
  });
  it('a stale native hover cannot reopen a newer collapsed layout',async()=>{
    const {instance,displayed}=controller();
    instance.receive({mode:'strip',scale:1,revision:5});
    instance.receiveHover(true,4);
    expect(displayed().expanded).toBe(false);
  });
});
