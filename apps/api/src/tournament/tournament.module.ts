import { Module } from '@nestjs/common';

import { TournamentController } from './tournament.controller';

@Module({ controllers: [TournamentController] })
export class TournamentModule {}
