import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export const FAVORITE_LIST_TYPES = ['spot', 'user'] as const;
export const FAVORITE_KINDS = ['spot', 'catch', 'user'] as const;

export class ListFavoritesDto {
  @IsOptional()
  @IsIn(FAVORITE_LIST_TYPES as unknown as string[])
  type?: (typeof FAVORITE_LIST_TYPES)[number];

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

export class RemoveFavoriteDto {
  @IsIn(FAVORITE_KINDS as unknown as string[])
  kind!: (typeof FAVORITE_KINDS)[number];

  @IsString()
  @Length(1, 32)
  id!: string;
}
