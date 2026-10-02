import { useSyncExternalStore } from 'react';
import { zh, legacyEnglish } from './locales/zh.js';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

export type Language = 'en' | 'zh';
const key = 'lotus-language';
export function getLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  const saved=localStorage.getItem(key);
  return saved==='zh'||saved==='en' ? saved : navigator.language.startsWith('zh') ? 'zh' : 'en';
}
export function setLanguage(language:Language) {
  const changed=getLanguage()!==language;
  localStorage.setItem(key,language);
  document.documentElement.lang=language==='zh'?'zh-CN':'en';
  window.dispatchEvent(new Event('lotus-language-change'));
  if(changed && isTauri()) void emit('lotus-language',language).catch(()=>{});
  if(isTauri()) void invoke('set_language',{language}).catch(()=>{});
}
export function useLanguage() {
  return useSyncExternalStore(callback=>{
    const changed=()=>callback();
    const storage=(event:StorageEvent)=>{if(event.key===key)callback();};
    window.addEventListener('lotus-language-change',changed);
    window.addEventListener('storage',storage);
    return ()=>{window.removeEventListener('lotus-language-change',changed);window.removeEventListener('storage',storage);};
  },getLanguage,()=> 'en' as Language);
}
export function locale() {return getLanguage()==='zh'?'zh-CN':'en-US';}
export function t(text:string,values:Record<string,string|number>={}) {
  const key=text.trim();
  const english=legacyEnglish[key]??key;
  const translated=getLanguage()==='zh' ? zh[english]??key : english;
  const leading=text.startsWith(' ')?' ':'';
  const trailing=text.endsWith(' ')?' ':'';
  return (leading+translated+trailing).replace(/\{(\w+)\}/g,(_,name:string)=>String(values[name]??`{${name}}`));
}
