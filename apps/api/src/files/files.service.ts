import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { safeErrorSummary } from '../database/safe-error.js';
import { actorTransaction } from '../tasks/actor-transaction.js';
import { clean, detect, FileRejected } from './inspect.js';
import type { FileKind } from './inspect.js';
import type { FileStorage } from './storage.js';

type Row = Record<string, unknown>;
const rows = (result: unknown) =>
  ((result as { rows?: Row[] }).rows ?? (result as Row[])) as Row[];

export type Purpose = 'avatar' | 'logo' | 'evidence';
const purposes: Record<Purpose, { types: FileKind[]; maxBytes: number }> = {
  avatar: {
    types: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 2 * 1024 * 1024,
  },
  logo: {
    types: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 2 * 1024 * 1024,
  },
  evidence: {
    types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    maxBytes: 5 * 1024 * 1024,
  },
};
// Evidence is kept 90 days after the decision (and any appeal), then
// removed. Uploads never attached to anything go after 7 days.
export const EVIDENCE_KEEP_DAYS = 90;

const rejected = (message: string) =>
  new BadRequestException({
    statusCode: 400,
    message,
    reason: 'file_rejected',
  });

// Uploads go through the API, which checks and cleans each file before it
// is stored, and decides who may see it.
export class FilesService {
  constructor(
    private readonly db: FundingDatabase,
    private readonly storage?: FileStorage,
  ) {}

