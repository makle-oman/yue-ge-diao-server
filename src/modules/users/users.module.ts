import { Module } from '@nestjs/common';
import { CatchesModule } from '../catches/catches.module';
import { SpotsModule } from '../spots/spots.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [CatchesModule, SpotsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
