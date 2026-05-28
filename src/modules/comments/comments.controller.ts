import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CommentsService } from './comments.service';
import {
  CommentIdDto,
  CreateCommentDto,
  LikeCommentDto,
  ListCommentsDto,
} from './dto/comments.dto';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('list')
  list(@CurrentUserId() userId: bigint, @Body() dto: ListCommentsDto) {
    return this.commentsService.list(userId, dto);
  }

  @Post('create')
  create(@CurrentUserId() userId: bigint, @Body() dto: CreateCommentDto) {
    return this.commentsService.create(userId, dto);
  }

  @Post('remove')
  remove(@CurrentUserId() userId: bigint, @Body() dto: CommentIdDto) {
    return this.commentsService.remove(userId, dto);
  }

  @Post('like')
  like(@CurrentUserId() userId: bigint, @Body() dto: LikeCommentDto) {
    return this.commentsService.like(userId, dto);
  }
}
