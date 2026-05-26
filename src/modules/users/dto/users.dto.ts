import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

/** 钓龄段枚举。前端展示成中文标签,后端只存 code。 */
export const FISHING_AGE_BANDS = [
  'within_1y',
  '1_3y',
  '3_5y',
  '5y_plus',
] as const;

export class UpdateMeDto {
  // ─── 基本资料 ──────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @Length(1, 32)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  avatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  city?: string;

  // 0=未知/1=男/2=女(与 schema gender 字段对齐)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  gender?: number;

  // ─── 钓鱼偏好 ──────────────────────────────────────────────────
  @IsOptional()
  @IsIn(FISHING_AGE_BANDS as unknown as string[])
  fishingAgeBand?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  playStyles?: string[];

  // ─── 隐私开关 ──────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  allowNearby?: boolean;

  @IsOptional()
  @IsBoolean()
  allowShowLoc?: boolean;
}