  private requireStorage() {
    if (!this.storage)
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Uploads are not available yet',
        reason: 'storage_unavailable',
      });
    return this.storage;
  }

  async upload(user: string, purposeInput: unknown, body: unknown) {
    const storage = this.requireStorage();
    const purpose = z
      .enum(['avatar', 'logo', 'evidence'])
      .safeParse(purposeInput);
    if (!purpose.success) throw new BadRequestException('Unknown upload kind');
    const rules = purposes[purpose.data];
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw rejected('Choose a JPEG, PNG, WebP or PDF file');
    if (body.length > rules.maxBytes)
      throw new PayloadTooLargeException(
        `Files can be at most ${rules.maxBytes / 1024 / 1024} MB`,
      );
    const kind = detect(body);
    if (!kind || !rules.types.includes(kind))
      throw rejected(
        purpose.data === 'evidence'
          ? 'Upload a JPEG, PNG or WebP photo, or a PDF'
          : 'Upload a JPEG, PNG or WebP picture',
      );
    let cleaned: Buffer;
    try {
      cleaned = clean(body, kind);
    } catch (error) {
      if (error instanceof FileRejected)
        throw rejected('This file could not be read. Try another one.');
      throw error;
    }
    const id = randomUUID();
    const sha256 = createHash('sha256').update(cleaned).digest('hex');
    return actorTransaction(this.db, user, async (tx, actor) => {
      await tx.execute(sql`
        insert into files (id, owner_id, purpose, content_type, size_bytes, sha256)
        values (${id}, ${actor}, ${purpose.data}, ${kind}, ${cleaned.length}, ${sha256})`);
      // Stored before the record commits; if storage fails nothing is saved.
      await storage.put(`${purpose.data}/${id}`, cleaned, kind);
      return {
        id,
        purpose: purpose.data,
        contentType: kind,
        sizeBytes: cleaned.length,
      };
    });
  }

  private async row(id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException();
    const [file] = rows(
      await this.db.execute(sql`
        select f.*, exists (select 1 from file_deletions d where d.file_id = f.id) as deleted,
          exists (select 1 from sponsor_profiles sp where sp.logo_file_id = f.id) as live_logo,
          exists (select 1 from accounts a where (select aa.file_id from account_avatars aa
            where aa.account_id = a.id order by aa.created_at desc, aa.id desc limit 1) = f.id) as live_avatar
        from files f where f.id = ${id}`),
    );
    if (!file) throw new NotFoundException();
    return file;
  }

  private async bytes(file: Row) {
    if (file.deleted)
      throw new GoneException('This file was removed after its keeping time');
    const body = await this.requireStorage().get(
      `${String(file.purpose)}/${String(file.id)}`,
    );
    if (!body) throw new NotFoundException();
    return { contentType: String(file.content_type), body };
  }

  // Profile pictures and approved logos anyone may see.
  async readPublic(id: string) {
    const file = await this.row(id);
    if (!(file.live_logo || file.live_avatar)) throw new NotFoundException();
    return { ...(await this.bytes(file)), cache: 'public' as const };
  }

  // Everything else needs a reason to see it: your own file, evidence for a
  // job at your business, or a reviewer checking it.
  async read(user: string, id: string) {
    const file = await this.row(id);
    const allowed = await actorTransaction(this.db, user, async (tx, actor) => {
      if (file.owner_id === actor || file.live_logo || file.live_avatar)
        return true;
      const [r] = rows(
        await tx.execute(sql`
          select staff_reviewer_active(${actor})
              -- Independent appeal reviewers see evidence on appealed proofs.
              or exists (select 1 from appeal_reviewer_grants g join task_proof_files pf on pf.file_id = ${id}
                join task_appeals a on a.proof_id = pf.proof_id
                where g.account_id = ${actor} and g.revoked_at is null and g.expires_at > clock_timestamp())
              as reviewer,
            exists (select 1 from task_proof_files pf join task_proofs p on p.id = pf.proof_id
              join task_claims c on c.id = p.claim_id join sponsor_tasks t on t.id = c.task_id
              join sponsor_profiles sp on sp.id = t.sponsor_id
              where pf.file_id = ${id} and sp.owner_id = ${actor}) as sponsor`),
      );
      return Boolean(r?.reviewer || r?.sponsor);
    });
    if (!allowed) throw new ForbiddenException();
    return { ...(await this.bytes(file)), cache: 'private' as const };
  }

  async avatar(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [r] = rows(
        await tx.execute(sql`
          select file_id from account_avatars where account_id = ${actor}
          order by created_at desc, id desc limit 1`),
      );
      return { fileId: r?.file_id == null ? null : String(r.file_id) };
    });
  }

  async setAvatar(user: string, input: unknown) {
    const parsed = z
      .object({ fileId: z.uuid().nullable() })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw new BadRequestException('Choose a picture');
    return actorTransaction(this.db, user, async (tx, actor) => {
      await tx.execute(sql`
        insert into account_avatars (id, account_id, file_id)
        values (${randomUUID()}, ${actor}, ${parsed.data.fileId})`);
      return { fileId: parsed.data.fileId };
    });
  }

  // Removes evidence past its keeping time and uploads never used.
  async purge(limit = 50) {
    if (!this.storage) return { removed: 0 };
    const due = rows(
      await this.db.execute(sql`
        select f.id, f.purpose from files f
        where not exists (select 1 from file_deletions d where d.file_id = f.id)
          and (
            (f.purpose = 'evidence' and exists (
              select 1 from task_proof_files pf join proof_decisions dec on dec.proof_id = pf.proof_id
              where pf.file_id = f.id
                and dec.created_at < clock_timestamp() - make_interval(days => ${EVIDENCE_KEEP_DAYS})
                and not exists (select 1 from task_appeals a where a.proof_id = pf.proof_id
                  and not exists (select 1 from appeal_resolutions r where r.appeal_id = a.id
                    and r.created_at < clock_timestamp() - make_interval(days => ${EVIDENCE_KEEP_DAYS}))))
            )
            or (f.created_at < clock_timestamp() - interval '7 days'
              and not exists (select 1 from task_proof_files pf where pf.file_id = f.id)
              and not exists (select 1 from account_avatars aa where aa.file_id = f.id)
              and not exists (select 1 from business_profile_changes c where c.field = 'logo' and c.new_value = f.id::text))
          )
        order by f.created_at limit ${limit}`),
    );
    let removed = 0;
    for (const file of due) {
      try {
        await this.storage.delete(`${String(file.purpose)}/${String(file.id)}`);
        await this.db.execute(sql`
          insert into file_deletions (file_id, reason)
          values (${String(file.id)}, ${file.purpose === 'evidence' ? 'Kept for 90 days after the decision' : 'Never used'})
          on conflict do nothing`);
        removed += 1;
      } catch (error) {
        process.stderr.write(
          JSON.stringify({
            level: 'warn',
            event: 'file_purge_failed',
            cause: safeErrorSummary(error),
          }) + '\n',
        );
      }
    }
    return { removed };
  }
}
