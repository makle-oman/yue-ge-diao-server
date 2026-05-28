import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { TeamsService } from './teams.service';
import {
  ApplyTeamDto,
  CreateTeamDto,
  ListTeamsDto,
  ReviewMemberDto,
  TeamIdDto,
} from './dto/teams.dto';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post('list')
  list(@CurrentUserId() userId: bigint, @Body() dto: ListTeamsDto) {
    return this.teamsService.list(userId, dto);
  }

  @Post('detail')
  detail(@CurrentUserId() userId: bigint, @Body() dto: TeamIdDto) {
    return this.teamsService.detail(userId, dto);
  }

  @Post('create')
  create(@CurrentUserId() userId: bigint, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(userId, dto);
  }

  @Post('apply')
  apply(@CurrentUserId() userId: bigint, @Body() dto: ApplyTeamDto) {
    return this.teamsService.apply(userId, dto);
  }

  @Post('cancel-apply')
  cancelApply(@CurrentUserId() userId: bigint, @Body() dto: TeamIdDto) {
    return this.teamsService.cancelApply(userId, dto);
  }

  @Post('review')
  review(@CurrentUserId() userId: bigint, @Body() dto: ReviewMemberDto) {
    return this.teamsService.review(userId, dto);
  }
}
