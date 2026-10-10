'use client';
import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { apiRequest } from './api';
import { cachedRead, forgetReads, rememberRead } from './api-cache';
import { RequestError } from './auth-client';
// Reads an API path, refreshing on reconnect and when the tab becomes visible.
// Changing the path never shows the previous resource's private data. A path
// read before in this tab shows its last answer at once while it refreshes.
// `keep` holds the previous result while a new path loads; use it only when the
// paths are views of the same resource (for example, a date range).
export function useApiRead<T>(
  path: string | null,
  schema: z.ZodType<T>,
  { keep = false }: { keep?: boolean } = {},
) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    error: unknown;
    loading: boolean;
    path: string | null;
  }>(() => ({
    data: cachedRead<T>(path, schema),
    error: null,
    loading: path !== null,
    path,
  }));
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    // Synchronize API state; never retain another resource's private data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) => ({
      data:
        keep || current.path === path
          ? current.data
          : cachedRead<T>(path, schema),
      error: null,
      loading: true,
      path,
    }));
    void apiRequest(path, schema, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        rememberRead(path, schema, data);
        setState({ data, error: null, loading: false, path });
      })
      .catch((error) => {
        // A lapsed session must not leave private answers behind.
        if (error instanceof RequestError && error.status === 401)
          forgetReads();
        if (!controller.signal.aborted)
          setState({ data: null, error, loading: false, path });
      });
    return () => controller.abort();
  }, [path, schema, version, keep]);
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
      : {
          data: keep ? state.data : cachedRead<T>(path, schema),
          error: null,
          loading: path !== null,
        }),
    refresh,
  };
}
