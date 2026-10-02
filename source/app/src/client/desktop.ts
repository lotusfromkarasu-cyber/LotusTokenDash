import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';

let source = localStorage.getItem('lotus-source') || 'openai';
export function getSource() { return source; }
export function setSource(id: string) { source = id; localStorage.setItem('lotus-source', id); if(isTauri()) void emit('lotus-source',id); }
let initialization: Promise<void> | undefined;
let sourceListening = false;
let refreshListening = false;
const originalFetch = window.fetch.bind(window);
export function initializeDesktop(): Promise<void> {
  return initialization ??= connectDesktop().catch(error => { initialization=undefined; throw error; });
}
async function connectDesktop() {
  if(isTauri() && !sourceListening) {
    await listen<string>('lotus-source',event=>{
    if(source===event.payload) return;
    source=event.payload; localStorage.setItem('lotus-source',source); window.dispatchEvent(new Event('lotus-source-change'));
    });
    sourceListening = true;
  }
  if(isTauri() && !refreshListening) {
    await listen('lotus-refresh',()=>window.dispatchEvent(new Event('lotus-refresh')));
    refreshListening = true;
  }
  // Preview can supply a local test-service address; packaged windows get it from Rust.
  const endpoint = isTauri()
    ? await invoke<{ port: number; token: string }>('service_address')
    : (window as unknown as { __LOTUS_SERVICE__?: { port: number; token: string } }).__LOTUS_SERVICE__;
  window.fetch = (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api/')) return originalFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set('X-Lotus-Source', source);
    if (endpoint) headers.set('X-Lotus-Token', endpoint.token);
    return originalFetch(endpoint ? `http://127.0.0.1:${endpoint.port}${input}` : input, { ...init, headers });
  };
}
export function reportDesktop(stage: 'ready' | 'data' | 'failed') {
  if(isTauri()) void invoke('renderer_status',{stage}).catch(()=>{});
}
export async function nativeCommand(command: string, args?: Record<string, unknown>) {
  if (isTauri()) return invoke(command, args);
}
