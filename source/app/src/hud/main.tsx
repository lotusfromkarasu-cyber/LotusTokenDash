import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { getSource, setSource, nativeCommand, reportDesktop } from '../client/desktop.js';
import { mountDesktop } from '../client/bootstrap.js';
import type { QuotaSnapshot, QuotaWindow } from '../server/quota/types.js';
import './style.css';
import { t, locale, useLanguage } from '../client/i18n.js';
import { HudLayoutController, clampScale, type HudLayout } from './layout.js';

type Today = { tokens:number; cacheHitRate:number; fetchedAt:string };
type Source = { id:string; label:string; sessions:number };
export function pace(window: QuotaWindow | undefined, now = Date.now()) {
  if (!window?.durationMins || !window.resetsAt) return undefined;
  return Math.max(0, Math.min(100, 100 - (Date.parse(window.resetsAt) - now) / (window.durationMins * 600)));
}
const number = (value:number) => new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(value);
function Bar({ label, window, remaining }: { label:string; window?:QuotaWindow;remaining:boolean }) {
  const ideal = pace(window);
  const used=window ? Math.max(0,Math.min(100,window.usedPercent)) : undefined;
  const value=used===undefined ? undefined : remaining ? 100-used : used;
  return <div className="quota-row" title={window?.resetsAt ? `${new Date(window.resetsAt).toLocaleString(locale())} ${t('Resets')}` : t('Quota window unavailable')}>
    <span>{label}</span><div className="track"><i style={{width:`${value ?? 0}%`}} />{ideal !== undefined && <em style={{left:`${remaining?100-ideal:ideal}%`}} />}</div><b>{value!==undefined ? `${Math.round(value)}%` : '—'}</b>
  </div>;
}
function Hud() {
  useLanguage();
  const [source, choose] = useState(getSource());
  const [sources, setSources] = useState<Source[]>([{id:'openai',label:'OpenAI 官方',sessions:0}]);
  const [today, setToday] = useState<Today | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [error, setError] = useState('');
  const [quotaError, setQuotaError] = useState('');
  const [opening, setOpening] = useState(false);
  const [remaining,setRemaining]=useState(localStorage.getItem('lotus-quota-display')==='remaining');
  const [layout,changeLayout]=useState<HudLayout>({mode:'hud',expanded:false,scale:clampScale(Number(localStorage.getItem('lotus-scale')??1))});
  const [controller]=useState(()=>new HudLayoutController(layout,nativeCommand,next=>{
    changeLayout(next);localStorage.setItem('lotus-scale',String(next.scale));
  },error=>setError(String(error))));
  const {mode,expanded,scale}=layout;
  const refreshRef = useRef<() => void>(()=>{});
  useEffect(() => {
    const changed=()=>choose(getSource()); window.addEventListener('lotus-source-change',changed);
    const refresh=()=>refreshRef.current(); window.addEventListener('lotus-refresh',refresh);
    let active = true;
    const update = async () => {
      try { const res = await fetch('/api/lotus/today'); if (!res.ok) throw new Error(t('Usage request failed ({status})',{status:res.status}));
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
        if(!res.ok) throw new Error(t('Quota request failed ({status})',{status:res.status}));
        const data:QuotaSnapshot=await res.json();
        if(active) {setQuota(data);setQuotaError(data.status.state==='ok'?'':data.status.message??t('Official quota unavailable'));}
      } catch(error) {if(active)setQuotaError(String(error));}
    };
    void fetch('/api/lotus/sources').then(res=>res.json()).then(setSources).catch(()=>{});
    void refreshQuota(); const timer = setInterval(()=>{if(!document.hidden)void refreshQuota();},180_000);
    const refresh=()=>void refreshQuota();
    const visible=()=>{if(!document.hidden)refresh();};
    window.addEventListener('lotus-refresh',refresh); document.addEventListener('visibilitychange',visible);
    let stop = () => {};
    if (isTauri()) void listen<{mode:'hud'|'strip';scale:number;revision:number}>('lotus-mode', event => controller.receive(event.payload)).then(unlisten => {if(active)stop=unlisten;else unlisten();});
    void nativeCommand('layout_state').then(value=>{if(value)controller.receive(value as {mode:'hud'|'strip';scale:number;revision:number});});
    return () => { active=false;clearInterval(timer); stop();controller.dispose();window.removeEventListener('lotus-refresh',refresh);document.removeEventListener('visibilitychange',visible); };
  },[]);
  async function openDetails() {
    if(opening)return;
    setOpening(true);
    try {await nativeCommand('open_details');}
    catch(error) {setError(t('Cannot open analysis: {error}',{error:String(error)}));}
    finally {setOpening(false);}
  }
  async function drag(event:React.PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,select,[data-no-drag]')) return;
    if (isTauri()) await controller.drag(()=>getCurrentWindow().startDragging());
  }
  function toggleQuota() {setRemaining(value=>{localStorage.setItem('lotus-quota-display',value?'used':'remaining');return !value;});}
  const windows = quota?.windows ?? [];
  const five = windows.find(window=>window.durationMins===300);
  const week = windows.find(window=>window.durationMins===10080);
  const compact = mode==='strip' && !expanded;
  const quotaSwitch=<button className="quota-switch" title={t(remaining?'Show used quota':'Show remaining quota')} aria-pressed={remaining} onClick={toggleQuota}>{t(compact?(remaining?'Left':'Used'):(remaining?'Remaining':'Usage'))}</button>;
  return <main style={{'--scale':scale} as React.CSSProperties} className={`hud ${compact?'thin':''} ${!expanded?'resting':''} ${mode==='strip'?'docked':''}`} onPointerDown={event=>void drag(event)} onMouseEnter={()=>controller.hover(true)} onMouseLeave={()=>controller.hover(false)}>
    {!compact && <header><span className="brand-icon">✳</span><b>LOTUS</b>{quotaSwitch}<span className="live" title={quotaError||quota?.status.message}>● {t(quotaError?'Disconnected':!quota?'Connecting':quota.freshness==='cached'?'Cached':'LIVE')}</span><button title={t('Open analysis')} disabled={opening} onClick={()=>void openDetails()}>↗</button><button title={t('Hide to tray')} onClick={()=>void nativeCommand('hide_hud')}>−</button></header>}
    <section className="bars"><Bar label="5h" window={five} remaining={remaining}/><Bar label="7d" window={week} remaining={remaining}/>{compact&&quotaSwitch}</section>
    {!compact && <><section className="daily"><div><small>{t('Today tokens')}</small><strong>{today?number(today.tokens):'…'}</strong></div><div><small>{t('Cache hit')}</small><strong>{today?`${today.cacheHitRate.toFixed(1)}%`:'…'}</strong></div><button title={t('Refresh usage')} onClick={()=>window.dispatchEvent(new Event('lotus-refresh'))}>↻</button></section>
      {expanded && <footer><label className="source-picker" data-no-drag><select aria-label={t('Source')} value={source} onChange={e=>{setSource(e.target.value);choose(e.target.value);}}>{sources.map(item=><option key={item.id} value={item.id}>{item.id==='openai'?t('OpenAI Official'):item.id==='unknown'?t('Unknown source'):item.label}</option>)}</select><span aria-hidden="true">⌄</span></label><div className="hud-controls"><button title={t(mode==='hud'?'Dock to top bar':'Restore floating HUD')} onClick={()=>void controller.mode(mode==='hud'?'strip':'hud')}>{mode==='hud'?'⌃':'⌄'}</button><button title={t('Decrease HUD size')} disabled={scale<=.75} onClick={()=>void controller.scale(-.1)}>−</button><button title={t('Increase HUD size')} disabled={scale>=1.5} onClick={()=>void controller.scale(.1)}>＋</button></div></footer>}
      {error && <div className="error" role="status" title={error}>{error}</div>}{quotaError && <div className="error" title={quotaError}>{quotaError}</div>}</>}
  </main>;
}
mountDesktop(<Hud/>);
