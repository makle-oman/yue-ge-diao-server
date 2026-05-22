import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DevLoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  openid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;
}
