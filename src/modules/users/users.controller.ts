import { Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('me')
  me(@CurrentUserId() userId: bigint) {
    return this.usersService.findMe(userId);
  }
}
