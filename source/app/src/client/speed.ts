import { useEffect, useState } from 'react';

export type SpeedTotals = {requests:number; input:number; output:number; cachedInput:number; total:number};
export type SpeedSnapshot = {
  timestamp:string; state:'Starting'|'Running'|'NoSources'; live:number; estimatedShare:number;
  peak:number; average:number|null; today:SpeedTotals; generating:number; tools:number;
  sources:Array<{name:string; available:boolean; sessions:number; live:number; today:SpeedTotals; agents:number}>;
  agents:Array<{id:string; source:string; project:string; model:string|null; phase:string; isSubagent:boolean; live:number; recentSpeed:number|null}>;
  chart:Array<{time:string; measured:number; estimated:number}>;
};
export type SpeedHistory = {
  state:'NotLoaded'|'Analyzing'|'Ready'|'Failed'; progress:number; error?:string;
  days:Array<{day:string; source:string; totals:SpeedTotals; averageSpeed:number|null; peak:number|null; agents:number;
    models:Array<{model:string; requests:number; output:number; averageSpeed:number|null; measuredOutput:number; measuredMs:number}>}>;
};
type Result<T> = {available:boolean; error?:string} & T;
export function useSpeed(enabled=true) {
  const [value,setValue]=useState<Result<{snapshot:SpeedSnapshot|null}> | null>(null);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const update=()=>{if(!document.hidden)void fetch('/api/lotus/speed').then(r=>r.json()).then(data=>{if(active)setValue(data);}).catch(()=>{if(active)setValue({available:false,snapshot:null});});};
    update(); const timer=setInterval(update,1000);
    document.addEventListener('visibilitychange',update);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',update);};
  },[enabled]);
  return value;
}
export function useSpeedHistory(enabled:boolean) {
  const [value,setValue]=useState<Result<{history:SpeedHistory|null}> | null>(null);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const update=()=>{if(!document.hidden)void fetch('/api/lotus/speed/history').then(r=>r.json()).then(data=>{if(active)setValue(data);}).catch(()=>{if(active)setValue({available:false,history:null});});};
    update();const timer=setInterval(update,5000);
    return()=>{active=false;clearInterval(timer);};
  },[enabled]);
  return value;
}
export const formatSpeed=(value:number | null | undefined)=>value==null?'—':value===0?'0':value<10?value.toFixed(1):Math.round(value).toLocaleString();
