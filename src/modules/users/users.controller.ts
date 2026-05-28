import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CatchesService } from '../catches/catches.service';
import {
  UserCatchesDto,
  UserCatchesStatsDto,
} from '../catches/dto/catches.dto';
import { SpotsService } from '../spots/spots.service';
import { UserSpotsDto, UserSpotsStatsDto } from '../spots/dto/spots.dto';
import { TeamsService } from '../teams/teams.service';
import { UserTeamsDto } from '../teams/dto/teams.dto';
import { FollowUserDto, NearbyUsersDto, UpdateMeDto, UserIdDto } from './dto/users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly catchesService: CatchesService,
    private readonly spotsService: SpotsService,
    private readonly teamsService: TeamsService,
  ) {}

  @Post('me')
  me(@CurrentUserId() userId: bigint) {
    return this.usersService.findMe(userId);
  }

  // 更新个人资料(部分字段),返回更新后的 MeProfile(等同于 /users/me)
  @Post('update')
  update(@CurrentUserId() userId: bigint, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(userId, dto);
  }

  @Post('detail')
  detail(@CurrentUserId() userId: bigint, @Body() dto: UserIdDto) {
    return this.usersService.detail(userId, dto);
  }

  @Post('nearby')
  nearby(@CurrentUserId() userId: bigint, @Body() dto: NearbyUsersDto) {
    return this.usersService.nearby(userId, dto);
  }

  @Post('follow')
  follow(@CurrentUserId() userId: bigint, @Body() dto: FollowUserDto) {
    return this.usersService.follow(userId, dto);
  }

  // 我的（或他人的）鱼获列表：复用 CatchesService.listForUser，
  // 同样的实现也支持「看别人的公开鱼获」（看别人时强制 locationVisible=true）。
  @Post('catches')
  catches(@CurrentUserId() userId: bigint, @Body() dto: UserCatchesDto) {
    return this.catchesService.listForUser(userId, dto);
  }

  // 鱼获档案聚合：total / monthCount / monthAdd / heaviest
  @Post('catches/stats')
  catchesStats(
    @CurrentUserId() userId: bigint,
    @Body() dto: UserCatchesStatsDto,
  ) {
    return this.catchesService.statsForUser(userId, dto);
  }

  // 我的（或他人的）钓点列表：复用 SpotsService.listForUser
  // tab: all|published|review；自看含 pending/rejected，看他人只 approved
  @Post('spots')
  spots(@CurrentUserId() userId: bigint, @Body() dto: UserSpotsDto) {
    return this.spotsService.listForUser(userId, dto);
  }

  // 钓点档案聚合：total / reviewing / monthAdd / hottest
  @Post('spots/stats')
  spotsStats(@CurrentUserId() userId: bigint, @Body() dto: UserSpotsStatsDto) {
    return this.spotsService.statsForUser(userId, dto);
  }

  // 我的（或他人的）组队列表：owner / joined / all
  @Post('teams')
  teams(@CurrentUserId() userId: bigint, @Body() dto: UserTeamsDto) {
    return this.teamsService.listForUser(userId, dto);
  }
}
