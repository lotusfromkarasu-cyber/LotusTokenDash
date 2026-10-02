import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeDesktop, reportDesktop } from './desktop.js';
import './bootstrap.css';
import { t, useLanguage } from './i18n.js';

function Startup({ children }: { children: ReactNode }) {
  useLanguage();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active=true;
    setError('');
    void initializeDesktop().then(()=>{if(active)setReady(true);}).catch(error=>{
      if(active) {setError(error instanceof Error ? error.message : String(error));reportDesktop('failed');}
    });
    return ()=>{active=false;};
  },[attempt]);
  useEffect(()=>{if(ready)reportDesktop('ready');},[ready]);
  if(ready) return children;
  return <section className="lotus-startup" role={error?'alert':'status'}>
    <b>LotusTokenDash</b><p>{t(error?'Local data service unavailable':'Connecting to local data service…')}</p>
    {error && <><small>{error}</small><button onClick={()=>retry(value=>value+1)}>{t('Retry')}</button></>}
  </section>;
}
export function mountDesktop(element:ReactNode) {
  createRoot(document.getElementById('root')!).render(<Startup>{element}</Startup>);
}
