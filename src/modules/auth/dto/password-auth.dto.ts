import { IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class PasswordAuthDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^1[3-9]\d{9}$/)
  phone!: string;

  @IsString()
  @Length(6, 32)
  password!: string;
}

export class PasswordRegisterDto extends PasswordAuthDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;
}
