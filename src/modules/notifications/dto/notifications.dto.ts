import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 通知类型(与 service emit 函数严格对应)
 * - catch_like      别人赞了你的鱼获
 * - catch_collect   别人收藏了你的鱼获
 * - catch_comment   别人评论了你的鱼获(一级评论)
 * - comment_reply   别人回复了你的评论
 * - comment_like    别人赞了你的评论
 * - team_apply              有人申请加入你的组队
 * - team_review_approved    你的申请被通过
 * - team_review_rejected    你的申请被拒绝
 * - team_member_left        队员退队
 */
export const NOTIFICATION_TYPES = [
  'catch_like',
  'catch_collect',
  'catch_comment',
  'comment_reply',
  'comment_like',
  'team_apply',
  'team_review_approved',
  'team_review_rejected',
  'team_member_left',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** 顶层分组(消息页 4 个入口) */
export const NOTIFICATION_GROUPS = ['comment', 'like', 'team', 'system'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export class ListNotificationsDto {
  @IsOptional()
  @IsIn(NOTIFICATION_GROUPS as unknown as string[])
  group?: NotificationGroup;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES as unknown as string[])
  type?: NotificationType;

  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;
}

export class MarkReadDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Length(1, 32, { each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_GROUPS as unknown as string[])
  group?: NotificationGroup;
}
