// Checks what an uploaded file really is from its bytes (never its name or
// the browser's claim) and strips metadata such as the GPS position phone
// cameras write into photos. Anything that does not parse cleanly is
// refused rather than stored.

export type FileKind =
  'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export class FileRejected extends Error {}

export function detect(body: Buffer): FileKind | null {
  if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  )
    return 'image/jpeg';
  if (
    body.length >= 8 &&
    body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    body.length >= 12 &&
    body.toString('latin1', 0, 4) === 'RIFF' &&
    body.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (body.length >= 5 && body.toString('latin1', 0, 5) === '%PDF-')
    return 'application/pdf';
  return null;
}

// JPEG: drop APP1 (EXIF/XMP), APP13 (IPTC) and comments; keep the rest.
function stripJpeg(body: Buffer) {
  const parts: Buffer[] = [body.subarray(0, 2)];
  let at = 2;
  while (at < body.length) {
    if (body[at] !== 0xff) throw new FileRejected('Broken JPEG');
    let marker = body[at + 1]!;
    // Fill bytes before a marker.
    while (marker === 0xff) {
      at += 1;
      marker = body[at + 1]!;
    }
    if (marker === 0xd9) {
      parts.push(body.subarray(at, at + 2));
      return Buffer.concat(parts);
    }
    if (marker === 0xda) {
      // Start of scan: the compressed image follows to the end.
      parts.push(body.subarray(at));
      return Buffer.concat(parts);
    }
    if (at + 4 > body.length) throw new FileRejected('Broken JPEG');
    const length = body.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > body.length)
      throw new FileRejected('Broken JPEG');
    const segment = body.subarray(at, at + 2 + length);
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe)
      parts.push(segment);
    at += 2 + length;
  }
  throw new FileRejected('Broken JPEG');
}

// PNG: drop text, time and EXIF chunks; keep image data.
function stripPng(body: Buffer) {
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME', 'eXIf']);
  const parts: Buffer[] = [body.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= body.length) {
    const length = body.readUInt32BE(at);
    const type = body.toString('latin1', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > body.length) throw new FileRejected('Broken PNG');
    if (!drop.has(type)) parts.push(body.subarray(at, end));
    at = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  throw new FileRejected('Broken PNG');
}

// WebP: drop EXIF and XMP chunks and clear their flags.
function stripWebp(body: Buffer) {
  const parts: Buffer[] = [];
  let at = 12;
  while (at + 8 <= body.length) {
    const type = body.toString('latin1', at, at + 4);
    const length = body.readUInt32LE(at + 4);
    const end = at + 8 + length + (length % 2);
    if (at + 8 + length > body.length) throw new FileRejected('Broken WebP');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(body.subarray(at, Math.min(end, body.length)));
      if (type === 'VP8X' && chunk.length > 8) chunk[8] = chunk[8]! & ~0x0c;
      parts.push(chunk);
    }
    at = end;
  }
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, payload]);
}

// PDFs are kept as they are, but ones that can run code or carry other
// files are refused.
function checkPdf(body: Buffer) {
  const text = body.toString('latin1');
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(text))
    throw new FileRejected('PDF with active content');
  return body;
}

export function clean(body: Buffer, kind: FileKind) {
  switch (kind) {
    case 'image/jpeg':
      return stripJpeg(body);
    case 'image/png':
      return stripPng(body);
    case 'image/webp':
      return stripWebp(body);
    case 'application/pdf':
      return checkPdf(body);
  }
}
