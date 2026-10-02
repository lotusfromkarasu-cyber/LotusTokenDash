import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { getSource, setSource, nativeCommand, reportDesktop } from '../client/desktop.js';
import { mountDesktop } from '../client/bootstrap.js';
import type { QuotaSnapshot, QuotaWindow } from '../server/quota/types.js';
import './style.css';

type Today = { tokens:number; cacheHitRate:number; fetchedAt:string };
type Source = { id:string; label:string; sessions:number };
export function pace(window: QuotaWindow | undefined, now = Date.now()) {
  if (!window?.durationMins || !window.resetsAt) return undefined;
  return Math.max(0, Math.min(100, 100 - (Date.parse(window.resetsAt) - now) / (window.durationMins * 600)));
}
const number = (value:number) => new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(value);
function Bar({ label, window }: { label:string; window?:QuotaWindow }) {
  const ideal = pace(window);
  return <div className="quota-row" title={window?.resetsAt ? `${new Date(window.resetsAt).toLocaleString()} 重置` : '官方接口尚未提供此窗口'}>
    <span>{label}</span><div className="track"><i style={{width:`${window?.usedPercent ?? 0}%`}} />{ideal !== undefined && <em style={{left:`${ideal}%`}} />}</div><b>{window ? `${Math.round(window.usedPercent)}%` : '—'}</b>
  </div>;
}
function Hud() {
  const [source, choose] = useState(getSource());
  const [sources, setSources] = useState<Source[]>([{id:'openai',label:'OpenAI 官方',sessions:0}]);
  const [today, setToday] = useState<Today | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [error, setError] = useState('');
  const [quotaError, setQuotaError] = useState('');
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<'hud'|'strip'>('hud');
  const [expanded, expand] = useState(false);
  const [scale, setScale] = useState(Number(localStorage.getItem('lotus-scale') ?? '1'));
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const refreshRef = useRef<() => void>(()=>{});
  useEffect(() => {
    const changed=()=>choose(getSource()); window.addEventListener('lotus-source-change',changed);
    const refresh=()=>refreshRef.current(); window.addEventListener('lotus-refresh',refresh);
    let active = true;
    const update = async () => {
      try { const res = await fetch('/api/lotus/today'); if (!res.ok) throw new Error(`统计读取失败 (${res.status})`);
        const data = await res.json(); if (active) { setToday(data); setError(''); reportDesktop('data'); } }
      catch (error) { if (active) setError(String(error)); }
    };
    setToday(null); refreshRef.current = () => void update(); void update();
    const timer = setInterval(() => { if (!document.hidden) void update(); },60_000);
    return () => { active = false; clearInterval(timer); window.removeEventListener('lotus-source-change',changed); window.removeEventListener('lotus-refresh',refresh); };
  },[source]);
  useEffect(() => {
    let active=true;
    const refreshQuota = async () => {
      try {
        const res=await fetch('/api/lotus/codex-quota');
        if(!res.ok) throw new Error(`配额读取失败 (${res.status})`);
        const data:QuotaSnapshot=await res.json();
        if(active) {setQuota(data);setQuotaError(data.status.state==='ok'?'':data.status.message??'官方配额暂不可用');}
      } catch(error) {if(active)setQuotaError(String(error));}
    };
    void fetch('/api/lotus/sources').then(res=>res.json()).then(setSources).catch(()=>{});
    void refreshQuota(); const timer = setInterval(()=>{if(!document.hidden)void refreshQuota();},180_000);
    const refresh=()=>void refreshQuota();
    const visible=()=>{if(!document.hidden)refresh();};
    window.addEventListener('lotus-refresh',refresh); document.addEventListener('visibilitychange',visible);
    let stop = () => {};
    if (isTauri()) void listen<{mode:'hud'|'strip'}>('lotus-mode', event => { setMode(event.payload.mode); expand(false); }).then(unlisten => { stop=unlisten; });
    void nativeCommand('layout_state').then(value=>{if(value){const layout=value as {mode:'hud'|'strip';scale:number};setMode(layout.mode);setScale(layout.scale);}});
    return () => { active=false;clearInterval(timer); stop();window.removeEventListener('lotus-refresh',refresh);document.removeEventListener('visibilitychange',visible); };
  },[]);
  async function openDetails() {
    if(opening)return;
    setOpening(true);
    try {await nativeCommand('open_details');}
    catch(error) {setError(`分析窗口打开失败：${String(error)}`);}
    finally {setOpening(false);}
  }
  async function resize(nextMode:'hud'|'strip', open:boolean, nextScale=scale) {
    await nativeCommand('set_layout',{mode:nextMode,expanded:open,scale:nextScale}); setMode(nextMode); expand(open);
  }
  function hover(open:boolean) {
    if (leave.current) clearTimeout(leave.current);
    if (dragging.current) return;
    if(open) void resize(mode,true); else leave.current=setTimeout(()=>void resize(mode,false),280);
  }
  async function drag(event:React.PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,select')) return;
    dragging.current=true;
    if (isTauri()) { await getCurrentWindow().startDragging(); await nativeCommand('finish_drag'); }
    dragging.current=false;
  }
  const windows = quota?.windows ?? [];
  const five = windows.find(window=>window.durationMins===300);
  const week = windows.find(window=>window.durationMins===10080);
  const compact = mode==='strip' && !expanded;
  return <main style={{'--scale':scale} as React.CSSProperties} className={`hud ${compact?'thin':''} ${!expanded?'resting':''} ${mode==='strip'?'docked':''}`} onPointerDown={event=>void drag(event)} onMouseEnter={()=>hover(true)} onMouseLeave={()=>hover(false)}>
    {!compact && <header><span className="brand-icon">✳</span><b>LOTUS</b><span className="live" title={quotaError||quota?.status.message}>● {quotaError?'未连接':!quota?'连接中':quota.freshness==='cached'?'缓存':'LIVE'}</span><button title="打开完整分析窗口" disabled={opening} onClick={()=>void openDetails()}>↗</button><button title="隐藏到托盘" onClick={()=>void nativeCommand('hide_hud')}>−</button></header>}
    <section className="bars"><Bar label="5h" window={five}/><Bar label="7d" window={week}/></section>
    {!compact && <><section className="daily"><div><small>TODAY TOKENS</small><strong>{today?number(today.tokens):'…'}</strong></div><div><small>CACHE HIT</small><strong>{today?`${today.cacheHitRate.toFixed(1)}%`:'…'}</strong></div><button title="刷新统计" onClick={()=>refreshRef.current()}>↻</button></section>
      {expanded && <footer><select aria-label="统计来源" value={source} onChange={e=>{setSource(e.target.value);choose(e.target.value);}}>{sources.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><button title={mode==='hud'?'吸附顶部细条':'恢复悬浮 HUD'} onClick={()=>void resize(mode==='hud'?'strip':'hud',false)}>⌃</button><button title="调整 HUD 大小" onClick={()=>{const value=scale>=1.25?.85:Math.round((scale+.1)*100)/100;localStorage.setItem('lotus-scale',String(value));setScale(value);void resize(mode,expanded,value);}}>⌕</button></footer>}
      {error && <div className="error" role="status" title={error}>{error}</div>}{quotaError && <div className="error" title={quotaError}>{quotaError}</div>}</>}
  </main>;
}
mountDesktop(<Hud/>);
