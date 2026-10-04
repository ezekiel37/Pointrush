'use client';
import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { apiRequest } from './api';
// Reads an API path, refreshing on reconnect and when the tab becomes visible.
// Changing the path never shows the previous resource's private data.
export function useApiRead<T>(path: string | null, schema: z.ZodType<T>) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    error: unknown;
    loading: boolean;
    path: string | null;
  }>({ data: null, error: null, loading: path !== null, path });
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    // Synchronize API state; never retain another resource's private data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) => ({
      data: current.path === path ? current.data : null,
      error: null,
      loading: true,
      path,
    }));
    void apiRequest(path, schema, { signal: controller.signal })
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
      : { data: null, error: null, loading: path !== null }),
    refresh,
  };
}
