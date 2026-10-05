import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { BusinessOverviewService } from './business-overview.service.js';
import { PointsController } from '../points/points.controller.js';
import { PointsService } from '../points/points.service.js';
import { ProfilesController } from '../points/profiles.controller.js';
import { ProfilesService } from '../points/profiles.service.js';
import { PromotionsController } from '../promotions/promotions.controller.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Module({
  controllers: [
    CampaignsController,
    PointsController,
    ProfilesController,
    PromotionsController,
    NotificationsController,
  ],
  providers: [
    {
      provide: NotificationsService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new NotificationsService(db.db),
    },
    {
      provide: CampaignsService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new CampaignsService(db.db),
    },
    {
      provide: BusinessOverviewService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new BusinessOverviewService(db.db),
    },
    {
      provide: PointsService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new PointsService(db.db),
    },
    {
      provide: ProfilesService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new ProfilesService(db.db),
    },
    {
      provide: PromotionsService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new PromotionsService(db.db),
    },
  ],
})
export class CampaignsModule {}
