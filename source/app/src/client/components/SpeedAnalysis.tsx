import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { t } from '../i18n.js';
import { formatSpeed, useSpeed, useSpeedHistory } from '../speed.js';
import { AnalysisTabs, type AnalysisView } from './AnalysisTabs.js';

const compact=(n:number)=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(n);
export function SpeedAnalysis({onViewChange}:{onViewChange:(view:AnalysisView)=>void}) {
  const live=useSpeed(); const history=useSpeedHistory(true);
  const [range,setRange]=useState(7); const [source,setSource]=useState('all');
  const snapshot=live?.snapshot;
  const available=snapshot?.sources.filter(item=>item.available||item.today.requests>0)??[];
  const days=useMemo(()=>{
    const cutoff=new Date();cutoff.setHours(0,0,0,0);cutoff.setDate(cutoff.getDate()-Math.max(0,range-1));
    const date=`${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
    return (history?.history?.days??[]).filter(day=>(!range||day.day>=date)&&(source==='all'||day.source===source));
  },[history,range,source]);
  const models=useMemo(()=>{
    const grouped=new Map<string,{model:string;output:number;requests:number;measuredOutput:number;measuredMs:number}>();
    for(const day of days)for(const model of day.models){const item=grouped.get(model.model)??{model:model.model,output:0,requests:0,measuredOutput:0,measuredMs:0};item.output+=model.output;item.requests+=model.requests;item.measuredOutput+=model.measuredOutput;item.measuredMs+=model.measuredMs;grouped.set(item.model,item);}
    return [...grouped.values()].sort((a,b)=>b.output-a.output);
  },[days]);
  const timeline=useMemo(()=>{
    const grouped=new Map<string,{day:string;output:number;requests:number}>();
    for(const day of days){const item=grouped.get(day.day)??{day:day.day,output:0,requests:0};item.output+=day.totals.output;item.requests+=day.totals.requests;grouped.set(day.day,item);}
    return [...grouped.values()].sort((a,b)=>a.day.localeCompare(b.day));
  },[days]);
  return <main className="speed-analysis" data-lotus-speed-analysis-ready>
    <div className="speed-heading"><div><AnalysisTabs value="speed" onChange={onViewChange}/><p>{t('Live speed and history across all detected agents')}</p></div><span className="speed-live-badge"><i/> {snapshot?.state==='Running'?t('LIVE'):live?.available?t('Connecting'):t('Unavailable')}</span></div>
    {!live?.available&&live!==null&&<div className="speed-message">{t('Speed monitor is unavailable')}</div>}
    <div className="speed-cards">
      <div><small>{t('Live output speed')}</small><strong>{formatSpeed(snapshot?.live)} <em>tok/s</em></strong><p>{snapshot?.estimatedShare?`${t('Estimated')} ${Math.round(snapshot.estimatedShare*100)}%`:t('All detected agents')}</p></div>
      <div><small>{t('Today peak')}</small><strong>{formatSpeed(snapshot?.peak)} <em>tok/s</em></strong><p>{t('Measured peak')}</p></div>
      <div><small>{t('Today average')}</small><strong>{formatSpeed(snapshot?.average)} <em>tok/s</em></strong><p>{t('Measured responses')}</p></div>
      <div><small>{t('Today output')}</small><strong>{snapshot?compact(snapshot.today.output):'—'}</strong><p>{snapshot?`${compact(snapshot.today.requests)} ${t('requests')}`:'—'}</p></div>
      <div><small>{t('Active agents')}</small><strong>{snapshot?.generating??'—'}</strong><p>{snapshot?`${snapshot.tools} ${t('using tools')}`:'—'}</p></div>
    </div>
    <div className="speed-grid"><section className="speed-panel"><h2>{t('Live speed')}</h2><p>{t('Last 5 minutes · measured and estimated output')}</p><div className="speed-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={snapshot?.chart??[]}><defs><linearGradient id="speed-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#af8369" stopOpacity={.35}/><stop offset="1" stopColor="#af8369" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3"/><XAxis dataKey="time" tickFormatter={v=>new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} minTickGap={70}/><YAxis width={44}/><Tooltip labelFormatter={v=>new Date(String(v)).toLocaleTimeString()}/><Area name={t('Measured')} type="monotone" dataKey="measured" stackId="speed" stroke="#af8369" fill="url(#speed-fill)" isAnimationActive={false}/><Area name={t('Estimated')} type="monotone" dataKey="estimated" stackId="speed" stroke="#8e4650" fill="#8e465055" isAnimationActive={false}/></AreaChart></ResponsiveContainer></div></section>
      <section className="speed-panel"><h2>{t('Sources')}</h2><p>{t('Live output speed by source')}</p>{available.length?available.map(item=><div className="speed-row" key={item.name}><span><b>{item.name}</b><small>{item.sessions} {t('sessions')}</small></span><strong>{formatSpeed(item.live)} <em>tok/s</em></strong></div>):<div className="speed-empty">{t('No detected sources')}</div>}</section></div>
    <section className="speed-panel speed-agents"><h2>{t('Agents')}</h2><p>{t('Recent activity and current phase')}</p>{snapshot?.agents.length?snapshot.agents.map(agent=><div className="speed-row" key={agent.id}><span><b>{agent.project||agent.source}{agent.isSubagent?` · ${t('Subagent')}`:''}</b><small>{agent.source}{agent.model?` · ${agent.model}`:''}</small></span><span className="speed-phase">{t(agent.phase==='Tools'?'Using tools':agent.phase)} · {formatSpeed(agent.live)} tok/s</span></div>):<div className="speed-empty">{t('No active agents')}</div>}</section>
    <section className="speed-panel speed-history"><div className="speed-history-heading"><div><h2>{t('Speed history')}</h2><p>{history?.history?.state==='Analyzing'?`${t('Analyzing history')} ${Math.round((history.history.progress??0)*100)}%`:t('Daily output and measured model speeds')}</p></div><div className="speed-filters">{[[1,'Today'],[7,'7 days'],[30,'30 days'],[0,'All']].map(([n,label])=><button key={n} aria-pressed={range===n} onClick={()=>setRange(Number(n))}>{t(String(label))}</button>)}<select aria-label={t('History source')} value={source} onChange={event=>setSource(event.target.value)}><option value="all">{t('All sources')}</option>{[...new Set((history?.history?.days??[]).map(item=>item.source))].map(item=><option key={item}>{item}</option>)}</select></div></div>
      {history?.history?.state==='Failed'&&<div className="speed-message">{t('History unavailable')}</div>}
      {timeline.length>0&&<div className="speed-chart history-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline}><CartesianGrid vertical={false} strokeDasharray="3 3"/><XAxis dataKey="day" minTickGap={40}/><YAxis width={55} tickFormatter={compact}/><Tooltip/><Area name={t('Output tokens')} type="monotone" dataKey="output" stroke="#9c4d55" fill="#9c4d5528" isAnimationActive={false}/></AreaChart></ResponsiveContainer></div>}
      {models.length?<div className="speed-table-wrap"><table><thead><tr><th>{t('Model')}</th><th>{t('Output tokens')}</th><th>{t('Requests')}</th><th>{t('Average speed')}</th></tr></thead><tbody>{models.map(model=><tr key={model.model}><td>{model.model}</td><td>{compact(model.output)}</td><td>{compact(model.requests)}</td><td>{formatSpeed(model.measuredMs?model.measuredOutput/model.measuredMs*1000:null)} tok/s</td></tr>)}</tbody></table></div>:<div className="speed-empty">{history?.history?.state==='Analyzing'?t('Analyzing history'):t('No speed history for this range')}</div>}
    </section>
  </main>;
}
