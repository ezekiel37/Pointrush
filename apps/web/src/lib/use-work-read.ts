'use client';
import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { workRequest } from './work';
export function useWorkRead<T>(path: string, schema: z.ZodType<T>) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    error: unknown;
    loading: boolean;
    path: string;
  }>({ data: null, error: null, loading: true, path });
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    // Synchronize API state; never retain another resource's private data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ data: null, error: null, loading: true, path });
    void workRequest(path, schema, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, error: null, loading: false, path });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ data: null, error, loading: false, path });
      });
    return () => controller.abort();
  }, [path, schema, version]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  return {
    ...(state.path === path
      ? state
      : { data: null, error: null, loading: true }),
    refresh,
  };
}
