import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMe(userId: bigint) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return {
      id: user.id.toString(),
      openid: user.openid,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      city: user.city,
      fishingAgeBand: user.fishingAgeBand,
      playStyles: user.playStyles,
      allowNearby: user.allowNearby,
      allowShowLoc: user.allowShowLoc,
      lastActiveAt: user.lastActiveAt,
      createdAt: user.createdAt,
    };
  }
}
