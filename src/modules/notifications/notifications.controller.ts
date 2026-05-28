import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  ListNotificationsDto,
  MarkReadDto,
} from './dto/notifications.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('list')
  list(@CurrentUserId() userId: bigint, @Body() dto: ListNotificationsDto) {
    return this.notificationsService.list(userId, dto);
  }

  @Post('unread-count')
  unreadCount(@CurrentUserId() userId: bigint) {
    return this.notificationsService.unreadCount(userId);
  }

  @Post('read')
  read(@CurrentUserId() userId: bigint, @Body() dto: MarkReadDto) {
    return this.notificationsService.markRead(userId, dto);
  }
}
