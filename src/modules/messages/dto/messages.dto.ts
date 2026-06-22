import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class MessageThreadsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;
}

export class MessageHistoryDto {
  @IsString()
  @Length(1, 32)
  peerId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;
}

export class SendMessageDto {
  @IsString()
  @Length(1, 32)
  toUserId!: string;

  @IsOptional()
  @IsIn(['text', 'location', 'image', 'video'])
  type?: 'text' | 'location' | 'image' | 'video';

  @IsString()
  @MaxLength(1000)
  content!: string;
}
