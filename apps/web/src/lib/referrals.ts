import { z } from 'zod';
import { money } from './api';

export const myReferrals = z.object({
  username: z.string().nullable(),
  phoneVerified: z.boolean(),
  invited: z.number(),
  rewarded: z.number(),
  earnedKobo: money,
  people: z.array(
    z.object({
      username: z.string().nullable(),
      business: z.boolean(),
      earnedKobo: money,
      joinedAt: z.iso.datetime({ offset: true }),
    }),
  ),
});
