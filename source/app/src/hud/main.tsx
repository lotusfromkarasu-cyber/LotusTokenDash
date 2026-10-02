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
import { Icon } from './Icon.js';
import { useRefreshSeconds } from '../client/refresh.js';
import { resetTime } from './resetTime.js';

type Today = { tokens:number; cacheHitRate:number; fetchedAt:string };
type Source = { id:string; label:string; sessions:number };
export function pace(window: QuotaWindow | undefined, now = Date.now()) {
  if (!window?.durationMins || !window.resetsAt) return undefined;
  const reset=Date.parse(window.resetsAt);
  return Number.isFinite(reset) ? Math.max(0, Math.min(100, 100 - (reset - now) / (window.durationMins * 600))) : undefined;
}
const number = (value:number) => new Intl.NumberFormat('en', { notation:'compact', maximumFractionDigits:1 }).format(value);
function Bar({ label, window, remaining }: { label:string; window?:QuotaWindow;remaining:boolean }) {
  const ideal = pace(window);
  const used=window ? Math.max(0,Math.min(100,window.usedPercent)) : undefined;
  const value=used===undefined ? undefined : remaining ? 100-used : used;
  const reset=resetTime(window?.resetsAt,locale());
  const resetLabel=reset ? t('Resets at {time}',{time:reset.full}) : t('Reset time unavailable');
  return <div className="quota-row" title={window ? resetLabel : t('Quota window unavailable')}>
    <span>{label}</span><div className="track"><i style={{width:`${value ?? 0}%`}} />{ideal !== undefined && <em style={{left:`${remaining?100-ideal:ideal}%`}} />}</div><b>{value!==undefined ? `${Math.round(value)}%` : '—'}</b>
    <span className="reset-time" title={resetLabel}><span className="reset-label">{t('Resets')} </span>{reset ? <time dateTime={reset.dateTime} aria-label={resetLabel}>{reset.compact}</time> : <span aria-label={resetLabel}>—</span>}</span>
  </div>;
}
function Hud() {
  useLanguage();
  const refreshSeconds=useRefreshSeconds();
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
    const timer = refreshSeconds?setInterval(() => { if (!document.hidden) void update(); },refreshSeconds*1000):undefined;
    return () => { active = false; clearInterval(timer); window.removeEventListener('lotus-source-change',changed); window.removeEventListener('lotus-refresh',refresh); };
  },[source,refreshSeconds]);
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
    void refreshQuota(); const timer = refreshSeconds?setInterval(()=>{if(!document.hidden)void refreshQuota();},refreshSeconds*1000):undefined;
    const refresh=()=>void refreshQuota();
    const visible=()=>{if(!document.hidden)refresh();};
    window.addEventListener('lotus-refresh',refresh); document.addEventListener('visibilitychange',visible);
    return () => { active=false;clearInterval(timer);window.removeEventListener('lotus-refresh',refresh);document.removeEventListener('visibilitychange',visible); };
  },[refreshSeconds]);
  useEffect(()=>{
    let active=true;
    const stops:Array<()=>void>=[];
    if (isTauri()) {
      void listen<{mode:'hud'|'strip';scale:number;revision:number}>('lotus-mode', event => controller.receive(event.payload)).then(unlisten => {if(active)stops.push(unlisten);else unlisten();});
      void listen<{inside:boolean;revision:number}>('lotus-hover', event => controller.receiveHover(event.payload.inside,event.payload.revision)).then(unlisten => {if(active)stops.push(unlisten);else unlisten();});
    }
    void nativeCommand('layout_state').then(value=>{if(value)controller.receive(value as {mode:'hud'|'strip';scale:number;revision:number});});
    return () => { active=false;stops.forEach(stop=>stop());controller.dispose(); };
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
    if (isTauri()) {
      const target=event.currentTarget;
      const pointerId=event.pointerId;
      try {await controller.drag(()=>getCurrentWindow().startDragging());}
      finally {
        if(target.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);
        reportDesktop('drag-settled');
      }
    }
  }
  function toggleQuota() {setRemaining(value=>{localStorage.setItem('lotus-quota-display',value?'used':'remaining');return !value;});}
  const windows = quota?.windows ?? [];
  const five = windows.find(window=>window.durationMins===300);
  const week = windows.find(window=>window.durationMins===10080);
  const compact = mode==='strip' && !expanded;
  const quotaSwitch=<button className="quota-switch" title={t(remaining?'Show used quota':'Show remaining quota')} aria-pressed={remaining} onClick={toggleQuota}>{t(compact?(remaining?'Left':'Used'):(remaining?'Remaining':'Usage'))}</button>;
  return <main style={{'--scale':scale} as React.CSSProperties} className={`hud ${compact?'thin':''} ${!expanded?'resting':''} ${mode==='strip'?'docked':''}`} onPointerDown={event=>void drag(event)} onPointerMove={event=>{if(event.buttons===0)controller.hover(true);}} onMouseEnter={()=>controller.hover(true)} onMouseLeave={()=>controller.hover(false)}>
    {!compact && <header><span className="brand-icon"><Icon name="lotus"/></span><b>LOTUS</b>{quotaSwitch}<span className="live" title={quotaError||quota?.status.message}><i/> {t(quotaError?'Disconnected':!quota?'Connecting':quota.freshness==='cached'?'Cached':'LIVE')}</span><div className="header-actions"><button className="icon-button" title={t('Open analysis')} aria-label={t('Open analysis')} disabled={opening} onClick={()=>void openDetails()}><Icon name="analysis"/></button><button className="icon-button" title={t('Hide to tray')} aria-label={t('Hide to tray')} onClick={()=>void nativeCommand('hide_hud')}><Icon name="tray"/></button></div></header>}
    <section className="bars"><Bar label="5h" window={five} remaining={remaining}/><Bar label="7d" window={week} remaining={remaining}/>{compact&&quotaSwitch}</section>
    {!compact && <><section className="daily"><div><small>{t('Today tokens')}</small><strong>{today?number(today.tokens):'…'}</strong></div><div><small>{t('Cache hit')}</small><strong>{today?`${today.cacheHitRate.toFixed(1)}%`:'…'}</strong></div><button className="icon-button" title={t('Refresh usage')} aria-label={t('Refresh usage')} onClick={()=>window.dispatchEvent(new Event('lotus-refresh'))}><Icon name="refresh"/></button></section>
      {expanded && <footer><label className="source-picker" data-no-drag><select aria-label={t('Source')} value={source} onChange={e=>{setSource(e.target.value);choose(e.target.value);}}>{sources.map(item=><option key={item.id} value={item.id}>{item.id==='openai'?t('OpenAI Official'):item.id==='unknown'?t('Unknown source'):item.label}</option>)}</select><span><Icon name="chevron"/></span></label><div className="hud-controls"><button className="dock-button" title={t(mode==='hud'?'Dock to top bar':'Restore floating HUD')} onClick={()=>void controller.mode(mode==='hud'?'strip':'hud')}><Icon name={mode==='hud'?'dock':'float'}/><span>{t(mode==='hud'?'Dock':'Float')}</span></button><div className="zoom-controls" aria-label={t('HUD size')}><button title={t('Decrease HUD size')} aria-label={t('Decrease HUD size')} disabled={scale<=.75} onClick={()=>void controller.scale(-.1)}><Icon name="minus"/></button><span>{Math.round(scale*100)}%</span><button title={t('Increase HUD size')} aria-label={t('Increase HUD size')} disabled={scale>=1.5} onClick={()=>void controller.scale(.1)}><Icon name="plus"/></button></div></div></footer>}
      {error && <div className="error" role="status" title={error}>{error}</div>}{quotaError && <div className="error" title={quotaError}>{quotaError}</div>}</>}
  </main>;
}
mountDesktop(<Hud/>);
