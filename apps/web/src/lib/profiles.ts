import { z } from 'zod';

const date = z.iso.datetime({ offset: true });

export const handleCheck = z.object({
  available: z.boolean(),
  reason: z.enum(['invalid', 'taken', 'reserved']).nullable(),
  suggestion: z.string().nullable(),
});

export const businessDetails = z.object({
  id: z.uuid(),
  name: z.string(),
  contactEmail: z.string(),
  description: z.string().nullable(),
  logoFileId: z.string().nullable().default(null),
  handle: z.string().nullable(),
  since: date,
  canChangeHandle: z.boolean(),
  nameNeedsReview: z.boolean(),
  handles: z.array(z.object({ handle: z.string(), at: date })),
  changes: z.array(
    z.object({
      id: z.uuid(),
      field: z.string(),
      oldValue: z.string().nullable(),
      newValue: z.string().nullable(),
      state: z.enum(['applied', 'pending', 'rejected']),
      note: z.string().nullable(),
      at: date,
    }),
  ),
});

export const ratingItem = z.object({
  id: z.uuid(),
  stars: z.number(),
  comment: z.string().nullable(),
  by: z.string(),
  businessNameThen: z.string(),
  at: date,
  edited: z.boolean(),
  reply: z.object({ body: z.string(), at: date }).nullable(),
});
export const ratingSummary = z.object({
  count: z.number(),
  average: z.number().nullable(),
  stars: z.array(z.object({ stars: z.number(), count: z.number() })),
  recent: z.array(ratingItem),
});
export const myRating = z.object({
  canRate: z.boolean(),
  needsPhone: z.boolean(),
  rating: z
    .object({
      id: z.uuid(),
      stars: z.number(),
      comment: z.string().nullable(),
      removed: z.boolean(),
      editableUntil: date.nullable(),
      canEdit: z.boolean().default(false),
    })
    .nullable(),
});
export const businessRatings = z.object({
  summary: ratingSummary,
  items: z.array(
    ratingItem.extend({
      removed: z.boolean(),
      removedReason: z.string().nullable(),
    }),
  ),
});

export const publicBusiness = z.union([
  z.object({ redirect: z.string() }),
  z.object({
    handle: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    logoFileId: z.string().nullable().default(null),
    since: date,
    formerly: z.array(z.object({ name: z.string(), until: date })),
    offers: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        model: z.string(),
        rewardKobo: z.string(),
        endsAt: date,
      }),
    ),
    ratings: ratingSummary.default({
      count: 0,
      average: null,
      stars: [],
      recent: [],
    }),
  }),
]);

// Same rules as the API: 3–30 characters, lowercase letters, numbers and
// single underscores, starting with a letter.
export const handlePattern = /^[a-z][a-z0-9_]{1,28}[a-z0-9]$/;
export function cleanHandle(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase();
}
export function handleFromName(name: string) {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base && !/^[a-z]/.test(base)) base = `b_${base}`;
  return base.slice(0, 24).replace(/_+$/, '');
}
