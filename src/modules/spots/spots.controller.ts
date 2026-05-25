import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import {
  CreateSpotDto,
  ListSpotsDto,
  NearbySpotsDto,
  SearchSpotsDto,
  SpotHistoryDto,
  SpotIdDto,
  WantSpotDto,
} from './dto/spots.dto';
import { SpotsService } from './spots.service';

@Controller('spots')
export class SpotsController {
  constructor(private readonly spotsService: SpotsService) {}

  @Public()
  @Post('list')
  list(@Body() dto: ListSpotsDto) {
    return this.spotsService.list(dto);
  }

  @Public()
  @Post('nearby')
  nearby(@Body() dto: NearbySpotsDto) {
    return this.spotsService.nearby(dto);
  }

  @Public()
  @Post('search')
  search(@Body() dto: SearchSpotsDto) {
    return this.spotsService.search(dto);
  }

  @Post('detail')
  detail(@CurrentUserId() userId: bigint, @Body() dto: SpotIdDto) {
    return this.spotsService.detail(userId, dto);
  }

  @Post('create')
  create(@CurrentUserId() userId: bigint, @Body() dto: CreateSpotDto) {
    return this.spotsService.create(userId, dto);
  }

  @Post('want')
  want(@CurrentUserId() userId: bigint, @Body() dto: WantSpotDto) {
    return this.spotsService.want(userId, dto);
  }

  @Public()
  @Post('history')
  history(@Body() dto: SpotHistoryDto) {
    return this.spotsService.history(dto);
  }
}
