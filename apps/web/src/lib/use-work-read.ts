'use client';
import type { z } from 'zod';
import { useApiRead } from './use-api-read';
// Job (work) API reads; shares refresh and privacy behaviour with all reads.
export function useWorkRead<T>(path: string, schema: z.ZodType<T>) {
  return useApiRead(`work/${path}`, schema);
}
