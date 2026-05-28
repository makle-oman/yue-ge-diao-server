import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { FishLibraryDto } from './dto/fishes.dto';
import { FishesService } from './fishes.service';

@Controller('fishes')
export class FishesController {
  constructor(private readonly fishesService: FishesService) {}

  @Public()
  @Post('list')
  list(@Body() dto: FishLibraryDto) {
    return this.fishesService.listCatalog(dto);
  }

  @Post('library')
  library(@CurrentUserId() userId: bigint, @Body() dto: FishLibraryDto) {
    return this.fishesService.library(userId, dto);
  }

  @Post('library-progress')
  progress(@CurrentUserId() userId: bigint) {
    return this.fishesService.progress(userId);
  }
}
