import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { MemoryStorage, R2Storage } from './storage.js';
import type { FileStorage } from './storage.js';

export type StorageConfig =
  | { provider: 'memory' }
  | {
      provider: 'r2';
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
    };

export function fileStorage(config?: StorageConfig): FileStorage | undefined {
  if (config?.provider === 'memory') return new MemoryStorage();
  if (config?.provider === 'r2') return new R2Storage(config);
  return undefined;
}

@Module({})
export class FilesModule {
  static forRoot(storage?: FileStorage): DynamicModule {
    return {
      module: FilesModule,
      controllers: [FilesController],
      providers: [
        {
          provide: FilesService,
          inject: [DatabaseService],
          useFactory: (db: DatabaseService) => new FilesService(db.db, storage),
        },
      ],
      exports: [FilesService],
    };
  }
}
