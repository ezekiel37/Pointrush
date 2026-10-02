import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { DatabaseService } from '../database/database.service.js';
import { ReviewsController } from './reviews.controller.js';
import { TaskReviewService } from './task-review.service.js';

@Module({
  imports: [AccountsModule],
  controllers: [ReviewsController],
  providers: [
    {
      provide: TaskReviewService,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new TaskReviewService(database.db),
    },
  ],
})
export class ReviewsModule {}
