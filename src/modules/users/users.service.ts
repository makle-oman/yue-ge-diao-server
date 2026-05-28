import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  distanceM,
  encode as geohashEncode,
  neighbors as geohashNeighbors,
  precisionForRadius,
} from '../../common/utils/geohash';
import { PrismaService } from '../../prisma/prisma.service';
import { FollowUserDto, NearbyUsersDto, UpdateMeDto, UserIdDto } from './dto/users.dto';

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

export interface NearbyUserItem {
  id: string;
  nickname: string | null;
  avatar: string | null;
  city: string | null;
  fishingAgeBand: string | null;
  playStyles: string[];
  distance: number;
  lastActiveAt: string | null;
  following: boolean;
}

export interface PublicUserProfile extends Omit<NearbyUserItem, 'distance'> {
  distance: number | null;
  followerCount: number;
  followingCount: number;
  stats: {
    catches: number;
    spots: number;
    heaviestG: number | null;
  };
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

function parseBigIntId(raw: string, name: string): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw new BadRequestException(`${name} 必须是数字字符串`);
  }
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException(`${name} 解析失败`);
  }
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

  async detail(viewerId: bigint, dto: UserIdDto): Promise<PublicUserProfile> {
    const targetId = parseBigIntId(dto.userId, 'userId');
    const user = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    const [following, followerCount, followingCount, catches, spots, heaviest] =
      await Promise.all([
        viewerId === targetId
          ? Promise.resolve(null)
          : this.prisma.follow.findUnique({
              where: {
                followerId_followeeId: {
                  followerId: viewerId,
                  followeeId: targetId,
                },
              },
              select: { followeeId: true },
            }),
        this.prisma.follow.count({ where: { followeeId: targetId } }),
        this.prisma.follow.count({ where: { followerId: targetId } }),
        this.prisma.catch.count({
          where: { userId: targetId, reviewStatus: 'approved', locationVisible: true },
        }),
        this.prisma.spot.count({
          where: { creatorId: targetId, status: 'approved' },
        }),
        this.prisma.catch.findFirst({
          where: {
            userId: targetId,
            reviewStatus: 'approved',
            locationVisible: true,
            weightG: { not: null },
          },
          orderBy: { weightG: 'desc' },
          select: { weightG: true },
        }),
      ]);

    return {
      id: user.id.toString(),
      nickname: user.nickname,
      avatar: user.avatar,
      city: user.city,
      fishingAgeBand: user.fishingAgeBand,
      playStyles: parsePlayStyles(user.playStyles),
      distance: null,
      lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
      following: viewerId === targetId ? false : !!following,
      followerCount,
      followingCount,
      stats: {
        catches,
        spots,
        heaviestG: heaviest?.weightG ?? null,
      },
      createdAt: user.createdAt.toISOString(),
    };
  }

  async nearby(viewerId: bigint, dto: NearbyUsersDto) {
    const radius = dto.radius ?? 50_000;
    const limit = dto.limit ?? 20;
    const precision = precisionForRadius(radius);
    const prefixes = geohashNeighbors(dto.lat, dto.lng, precision);
    const now = new Date();

    await this.prisma.user.update({
      where: { id: viewerId },
      data: {
        lat: new Prisma.Decimal(dto.lat),
        lng: new Prisma.Decimal(dto.lng),
        geohash: geohashEncode(dto.lat, dto.lng, 8),
        lastActiveAt: now,
      },
    });

    const rows = await this.prisma.user.findMany({
      where: {
        id: { not: viewerId },
        status: 'active',
        allowNearby: true,
        lat: { not: null },
        lng: { not: null },
        OR: prefixes.map((p) => ({ geohash: { startsWith: p } })),
      },
      take: 200,
    });
    const keyword = dto.keyword?.trim();
    const playStyle = dto.playStyle?.trim();

    const enriched = rows
      .map((u) => ({
        row: u,
        styles: parsePlayStyles(u.playStyles),
        dist: distanceM(dto.lat, dto.lng, u.lat!.toNumber(), u.lng!.toNumber()),
      }))
      .filter((x) => x.dist <= radius)
      .filter((x) => {
        if (playStyle && !x.styles.includes(playStyle)) return false;
        if (!keyword) return true;
        return (
          x.row.nickname?.includes(keyword) ||
          x.row.city?.includes(keyword) ||
          x.styles.some((s) => s.includes(keyword))
        );
      })
      .sort((a, b) => {
        const activeA = a.row.lastActiveAt?.getTime() ?? 0;
        const activeB = b.row.lastActiveAt?.getTime() ?? 0;
        return a.dist - b.dist || activeB - activeA;
      })
      .slice(0, limit);

    const follows = await this.prisma.follow.findMany({
      where: {
        followerId: viewerId,
        followeeId: { in: enriched.map((x) => x.row.id) },
      },
      select: { followeeId: true },
    });
    const followSet = new Set(follows.map((f) => f.followeeId.toString()));

    return {
      list: enriched.map<NearbyUserItem>((x) => ({
        id: x.row.id.toString(),
        nickname: x.row.nickname,
        avatar: x.row.avatar,
        city: x.row.city,
        fishingAgeBand: x.row.fishingAgeBand,
        playStyles: x.styles,
        distance: Math.round(x.dist),
        lastActiveAt: x.row.lastActiveAt ? x.row.lastActiveAt.toISOString() : null,
        following: followSet.has(x.row.id.toString()),
      })),
    };
  }

  async follow(viewerId: bigint, dto: FollowUserDto) {
    const targetId = parseBigIntId(dto.userId, 'userId');
    if (targetId === viewerId) {
      throw new BadRequestException('不能关注自己');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    if (dto.action === 'follow') {
      await this.prisma.follow.upsert({
        where: {
          followerId_followeeId: {
            followerId: viewerId,
            followeeId: targetId,
          },
        },
        update: {},
        create: {
          followerId: viewerId,
          followeeId: targetId,
        },
      });
    } else {
      await this.prisma.follow.deleteMany({
        where: {
          followerId: viewerId,
          followeeId: targetId,
        },
      });
    }

    const followerCount = await this.prisma.follow.count({
      where: { followeeId: targetId },
    });
    return { ok: true, following: dto.action === 'follow', followerCount };
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
