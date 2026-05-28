import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const COMMENT_SORTS = ['hot', 'new'] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

export class ListCommentsDto {
  @IsString()
  @Length(1, 32)
  catchId!: string;

  @IsOptional()
  @IsIn(COMMENT_SORTS as unknown as string[])
  sort?: CommentSort;

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

export class CreateCommentDto {
  @IsString()
  @Length(1, 32)
  catchId!: string;

  @IsString()
  @Length(1, 500)
  content!: string;

  // 二级回复时传父评论 id（一级评论传空）；只允许两层拍平：parent 自身不能再有 parent
  @IsOptional()
  @IsString()
  @Length(1, 32)
  parentId?: string;
}

export class CommentIdDto {
  @IsString()
  @Length(1, 32)
  commentId!: string;
}

export class LikeCommentDto extends CommentIdDto {
  @IsIn(['like', 'unlike'])
  action!: 'like' | 'unlike';
}
