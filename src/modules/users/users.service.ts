import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateMeDto } from './dto/users.dto';

/** /users/me 与 /users/update 共用的返回结构 */
export interface MeProfile {
  id: string;
  openid: string;
  nickname: string | null;
  avatar: string | null;
  gender: number;
  city: string | null;
  fishingAgeBand: string | null;
  playStyles: string[];
  allowNearby: boolean;
  allowShowLoc: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

function parsePlayStyles(v: Prisma.JsonValue | null): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string');
  }
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // fallthrough
    }
  }
  return [];
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMe(userId: bigint): Promise<MeProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return this.toMeProfile(user);
  }

  async updateMe(userId: bigint, dto: UpdateMeDto): Promise<MeProfile> {
    // 把空对象提前挡掉,避免一次空 UPDATE
    const hasAny =
      dto.nickname !== undefined ||
      dto.avatar !== undefined ||
      dto.city !== undefined ||
      dto.gender !== undefined ||
      dto.fishingAgeBand !== undefined ||
      dto.playStyles !== undefined ||
      dto.allowNearby !== undefined ||
      dto.allowShowLoc !== undefined;
    if (!hasAny) {
      return this.findMe(userId);
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.fishingAgeBand !== undefined) data.fishingAgeBand = dto.fishingAgeBand;
    if (dto.playStyles !== undefined) {
      data.playStyles = dto.playStyles.length
        ? (dto.playStyles as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (dto.allowNearby !== undefined) data.allowNearby = dto.allowNearby;
    if (dto.allowShowLoc !== undefined) data.allowShowLoc = dto.allowShowLoc;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.toMeProfile(updated);
  }

  private toMeProfile(u: {
    id: bigint;
    openid: string;
    nickname: string | null;
    avatar: string | null;
    gender: number;
    city: string | null;
    fishingAgeBand: string | null;
    playStyles: Prisma.JsonValue | null;
    allowNearby: boolean;
    allowShowLoc: boolean;
    lastActiveAt: Date | null;
    createdAt: Date;
  }): MeProfile {
    return {
      id: u.id.toString(),
      openid: u.openid,
      nickname: u.nickname,
      avatar: u.avatar,
      gender: u.gender,
      city: u.city,
      fishingAgeBand: u.fishingAgeBand,
      playStyles: parsePlayStyles(u.playStyles),
      allowNearby: u.allowNearby,
      allowShowLoc: u.allowShowLoc,
      lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
