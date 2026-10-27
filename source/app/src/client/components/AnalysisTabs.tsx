import { t } from '../i18n.js';
export type AnalysisView='usage'|'speed';
export function AnalysisTabs({value,onChange}:{value:AnalysisView;onChange:(value:AnalysisView)=>void}) {
  return <div className="analysis-heading"><h1>{t(value==='usage'?'Usage analytics':'Agent speed')}</h1><div className="analysis-tabs" aria-label={t('Analysis view')}>
    <button aria-pressed={value==='usage'} onClick={()=>onChange('usage')}>{t('Usage analytics')}</button>
    <button aria-pressed={value==='speed'} onClick={()=>onChange('speed')}>{t('Agent speed')}</button>
  </div></div>;
}
