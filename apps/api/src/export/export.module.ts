import { Module } from '@nestjs/common';

import { ExportController } from './export.controller';
import { ExportStorageModule } from './export-storage.module';

@Module({
  imports: [ExportStorageModule],
  controllers: [ExportController],
})
export class ExportModule {}
