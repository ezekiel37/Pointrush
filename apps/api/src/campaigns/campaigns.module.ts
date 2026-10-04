import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { PointsController } from '../points/points.controller.js';
import { PointsService } from '../points/points.service.js';

@Module({
  controllers: [CampaignsController, PointsController],
  providers: [
    {
      provide: CampaignsService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new CampaignsService(db.db),
    },
    {
      provide: PointsService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new PointsService(db.db),
    },
  ],
})
export class CampaignsModule {}
