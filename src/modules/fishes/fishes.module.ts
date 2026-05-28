import { Module } from '@nestjs/common';
import { FishesController } from './fishes.controller';
import { FishesService } from './fishes.service';

@Module({
  controllers: [FishesController],
  providers: [FishesService],
})
export class FishesModule {}
