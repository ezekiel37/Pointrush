import { Controller, Get, Inject } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { readSettings } from './settings.js';

// What signed-in people need to see: the minimums forms enforce and what
// the referral programmes pay. Never who changed them or why.
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  @Get('limits')
  async limits() {
    const s = await readSettings(this.database.db);
    const on = (kind: 'friend' | 'business') =>
      s.referrals.enabled && s.referrals[kind].enabled;
    return {
      funding: s.funding,
      campaigns: s.campaigns,
      newBusinesses: s.newBusinesses,
      withdrawals: s.withdrawals,
      newAccounts: s.newAccounts,
      referrals: {
        friend: on('friend')
          ? {
              rewardKobo: s.referrals.friend.rewardKobo,
              maxPercent: s.referrals.friend.maxPercent,
              minQualifyingKobo: s.referrals.friend.minQualifyingKobo,
            }
          : null,
        business: on('business')
          ? {
              rewardKobo: s.referrals.business.rewardKobo,
              maxPercent: s.referrals.business.maxPercent,
              minFundingKobo: s.referrals.business.minFundingKobo,
              minPaidOutKobo: s.referrals.business.minPaidOutKobo,
              minCustomers: s.referrals.business.minCustomers,
            }
          : null,
        monthlyCount: s.referrals.monthlyCount,
      },
    };
  }
}
