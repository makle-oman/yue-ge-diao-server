import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import {
  MessageHistoryDto,
  MessageThreadsDto,
  SendMessageDto,
} from './dto/messages.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('threads')
  threads(@CurrentUserId() userId: bigint, @Body() dto: MessageThreadsDto) {
    return this.messagesService.threads(userId, dto);
  }

  @Post('history')
  history(@CurrentUserId() userId: bigint, @Body() dto: MessageHistoryDto) {
    return this.messagesService.history(userId, dto);
  }

  @Post('send')
  send(@CurrentUserId() userId: bigint, @Body() dto: SendMessageDto) {
    return this.messagesService.send(userId, dto);
  }
}
