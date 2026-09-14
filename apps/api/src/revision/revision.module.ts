import { Module } from '@nestjs/common';

import { RevisionController } from './revision.controller';

@Module({ controllers: [RevisionController] })
export class RevisionModule {}
