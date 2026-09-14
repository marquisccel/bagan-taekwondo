import { Module } from '@nestjs/common';

import { DrawRunController } from './draw-run.controller';

@Module({ controllers: [DrawRunController] })
export class DrawRunModule {}
