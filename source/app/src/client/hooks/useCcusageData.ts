import { useState, useEffect, useCallback, useRef } from 'react';

import { useRefreshSeconds } from '../refresh.js';

export function useCcusageData<T>(fetcher: (refresh?: boolean) => Promise<T>, intervalMs?:number) {
  const seconds=useRefreshSeconds();
  const delay=intervalMs??seconds*1000;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(refresh);
      setData(result);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  // 首次加载 + fetcher 变化时重新拉取
  useEffect(() => {
    fetchData();
    const refresh=()=>void fetchData(true); window.addEventListener('lotus-refresh',refresh);
    return ()=>window.removeEventListener('lotus-refresh',refresh);
  }, [fetchData]);

  // 定时自动刷新
  useEffect(() => {
    if (delay <= 0) return;
    timerRef.current = setInterval(() => { if (!document.hidden) void fetchData(false); }, delay);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData, delay]);

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  return { data, loading, error, refetch, lastUpdated };
}
