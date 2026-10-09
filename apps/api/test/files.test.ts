import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { FilesService } from '../src/files/files.service.js';
import { clean, detect, FileRejected } from '../src/files/inspect.js';
import {
  MemoryStorage,
  R2Storage,
  signS3Request,
} from '../src/files/storage.js';
import { ProfileEditsService } from '../src/profiles/profile-edits.service.js';
import { TaskReviewService } from '../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../src/reviews/task-review.schema.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const { pg, db, identity, business, sponsors, work, fund, reviewer, travel } =
  await campaignFixture();
const storage = new MemoryStorage();
const files = new FilesService(db, storage);
const edits = new ProfileEditsService(db);
const admin = new AdminService(db);
after(() => pg.close());

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      (response as { reason?: string })?.reason ??
      (error as { status?: number }).status
    );
  }
  assert.fail('Expected rejection');
}

// Tiny but structurally real files.
const segment = (marker: number, payload: Buffer) => {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};
function jpeg(withGps = true) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01')),
    ...(withGps
      ? [segment(0xe1, Buffer.from('Exif\0\0GPS 6.5244N 3.3792E home'))]
      : []),
    segment(0xdb, Buffer.alloc(65, 1)),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0x11, 0x22]),
    Buffer.from([0xff, 0xd9]),
  ]);
}
function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([
    length,
    Buffer.from(type, 'latin1'),
    data,
    Buffer.alloc(4),
  ]);
}
function png() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13, 1)),
    chunk('tEXt', Buffer.from('Author\0Ada at 12 Allen Avenue')),
    chunk('eXIf', Buffer.from('GPS')),
    chunk('IDAT', Buffer.alloc(10, 2)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function webp() {
  const part = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([
      head,
      data,
      data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
    ]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c;
  const body = Buffer.concat([
    part('VP8X', vp8x),
    part('VP8 ', Buffer.alloc(12, 3)),
    part('EXIF', Buffer.from('GPS position')),
    part('XMP ', Buffer.from('<x:xmpmeta/>')),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

test('files are recognised by their bytes and location data is removed', () => {
  assert.equal(detect(jpeg()), 'image/jpeg');
  assert.equal(detect(png()), 'image/png');
  assert.equal(detect(webp()), 'image/webp');
  assert.equal(detect(Buffer.from('%PDF-1.7 hello')), 'application/pdf');
  assert.equal(detect(Buffer.from('<svg onload="alert(1)">')), null);
  const j = clean(jpeg(), 'image/jpeg');
  assert.ok(!j.includes('GPS'));
  assert.ok(j.includes('JFIF'));
  assert.deepEqual([...j.subarray(-2)], [0xff, 0xd9]);
  const p = clean(png(), 'image/png');
  assert.ok(!p.includes('Allen Avenue') && !p.includes('GPS'));
  assert.ok(p.includes('IDAT') && p.includes('IEND'));
  const w = clean(webp(), 'image/webp');
  assert.ok(!w.includes('GPS') && !w.includes('xmpmeta'));
  assert.equal(w.readUInt32LE(4), w.length - 8);
  assert.equal(w[20]! & 0x0c, 0);
  assert.throws(
    () =>
      clean(Buffer.from('%PDF-1.4 /OpenAction /JavaScript'), 'application/pdf'),
    FileRejected,
  );
  assert.throws(
    () => clean(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), 'image/jpeg'),
    FileRejected,
  );
});

test('storage requests are signed the way S3 and R2 expect', async () => {
  // AWS's published example: GET /test.txt with a Range header.
  const headers = signS3Request({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    amzDate: '20130524T000000Z',
    payloadHash:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    headers: { range: 'bytes=0-9' },
  });
  assert.match(
    headers.authorization,
    /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/,
  );
  const calls: { url: string; method: string; auth: string }[] = [];
  const r2 = new R2Storage(
    {
      accountId: 'a'.repeat(32),
      accessKeyId: 'key-id-0123456789',
      secretAccessKey: 's'.repeat(40),
      bucket: 'acticlaim-files',
    },
    ((url: string, init: RequestInit) => {
      calls.push({
        url,
        method: String(init.method),
        auth: String((init.headers as Record<string, string>).authorization),
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch,
  );
  await r2.put('logo/abc', Buffer.from('x'), 'image/png');
  assert.equal(
    calls[0]!.url,
    `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/acticlaim-files/logo/abc`,
  );
  assert.equal(calls[0]!.method, 'PUT');
  assert.match(
    calls[0]!.auth,
    /^AWS4-HMAC-SHA256 Credential=key-id-0123456789\/\d{8}\/auto\/s3\/aws4_request/,
  );
});

test('uploads are checked, cleaned, limited and need storage', async () => {
  const person = await identity();
  assert.equal(
    await reason(new FilesService(db).upload(person.user, 'avatar', png())),
    'storage_unavailable',
  );
  assert.equal(
    await reason(files.upload(person.user, 'avatar', Buffer.from('%PDF-1.4'))),
    'file_rejected',
  );
  assert.equal(
    await reason(
      files.upload(person.user, 'avatar', Buffer.alloc(3 * 1024 * 1024, 0xff)),
    ),
    413,
  );
  assert.equal(await reason(files.upload(person.user, 'banner', png())), 400);
  const uploaded = await files.upload(person.user, 'evidence', jpeg());
  assert.equal(uploaded.contentType, 'image/jpeg');
  const stored = storage.objects.get(`evidence/${uploaded.id}`)!;
  assert.ok(!stored.body.includes('GPS'));
  // Others cannot read a file that is not public.
  const stranger = await identity();
  assert.equal(await reason(files.read(stranger.user, uploaded.id)), 403);
  assert.equal(await reason(files.readPublic(uploaded.id)), 404);
  assert.ok(
    (await files.read(person.user, uploaded.id)).body.equals(stored.body),
  );
});

test('a profile picture becomes public once set, and can be removed', async () => {
  const person = await identity();
  const other = await identity();
  const picture = await files.upload(person.user, 'avatar', png());
  assert.equal(await reason(files.readPublic(picture.id)), 404);
  // Someone else's file cannot become your picture.
  assert.equal(
    await reason(files.setAvatar(other.user, { fileId: picture.id })),
    'picture_unavailable',
  );
  await files.setAvatar(person.user, { fileId: picture.id });
  assert.deepEqual(await files.avatar(person.user), { fileId: picture.id });
  assert.equal((await files.readPublic(picture.id)).cache, 'public');
  await files.setAvatar(person.user, { fileId: null });
  assert.equal(await reason(files.readPublic(picture.id)), 404);
});

test('a logo shows only after a reviewer approves it', async () => {
  const owner = await business('Logo Foods');
  const logo = await files.upload(owner.user, 'logo', webp());
  const change = { id: randomUUID(), field: 'logo' as const, value: logo.id };
  assert.equal((await edits.change(owner.user, change)).state, 'pending');
  assert.equal(await reason(files.readPublic(logo.id)), 404);
  // A reviewer can look at it before deciding.
  const [grant] = await db
    .select()
    .from(s.taskReviewerGrants)
    .where(eq(s.taskReviewerGrants.reviewerId, reviewer));
  assert.ok(grant);
  const staff = await identity();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: staff.account,
    grantedBy: staff.account,
    reason: 'Files test',
    expiresAt: new Date(Date.now() + 3600000),
  });
  assert.equal(
    (await files.read(staff.user, logo.id)).contentType,
    'image/webp',
  );
  await admin.decideProfileChange(staff.user, change.id, {
    decision: 'applied',
    reason: 'Their own brand',
  });
  assert.equal((await edits.mine(owner.user)).logoFileId, logo.id);
  assert.equal((await files.readPublic(logo.id)).cache, 'public');
  // Another business cannot use this file as its logo.
  const copycat = await business('Copy Foods');
  assert.equal(
    await reason(
      edits.change(copycat.user, {
        id: randomUUID(),
        field: 'logo',
        value: logo.id,
      }),
    ),
    'profile_change_unavailable',
  );
});

async function job() {
  const owner = await business('Jobs Ltd');
  await fund(owner.account, 200n);
  const start = new Date(Date.now() + 400);
  const created = await sponsors.createTask(owner.user, {
    requestId: randomUUID(),
    title: 'Photo of our shop sign',
    instructions: 'Take a clear photo of our sign on Allen Avenue.',
    proofRequirements: 'A photo',
    rejectionCriteria: 'Blurry or wrong shop',
    model: 'capped_fixed',
    capacity: 1,
    rewardKobo: '200',
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3600000).toISOString(),
    workTerms: {
      reviewHours: 72,
      correctionHours: 48,
      appealHours: 168,
      settlement: 'approved_reward_backing',
    },
  });
  const [row] = await db
    .select()
    .from(s.sponsorTasks)
    .where(eq(s.sponsorTasks.id, created.id));
  await new TaskReviewService(db).decide(reviewer, {
    taskId: row!.id,
    requestId: randomUUID(),
    termsVersion: row!.termsVersion,
    termsHash: row!.requestHash,
    decision: 'approved',
    reason: 'Clear job',
    checklist: { ...taskReviewChecklist },
  });
  await work.publish(owner.user, created.id);
  await new Promise((r) =>
    setTimeout(r, Math.max(0, start.getTime() - Date.now() + 10)),
  );
  return { owner, id: created.id };
}

test('evidence is attached once, seen only by the people involved, and removed after 90 days', async () => {
  const { owner, id } = await job();
  const worker: Identity = await identity();
  const claim = await work.join(worker.user, id);
  const photo = await files.upload(worker.user, 'evidence', jpeg());
  const other = await identity();
  const theirs = await files.upload(other.user, 'evidence', jpeg());
  // Only your own evidence uploads can be attached.
  assert.equal(
    await reason(
      work.submit(worker.user, claim.id, {
        id: randomUUID(),
        revision: 1,
        evidence: 'Photo attached',
        files: [theirs.id],
      }),
    ),
    'evidence_unavailable',
  );
  const proof = await work.submit(worker.user, claim.id, {
    id: randomUUID(),
    revision: 1,
    evidence: 'Photo attached',
    files: [photo.id],
  });
  const view = await work.readClaim(owner.user, claim.id);
  assert.deepEqual(
    view.proofs[0]!.files.map((f) => f.id),
    [photo.id],
  );
  // The business sees it; strangers do not.
  assert.equal(
    (await files.read(owner.user, photo.id)).contentType,
    'image/jpeg',
  );
  assert.equal(await reason(files.read(other.user, photo.id)), 403);
  await work.decide(owner.user, proof.id, {
    id: randomUUID(),
    decision: 'approved',
    reason: 'Clear photo of the sign',
  });
  // After the decision, nothing can be added.
  const late = await files.upload(worker.user, 'evidence', jpeg());
  await assert.rejects(
    db
      .insert(s.taskProofFiles)
      .values({ proofId: proof.id, fileId: late.id, position: 2 }),
  );
  await assert.rejects(db.execute(sql`delete from task_proof_files`));
  // 90 days after the decision the file is removed.
  assert.equal((await files.purge()).removed, 0);
  await travel('91 days');
  try {
    const { removed } = await files.purge();
    assert.ok(removed >= 1);
  } finally {
    await travel('0');
  }
  assert.ok(!storage.objects.has(`evidence/${photo.id}`));
  assert.equal(await reason(files.read(worker.user, photo.id)), 410);
  const after = await work.readClaim(worker.user, claim.id);
  assert.equal(after.proofs[0]!.files[0]!.removed, true);
});
