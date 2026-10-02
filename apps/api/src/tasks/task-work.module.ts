import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { TaskWorkService } from './task-work.service.js';
import { TaskWorkController } from './task-work.controller.js';
import { TaskQueriesService } from './task-queries.service.js';
import { TaskQueriesController } from './task-queries.controller.js';
@Module({
  controllers: [TaskQueriesController, TaskWorkController],
  providers: [
    {
      provide: TaskQueriesService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new TaskQueriesService(db.db),
    },
    {
      provide: TaskWorkService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new TaskWorkService(db.db),
    },
  ],
})
export class TaskWorkModule {}
