import { useState } from 'react';
import type { MetricMode } from '../../shared/types.js';

export function useMetricMode() {
  const [mode, setMode] = useState<MetricMode>('tokens');

  const toggle = () => {
    setMode((prev) => (prev === 'tokens' ? 'usd' : 'tokens'));
  };

  return {
    mode,
    toggle,
    isTokens: mode === 'tokens',
    isUsd: mode === 'usd',
  };
}
