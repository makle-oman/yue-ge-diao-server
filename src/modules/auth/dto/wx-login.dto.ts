import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class WxLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  avatar?: string;
}
