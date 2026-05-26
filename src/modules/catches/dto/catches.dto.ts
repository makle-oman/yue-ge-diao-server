import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const FEED_TABS = ['recommend', 'nearby', 'follow'] as const;
export const TECHNIQUES = ['hand', 'taiwan', 'lure', 'sea', 'other'] as const;

export class ListCatchesDto {
  @IsIn(FEED_TABS as unknown as string[])
  tab!: (typeof FEED_TABS)[number];

  @IsOptional()
  @IsLatitude()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsLongitude()
  @Type(() => Number)
  lng?: number;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(200_000)
  @Type(() => Number)
  radius?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

export class CreateCatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @IsString({ each: true })
  photos!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  fishSpecies!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500_000)
  @Type(() => Number)
  weight?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  length?: number;

  @IsOptional()
  @IsIn(TECHNIQUES as unknown as string[])
  technique?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bait?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  spotId?: string;

  @IsOptional()
  @IsLatitude()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsLongitude()
  @Type(() => Number)
  lng?: number;

  @IsOptional()
  @IsBoolean()
  locationVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  allowComments?: boolean;
}

export class CatchIdDto {
  @IsString()
  @Length(1, 32)
  catchId!: string;
}

export class LikeCatchDto extends CatchIdDto {
  @IsIn(['like', 'unlike'])
  action!: 'like' | 'unlike';
}

export class CollectCatchDto extends CatchIdDto {
  @IsIn(['collect', 'uncollect'])
  action!: 'collect' | 'uncollect';
}

export class UserCatchesDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  userId?: string;

  @IsOptional()
  @IsIn(['all', 'public', 'private'])
  visibility?: 'all' | 'public' | 'private';

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

export class UserCatchesStatsDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  userId?: string;
}
