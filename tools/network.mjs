import { ProxyAgent, setGlobalDispatcher } from '../source/app/node_modules/undici/index.js';
import { execFileSync } from 'node:child_process';
let proxy=process.env.HTTPS_PROXY??process.env.HTTP_PROXY;
if(!proxy && process.platform==='win32') {
  try {
    const registry='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const read=name=>execFileSync('reg.exe',['query',registry,'/v',name],{encoding:'utf8',windowsHide:true});
    if(/REG_DWORD\s+0x1/.test(read('ProxyEnable'))) {
      const value=read('ProxyServer').match(/REG_SZ\s+([^\r\n]+)/)?.[1].trim();
      if(value && !value.includes(';')) proxy=value.includes('://')?value:`http://${value}`;
    }
  } catch { /* No system proxy configured. */ }
}
if(proxy) setGlobalDispatcher(new ProxyAgent(proxy));
