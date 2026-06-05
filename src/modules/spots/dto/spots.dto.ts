import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const SPOT_TYPES = ['wild', 'black', 'paid', 'sea'] as const;
export const WATER_TYPES = ['river', 'lake', 'reservoir', 'pond', 'sea'] as const;

export class GeoQueryDto {
  @IsLatitude()
  @Type(() => Number)
  lat!: number;

  @IsLongitude()
  @Type(() => Number)
  lng!: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(200_000)
  @Type(() => Number)
  radius?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class ListSpotsDto extends GeoQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  city?: string;

  @IsOptional()
  @IsIn(SPOT_TYPES as unknown as string[])
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

export class NearbySpotsDto extends GeoQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  city?: string;

  @IsOptional()
  @IsIn(SPOT_TYPES as unknown as string[])
  type?: string;

  @IsOptional()
  @IsIn(WATER_TYPES as unknown as string[])
  waterType?: string;
}

export class SpotCitiesDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  keyword?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;
}

export class SearchSpotsDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  keyword?: string;

  @IsOptional()
  @IsIn(SPOT_TYPES as unknown as string[])
  type?: string;

  @IsOptional()
  @IsIn(WATER_TYPES as unknown as string[])
  waterType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  city?: string;

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
  @Min(100)
  @Max(200_000)
  @Type(() => Number)
  radius?: number;

  @IsOptional()
  @IsBoolean()
  hasParking?: boolean;

  @IsOptional()
  @IsBoolean()
  hasToilet?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  @Type(() => Number)
  minRating?: number;

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

export class SpotIdDto {
  @IsString()
  @Length(1, 32)
  spotId!: string;
}

export class FacilitiesDto {
  @IsOptional()
  @IsBoolean()
  park?: boolean;

  @IsOptional()
  @IsBoolean()
  toilet?: boolean;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;
}

export class CreateSpotDto {
  @IsString()
  @Length(1, 64)
  name!: string;

  @IsIn(SPOT_TYPES as unknown as string[])
  type!: string;

  @IsOptional()
  @IsIn(WATER_TYPES as unknown as string[])
  waterType?: string;

  @IsLatitude()
  @Type(() => Number)
  lat!: number;

  @IsLongitude()
  @Type(() => Number)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  @Type(() => Number)
  accuracy?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  fishSpecies?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FacilitiesDto)
  facilities?: FacilitiesDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  photos?: string[];
}

export class UpdateSpotDto extends SpotIdDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @IsOptional()
  @IsIn(SPOT_TYPES as unknown as string[])
  type?: string;

  @IsOptional()
  @IsIn(WATER_TYPES as unknown as string[])
  waterType?: string;

  @IsOptional()
  @IsLatitude()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsLongitude()
  @Type(() => Number)
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  @Type(() => Number)
  accuracy?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  fishSpecies?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FacilitiesDto)
  facilities?: FacilitiesDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  photos?: string[];
}

export class WantSpotDto extends SpotIdDto {
  @IsIn(['want', 'unwant'])
  action!: 'want' | 'unwant';
}

export class SpotHistoryDto extends SpotIdDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  days?: number;

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

export const USER_SPOT_TABS = ['all', 'published', 'review'] as const;

export class UserSpotsDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  userId?: string;

  @IsOptional()
  @IsIn(USER_SPOT_TABS as unknown as string[])
  tab?: (typeof USER_SPOT_TABS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  keyword?: string;

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

export class UserSpotsStatsDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  userId?: string;
}
