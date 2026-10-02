import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard.js';
import { getSource, setSource } from '../desktop.js';
import type { QuotaSnapshot } from '../../server/quota/types.js';
import { t, useLanguage, setLanguage, locale } from '../i18n.js';

type Source = { id: string; label: string; sessions: number };
export function LotusShell() {
  const language=useLanguage();
  const [sources, setSources] = useState<Source[]>([{ id: 'openai', label: 'OpenAI 官方', sessions: 0 }]);
  const [source, choose] = useState(getSource());
  const [quotas, setQuotas] = useState<QuotaSnapshot[]>([]);
  const [settings, showSettings] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const change=()=>choose(getSource()); window.addEventListener('lotus-source-change',change);
    void fetch('/api/lotus/sources').then(res => res.ok ? res.json() : []).then(setSources).catch(() => {});
    const refresh = () => { if (!document.hidden) void fetch('/api/quota').then(res => res.json()).then(data => setQuotas(data.providers ?? [])).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 180_000); return () => { clearInterval(timer); window.removeEventListener('lotus-source-change',change); };
  }, []);
  const change = (id: string) => { setSource(id); choose(id); };
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('Validating…');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const res = await fetch('/api/lotus/credentials', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await res.json(); setError(res.ok ? 'Saved' : result.status?.message ?? result.error ?? 'Validation failed');
  }
  return <>
    <header className="lotus-header">
      <div className="lotus-brand"><span className="lotus-symbol">✳</span><div><b>LotusTokenDash</b><small>{t('LOCAL USAGE · CLEAR PERSPECTIVE')}</small></div></div>
      <label className="lotus-source">{t('Codex source')}<select aria-label={t('Codex data source')} value={source} onChange={e => change(e.target.value)}>{sources.map(item => <option value={item.id} key={item.id}>{item.id==='openai'?t('OpenAI Official'):item.id==='unknown'?t('Unknown source'):item.label} · {item.sessions}</option>)}</select></label>
      <select className="lotus-language" aria-label="Language / 语言" value={language} onChange={event=>setLanguage(event.target.value as 'en'|'zh')}><option value="zh">中文</option><option value="en">English</option></select>
      <button className="lotus-button" onClick={() => showSettings(!settings)}>{t('Quota settings')}</button>
    </header>
    <div className="lotus-scope-note">{t('Codex sources are counted separately · Costs are model price estimates · Subscription quota uses the official API')}</div>
    <section className="lotus-quotas" aria-label={t('Subscription quota')}>{quotas.map(quota => <article key={quota.provider}><strong>{quota.displayName}</strong><small>{quota.planName ?? quota.status.message ?? ''}</small>{quota.windows.map(window => <div key={window.id} className="lotus-quota-window"><span>{t(window.label)}</span><meter min="0" max="100" value={window.usedPercent} /><b>{window.usedPercent.toFixed(0)}%</b><small>{window.resetsAt ? new Date(window.resetsAt).toLocaleString(locale()) + ' '+t('Resets') : ''}</small></div>)}</article>)}</section>
    {settings && <form className="lotus-credential" onSubmit={event => void save(event)}><label>{t('Provider')}<select name="provider"><option value="glm">GLM</option><option value="minimax">MiniMax</option><option value="kimi">Kimi</option></select></label><label>API Token<input name="apiKey" type="password" autoComplete="off" placeholder={t('Leave empty and save to remove credentials')} /></label><label>{t('Base URL (optional)')}<input name="baseUrl" type="url" /></label><button className="lotus-button" type="submit">{t('Validate and save')}</button><span role="status">{t(error)}</span></form>}
    <Dashboard key={source} />
  </>;
}
