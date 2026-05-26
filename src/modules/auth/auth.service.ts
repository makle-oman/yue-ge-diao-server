import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { DevLoginDto } from './dto/dev-login.dto';

/**
 * 双 token 协议:
 *   - access  : 30m 过期, payload.typ='access', 用作 Authorization: Bearer
 *   - refresh : 30d 过期, payload.typ='refresh', 仅用于 /auth/refresh
 *
 * 同 secret(JWT_SECRET)简化运维;通过 payload.typ 字段区分用途。
 * JwtStrategy 在 validate 时强制拒绝 typ='refresh' 的 token,反向也防 access
 * 被当 refresh 来无限续期(verifyRefreshToken 校验 typ='refresh')。
 */

export type TokenType = 'access' | 'refresh';

export interface TokenPair {
  token: string;
  refreshToken: string;
}

interface RefreshPayload {
  sub: string;
  typ: TokenType;
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthService {
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshExpiresIn =
      config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d';
  }

  // ─── 签发 ─────────────────────────────────────────────────────────────────
  // access 沿用 JwtModule 注册时配置的 expiresIn(默认 30m);
  // refresh 显式传入 JWT_REFRESH_EXPIRES_IN(默认 30d),独立配置便于运维微调
  private signAccessToken(sub: string): Promise<string> {
    return this.jwt.signAsync({ sub, typ: 'access' as TokenType });
  }

  private signRefreshToken(sub: string): Promise<string> {
    return this.jwt.signAsync(
      { sub, typ: 'refresh' as TokenType },
      { expiresIn: this.refreshExpiresIn } as JwtSignOptions,
    );
  }

  private async issueTokenPair(sub: string): Promise<TokenPair> {
    const [token, refreshToken] = await Promise.all([
      this.signAccessToken(sub),
      this.signRefreshToken(sub),
    ]);
    return { token, refreshToken };
  }

  // ─── 业务动作 ─────────────────────────────────────────────────────────────
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

    const pair = await this.issueTokenPair(user.id.toString());

    return {
      ...pair,
      user: {
        id: user.id.toString(),
        openid: user.openid,
        nickname: user.nickname,
        avatar: user.avatar,
      },
    };
  }

  /**
   * /auth/refresh:用 refresh token 换一对新的 (access, refresh)
   * 错误统一抛 401 UnauthorizedException,前端拦到就跳登录页。
   *
   * 当前是无状态实现(纯 JWT),不做服务端撤销 / 黑名单。
   * 升级到有状态 refresh(写库 + rotation)只需改这个方法,protocol 不变。
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException('refresh token required');
    }

    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('refresh token invalid or expired');
    }

    if (payload.typ !== 'refresh') {
      // 防 access 被当 refresh 滥用
      throw new UnauthorizedException('not a refresh token');
    }
    if (!payload.sub) {
      throw new UnauthorizedException('invalid refresh payload');
    }

    // 顺手查一下用户还在不在(被封号 / 被删 也走 401)
    const userId = BigInt(payload.sub);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('user not active');
    }

    return this.issueTokenPair(payload.sub);
  }
}
