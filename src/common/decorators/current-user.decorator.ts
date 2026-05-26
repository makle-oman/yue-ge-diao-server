import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  /** access | refresh — refresh 不该出现在 Authorization,JwtStrategy 会拒 */
  typ?: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): bigint => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (!req.user?.sub) {
      throw new Error('CurrentUserId used outside authenticated context');
    }
    return BigInt(req.user.sub);
  },
);
