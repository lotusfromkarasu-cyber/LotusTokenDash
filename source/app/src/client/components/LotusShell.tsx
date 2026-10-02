import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard.js';
import { getSource, setSource } from '../desktop.js';
import type { QuotaSnapshot } from '../../server/quota/types.js';

type Source = { id: string; label: string; sessions: number };
export function LotusShell() {
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
    event.preventDefault(); setError('正在验证…');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const res = await fetch('/api/lotus/credentials', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await res.json(); setError(res.ok ? '已保存' : result.status?.message ?? result.error ?? '验证失败');
  }
  return <>
    <header className="lotus-header">
      <div className="lotus-brand"><span className="lotus-symbol">✳</span><div><b>LotusTokenDash</b><small>LOCAL USAGE · CLEAR PERSPECTIVE</small></div></div>
      <label className="lotus-source">Codex 来源<select aria-label="Codex 数据来源" value={source} onChange={e => change(e.target.value)}>{sources.map(item => <option value={item.id} key={item.id}>{item.label} · {item.sessions}</option>)}</select></label>
      <button className="lotus-button" onClick={() => showSettings(!settings)}>配额设置</button>
    </header>
    <div className="lotus-scope-note">Codex 按来源独立统计 · 金额为模型价格估算 · 订阅额度使用官方配额接口</div>
    <section className="lotus-quotas" aria-label="订阅配额">{quotas.map(quota => <article key={quota.provider}><strong>{quota.displayName}</strong><small>{quota.planName ?? quota.status.message ?? ''}</small>{quota.windows.map(window => <div key={window.id} className="lotus-quota-window"><span>{window.label}</span><meter min="0" max="100" value={window.usedPercent} /><b>{window.usedPercent.toFixed(0)}%</b><small>{window.resetsAt ? new Date(window.resetsAt).toLocaleString() + ' 重置' : ''}</small></div>)}</article>)}</section>
    {settings && <form className="lotus-credential" onSubmit={event => void save(event)}><label>提供商<select name="provider"><option value="glm">GLM</option><option value="minimax">MiniMax</option><option value="kimi">Kimi</option></select></label><label>API Token<input name="apiKey" type="password" autoComplete="off" placeholder="留空并保存可移除配置" /></label><label>Base URL（可选）<input name="baseUrl" type="url" /></label><button className="lotus-button" type="submit">验证并保存</button><span role="status">{error}</span></form>}
    <Dashboard key={source} />
  </>;
}
