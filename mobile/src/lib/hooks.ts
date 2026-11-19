import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errText } from './api';

/** Load data when the screen is focused, with refresh, error and a quiet reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (mode: 'first' | 'refresh' | 'quiet' = 'quiet') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const r = await fnRef.current();
      if (!alive.current) return;
      setData(r);
      setError(null);
    } catch (e) {
      if (alive.current) setError(errText(e));
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      run('first');
      if (!opts.pollMs) return undefined;
      const t = setInterval(() => run('quiet'), opts.pollMs);
      return () => clearInterval(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, opts.pollMs]),
  );

  return { data, setData, error, loading, refreshing, refresh: () => run('refresh'), reload: () => run('quiet') };
}

/** Wrap an async action with busy state and a readable error. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errText(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, setError, run };
}
