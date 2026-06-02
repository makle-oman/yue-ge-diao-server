import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { DevLoginDto } from './dto/dev-login.dto';
import { PasswordAuthDto, PasswordRegisterDto } from './dto/password-auth.dto';
import { RefreshDto } from './dto/refresh.dto';
import { WxLoginDto } from './dto/wx-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('dev-login')
  devLogin(@Body() dto: DevLoginDto) {
    return this.authService.devLogin(dto);
  }

  @Public()
  @Post('password-register')
  passwordRegister(@Body() dto: PasswordRegisterDto) {
    return this.authService.passwordRegister(dto);
  }

  @Public()
  @Post('password-login')
  passwordLogin(@Body() dto: PasswordAuthDto) {
    return this.authService.passwordLogin(dto);
  }

  @Public()
  @Post('wx-login')
  wxLogin(@Body() dto: WxLoginDto) {
    return this.authService.wxLogin(dto);
  }

  // 用 refresh token 换一对新 (access, refresh);失败统一 401,前端跳登录
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }
}
