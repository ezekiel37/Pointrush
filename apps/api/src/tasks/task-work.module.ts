import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { TaskWorkService } from './task-work.service.js';
import { TaskWorkController } from './task-work.controller.js';
@Module({
  controllers: [TaskWorkController],
  providers: [
    {
      provide: TaskWorkService,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new TaskWorkService(db.db),
    },
  ],
})
export class TaskWorkModule {}
