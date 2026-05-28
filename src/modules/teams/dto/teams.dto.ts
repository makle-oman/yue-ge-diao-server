import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TEAM_FILTERS = ['nearby', 'weekend', 'carpool', 'all'] as const;
export type TeamFilter = (typeof TEAM_FILTERS)[number];

export const COST_MODES = ['aa', 'host', 'self'] as const;
export type CostMode = (typeof COST_MODES)[number];

export const TEAM_STATUSES = [
  'recruiting',
  'full',
  'started',
  'ended',
  'cancelled',
] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export const MEMBER_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export class ListTeamsDto {
  @IsOptional()
  @IsIn(TEAM_FILTERS as unknown as string[])
  filter?: TeamFilter;

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

export class CreateTeamDto {
  @IsString()
  @Length(1, 32)
  spotId!: string;

  @IsISO8601()
  startTime!: string;

  @IsISO8601()
  endTime!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(1, 12, { each: true })
  targetFish?: string[];

  @IsInt()
  @Min(2)
  @Max(20)
  @Type(() => Number)
  maxPeople!: number;

  @IsIn(COST_MODES as unknown as string[])
  costMode!: CostMode;

  @IsOptional()
  @IsBoolean()
  needCarpool?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class TeamIdDto {
  @IsString()
  @Length(1, 32)
  teamId!: string;
}

export class ApplyTeamDto extends TeamIdDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  message?: string;
}

export class ReviewMemberDto extends TeamIdDto {
  @IsString()
  @Length(1, 32)
  userId!: string;

  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';
}

export class UserTeamsDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  userId?: string;

  @IsOptional()
  @IsIn(['owner', 'joined', 'all'])
  role?: 'owner' | 'joined' | 'all';

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
