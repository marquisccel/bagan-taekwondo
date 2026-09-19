import { Module } from '@nestjs/common';

import { DrawPreflightController } from './draw-preflight.controller';
import { EntryInspectionController } from './entry-inspection.controller';
import { TournamentController } from './tournament.controller';
import { TournamentListController } from './tournament-list.controller';

@Module({
  controllers: [
    TournamentListController,
    TournamentController,
    EntryInspectionController,
    DrawPreflightController,
  ],
})
export class TournamentModule {}
