import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CatchesService } from './catches.service';
import {
  CatchIdDto,
  CollectCatchDto,
  CreateCatchDto,
  LikeCatchDto,
  ListCatchesDto,
} from './dto/catches.dto';

@Controller('catches')
export class CatchesController {
  constructor(private readonly catchesService: CatchesService) {}

  @Post('list')
  list(@CurrentUserId() userId: bigint, @Body() dto: ListCatchesDto) {
    return this.catchesService.list(userId, dto);
  }

  @Post('create')
  create(@CurrentUserId() userId: bigint, @Body() dto: CreateCatchDto) {
    return this.catchesService.create(userId, dto);
  }

  @Post('detail')
  detail(@CurrentUserId() userId: bigint, @Body() dto: CatchIdDto) {
    return this.catchesService.detail(userId, dto);
  }

  @Post('like')
  like(@CurrentUserId() userId: bigint, @Body() dto: LikeCatchDto) {
    return this.catchesService.like(userId, dto);
  }

  @Post('collect')
  collect(@CurrentUserId() userId: bigint, @Body() dto: CollectCatchDto) {
    return this.catchesService.collect(userId, dto);
  }
}
