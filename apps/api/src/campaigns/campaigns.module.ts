import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';

@Module({
  controllers: [CampaignsController],
  providers: [
    {
      provide: CampaignsService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new CampaignsService(db.db),
    },
  ],
})
export class CampaignsModule {}
