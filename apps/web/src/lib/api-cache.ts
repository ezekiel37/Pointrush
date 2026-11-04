import type { z } from 'zod';

// The last answer for each API path, held in memory for this tab only, so a
// screen opened again shows what it had at once while it refreshes. Signing
// in, up or out clears it, so the next person never sees the last one's data.
// One store per tab, kept on the window so every page shares it.
const store = globalThis as typeof globalThis & {
  __acticlaimReads?: Map<string, unknown>;
};
const entries = (store.__acticlaimReads ??= new Map<string, unknown>());
const limit = 50;

export function cachedRead<T>(path: string | null, schema: z.ZodType<T>) {
  if (path === null || !entries.has(path)) return null;
  // Checked again on the way out, so a shape another screen stored never
  // passes for this one.
  const parsed = schema.safeParse(entries.get(path));
  return parsed.success ? parsed.data : null;
}

export function rememberRead(path: string, data: unknown) {
  entries.delete(path);
  entries.set(path, data);
  if (entries.size > limit) entries.delete(entries.keys().next().value!);
}

export function forgetReads() {
  entries.clear();
}
