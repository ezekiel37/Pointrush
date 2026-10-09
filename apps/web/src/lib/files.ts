import { z } from 'zod';
import { apiOrigin, RequestError } from './auth-client';

export type Purpose = 'avatar' | 'logo' | 'evidence';
export const uploaded = z.object({
  id: z.uuid(),
  purpose: z.enum(['avatar', 'logo', 'evidence']),
  contentType: z.string(),
  sizeBytes: z.number(),
});
export type Uploaded = z.infer<typeof uploaded>;

export const maxBytes: Record<Purpose, number> = {
  avatar: 2 * 1024 * 1024,
  logo: 2 * 1024 * 1024,
  evidence: 5 * 1024 * 1024,
};
export const accepts: Record<Purpose, string> = {
  avatar: 'image/jpeg,image/png,image/webp',
  logo: 'image/jpeg,image/png,image/webp',
  evidence: 'image/jpeg,image/png,image/webp,application/pdf',
};

// Sends the raw file; the API checks what it really is and cleans it.
export async function uploadFile(purpose: Purpose, file: File) {
  if (file.size > maxBytes[purpose]) throw new RequestError(413, 'too_large');
  const response = await fetch(
    `${apiOrigin()}/api/v1/files?purpose=${purpose}`,
    {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      reason?: string;
    } | null;
    throw new RequestError(response.status, body?.reason);
  }
  return uploaded.parse(await response.json());
}

export function uploadError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 413 || error.code === 'too_large')
      return 'That file is too big. Pictures can be up to 2 MB, evidence up to 5 MB.';
    if (error.code === 'file_rejected' || error.status === 400)
      return 'That file could not be used. Choose a JPEG, PNG or WebP picture (or a PDF for evidence).';
    if (error.code === 'storage_unavailable')
      return 'Uploads are not available yet.';
    if (error.code === 'upload_limit')
      return 'You have uploaded a lot today. Try again tomorrow.';
  }
  return 'The upload did not finish. Check your connection and try again.';
}

// Public files (profile pictures, approved logos) and private ones.
export const publicFileUrl = (id: string) =>
  `${apiOrigin()}/api/v1/files/public/${id}`;
export const privateFileUrl = (id: string) =>
  `${apiOrigin()}/api/v1/files/${id}`;
