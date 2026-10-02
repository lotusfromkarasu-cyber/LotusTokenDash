import { useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

export const refreshOptions=[30,60,180,300,600,0] as const;
const key='lotus-refresh-seconds';
export function getRefreshSeconds() {
  if(typeof window==='undefined')return 60;
  const saved=localStorage.getItem(key);
  const value=saved===null?60:Number(saved);
  return (refreshOptions as readonly number[]).includes(value)?value:60;
}
export function setRefreshSeconds(seconds:number) {
  if(!(refreshOptions as readonly number[]).includes(seconds))return;
  const changed=getRefreshSeconds()!==seconds;
  localStorage.setItem(key,String(seconds));
  window.dispatchEvent(new Event('lotus-refresh-interval-change'));
  if(changed&&isTauri())void emit('lotus-refresh-interval',seconds).catch(()=>{});
}
export function useRefreshSeconds() {
  return useSyncExternalStore(callback=>{
    const changed=()=>callback();
    const storage=(event:StorageEvent)=>{if(event.key===key)callback();};
    window.addEventListener('lotus-refresh-interval-change',changed);
    window.addEventListener('storage',storage);
    return ()=>{window.removeEventListener('lotus-refresh-interval-change',changed);window.removeEventListener('storage',storage);};
  },getRefreshSeconds,()=>60);
}
