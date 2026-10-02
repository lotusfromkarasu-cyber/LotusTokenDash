import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeDesktop, reportDesktop } from './desktop.js';
import './bootstrap.css';

function Startup({ children }: { children: ReactNode }) {
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
    <b>LotusTokenDash</b><p>{error?'本地数据服务连接失败':'正在连接本地数据服务…'}</p>
    {error && <><small>{error}</small><button onClick={()=>retry(value=>value+1)}>重试</button></>}
  </section>;
}
export function mountDesktop(element:ReactNode) {
  createRoot(document.getElementById('root')!).render(<Startup>{element}</Startup>);
}
