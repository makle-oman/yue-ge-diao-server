import { IsIn, IsOptional } from 'class-validator';

export const FISH_CATEGORIES = ['fresh', 'sea'] as const;

export class FishLibraryDto {
  @IsOptional()
  @IsIn(FISH_CATEGORIES as unknown as string[])
  category?: (typeof FISH_CATEGORIES)[number];
}
