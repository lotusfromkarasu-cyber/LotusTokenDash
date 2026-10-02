import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';

let source = localStorage.getItem('lotus-source') || 'openai';
export function getSource() { return source; }
export function setSource(id: string) { source = id; localStorage.setItem('lotus-source', id); if(isTauri()) void emit('lotus-source',id); }
export async function initializeDesktop() {
  if(isTauri()) await listen<string>('lotus-source',event=>{
    if(source===event.payload) return;
    source=event.payload; localStorage.setItem('lotus-source',source); window.dispatchEvent(new Event('lotus-source-change'));
  });
  // Preview can supply a local test-service address; packaged windows get it from Rust.
  const endpoint = isTauri()
    ? await invoke<{ port: number; token: string }>('service_address')
    : (window as unknown as { __LOTUS_SERVICE__?: { port: number; token: string } }).__LOTUS_SERVICE__;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api/')) return original(input, init);
    const headers = new Headers(init?.headers);
    headers.set('X-Lotus-Source', source);
    if (endpoint) headers.set('X-Lotus-Token', endpoint.token);
    return original(endpoint ? `http://127.0.0.1:${endpoint.port}${input}` : input, { ...init, headers });
  };
}
export async function nativeCommand(command: string, args?: Record<string, unknown>) {
  if (isTauri()) return invoke(command, args);
}
