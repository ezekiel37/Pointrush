// The last answer for each API path, held in memory for this tab only, so a
// screen opened again shows what it had at once while it refreshes. Signing
// in, up or out clears it, so the next person never sees the last one's data.
const entries = new Map<string, { schema: unknown; data: unknown }>();
const limit = 50;

export function cachedRead<T>(path: string | null, schema: unknown) {
  if (path === null) return null;
  const hit = entries.get(path);
  // Only data checked against the same schema is handed back.
  return hit && hit.schema === schema ? (hit.data as T) : null;
}

export function rememberRead(path: string, schema: unknown, data: unknown) {
  entries.delete(path);
  entries.set(path, { schema, data });
  if (entries.size > limit) entries.delete(entries.keys().next().value!);
}

export function forgetReads() {
  entries.clear();
}
