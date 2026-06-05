import { IsIn, IsOptional } from 'class-validator';

export const FISH_CATEGORIES = ['fresh', 'sea'] as const;
export const FISH_LIBRARY_FILTERS = ['all', 'common', 'rare', 'locked'] as const;

export class FishLibraryDto {
  @IsOptional()
  @IsIn(FISH_CATEGORIES as unknown as string[])
  category?: (typeof FISH_CATEGORIES)[number];

  @IsOptional()
  @IsIn(FISH_LIBRARY_FILTERS as unknown as string[])
  filter?: (typeof FISH_LIBRARY_FILTERS)[number];
}
