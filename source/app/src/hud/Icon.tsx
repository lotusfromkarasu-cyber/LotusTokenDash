import type { ReactNode } from 'react';

type Name='lotus'|'analysis'|'tray'|'refresh'|'chevron'|'dock'|'float'|'minus'|'plus';
const paths:Record<Name,ReactNode>={
  lotus:<><path d="M12 3c-3 3-4 6-4 8s2 5 4 7c2-2 4-5 4-7s-1-5-4-8Z"/><path d="M8 9C5 7 3 7 2 7c0 6 4 11 10 12 6-1 10-6 10-12-1 0-3 0-6 2M4 17c2 3 5 4 8 4s6-1 8-4"/></>,
  analysis:<><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 16v-3m5 3V8m5 8v-5"/></>,
  tray:<><path d="M4 15v5h16v-5M12 3v11m-4-4 4 4 4-4"/></>,
  refresh:<><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-1l3 3M4 15l3 3a7 7 0 0 0 11-1"/></>,
  chevron:<path d="m7 10 5 5 5-5"/>,
  dock:<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18"/></>,
  float:<><rect x="4" y="6" width="16" height="14" rx="3"/><path d="M8 3h8M8 11h8"/></>,
  minus:<path d="M6 12h12"/>,
  plus:<path d="M6 12h12M12 6v12"/>,
};
export function Icon({name}:{name:Name}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
