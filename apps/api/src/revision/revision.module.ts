import { Module } from '@nestjs/common';

import { RevisionController } from './revision.controller';
import { RevisionReadController } from './revision-read.controller';

@Module({ controllers: [RevisionController, RevisionReadController] })
export class RevisionModule {}
