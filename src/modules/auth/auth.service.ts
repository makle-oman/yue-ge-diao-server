import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { DevLoginDto } from './dto/dev-login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async devLogin(dto: DevLoginDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('dev-login disabled in production');
    }

    const openid = dto.openid?.trim() || `dev_${Date.now()}`;
    const nickname = dto.nickname?.trim() || `钓友${openid.slice(-4)}`;

    const user = await this.prisma.user.upsert({
      where: { openid },
      update: { lastActiveAt: new Date() },
      create: {
        openid,
        nickname,
        status: 'active',
      },
    });

    const token = await this.jwt.signAsync({ sub: user.id.toString() });

    return {
      token,
      user: {
        id: user.id.toString(),
        openid: user.openid,
        nickname: user.nickname,
        avatar: user.avatar,
      },
    };
  }
}
