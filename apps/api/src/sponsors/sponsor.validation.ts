import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) =>
      Array.from(value).every(
        (character) =>
          !/\p{Cc}/u.test(character) || '\n\r\t'.includes(character),
      ),
    );
export const sponsorInput = z
  .object({
    name: plain(120),
    termsVersion: plain(80),
    acceptTerms: z.literal(true),
  })
  .strict();
const money = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .transform(BigInt)
  .refine((n) => n <= 9223372036854775807n);
export const taskInput = z
  .object({
    requestId: z.uuid(),
    title: plain(160),
    instructions: plain(10000),
    proofRequirements: plain(5000),
    rejectionCriteria: plain(5000),
    model: z.enum(['capped_fixed', 'selected_assignment']),
    capacity: z.number().int().positive().max(2147483647),
    rewardKobo: money,
    startsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    endsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  })
  .strict()
  .refine(
    (v) =>
      v.endsAt > v.startsAt &&
      v.rewardKobo * BigInt(v.capacity) <= 9223372036854775807n,
  );
export function parseSponsorInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException('Invalid sponsor or task input');
  return result.data;
}
