export type HudMode='hud'|'strip';
export type HudLayout={mode:HudMode;expanded:boolean;scale:number};
type NativeLayout={mode:HudMode;scale:number;revision?:number};
type DragTicket={revision:number;waitsForRelease:boolean};
type Command=(name:string,args?:Record<string,unknown>)=>Promise<unknown>;
export const clampScale=(value:number)=>Number.isFinite(value)?Math.max(.75,Math.min(1.5,value)):1;

/** One owner for drag, hover and explicit layout changes. */
export class HudLayoutController {
  private queue:Promise<void>=Promise.resolve();
  private version=0;
  private nativeRevision=0;
  private pending=0;
  private leave?:ReturnType<typeof setTimeout>;
  private dragging=false;
  private hovered=false;
  private disposed=false;
  constructor(public current:HudLayout,private command:Command,private changed:(next:HudLayout)=>void,private failed:(error:unknown)=>void) {}
  private publish(next:HudLayout) {this.current=next;this.changed({...next});}
  private clearHover() {if(this.leave!==undefined)clearTimeout(this.leave);this.leave=undefined;}
  receive(value:NativeLayout) {
    if(this.pending||this.dragging||this.disposed)return;
    this.restore(value);
  }
  receiveHover(inside:boolean,revision:number) {
    if(!this.disposed&&revision>=this.nativeRevision)this.hover(inside);
  }
  private restore(value:NativeLayout|undefined) {
    if(!value||!['hud','strip'].includes(value.mode)||(value.revision??0)<this.nativeRevision)return;
    this.nativeRevision=value.revision??this.nativeRevision;
    this.publish({mode:value.mode,scale:clampScale(value.scale??this.current.scale),expanded:value.mode===this.current.mode?this.current.expanded:false});
  }
  private update(patch:Partial<HudLayout>) {
    this.clearHover();
    const version=++this.version;
    const next={...this.current,...patch};
    this.publish(next);
    ++this.pending;
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      if(version!==this.version||this.disposed)return;
      const result=await this.command('set_layout',next);
      if(version===this.version)this.restore(result as NativeLayout|undefined);
    }).catch(error=>this.failed(error)).finally(()=>{--this.pending;});
    return this.queue;
  }
  mode(mode:HudMode) {return this.update({mode,expanded:false});}
  scale(delta:number) {return this.update({scale:clampScale(Math.round((this.current.scale+delta)*100)/100)});}
  hover(open:boolean) {
    this.hovered=open;
    if(this.dragging)return;
    if(open) {this.clearHover();if(!this.current.expanded)void this.update({expanded:true});}
    else if(this.leave===undefined&&this.current.expanded)this.leave=setTimeout(()=>{
      // Read the current intent. This callback never carries an old HUD mode.
      this.leave=undefined;
      if(!this.dragging)void this.update({expanded:false});
    },280);
  }
  async drag(start:()=>Promise<void>) {
    if(this.dragging)return;
    this.clearHover();this.dragging=true;
    const version=++this.version;
    try {
      await this.queue;
      const ticket=await this.command('begin_drag') as DragTicket|number;
      const revision=typeof ticket==='number'?ticket:ticket.revision;
      const moving=start();
      // On Windows, finish_drag waits for physical release independently of
      // the native move loop's IPC completion.
      if(typeof ticket!=='number'&&ticket.waitsForRelease)void moving.catch(error=>this.failed(error));
      else await moving;
      const result=await this.command('finish_drag',{revision});
      if(version===this.version) {
        this.publish({...this.current,expanded:false});
        this.restore(result as NativeLayout|undefined);
      }
    } catch(error) {this.failed(error);}
    finally {
      this.dragging=false;
      if(version===this.version&&!this.disposed)this.hover(this.hovered);
    }
  }
  dispose() {this.disposed=true;this.clearHover();}
}
