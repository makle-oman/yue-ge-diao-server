import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  distanceM,
  encode as geohashEncode,
  neighbors as geohashNeighbors,
  precisionForRadius,
} from '../../common/utils/geohash';
import {
  CatchIdDto,
  CollectCatchDto,
  CreateCatchDto,
  LikeCatchDto,
  ListCatchesDto,
  UserCatchesDto,
  UserCatchesStatsDto,
} from './dto/catches.dto';

type Nullable<T> = T | null | undefined;

export interface CatchFeedItem {
  id: string;
  cover: string | null;
  photos: string[];
  fishSpecies: string[];
  weight: number | null;
  length: number | null;
  content: string | null;
  spotId: string | null;
  spotName: string | null;
  city: string | null;
  distance?: number;
  likeCount: number;
  commentCount: number;
  favCount: number;
  liked: boolean;
  userId: string;
  userName: string | null;
  userAvatar: string | null;
  createdAt: string;
}

interface RawNearbyCatchRow {
  id: bigint;
  user_id: bigint;
  spot_id: Nullable<bigint>;
  photos: string | unknown[];
  fish_species: string | unknown[];
  weight_g: Nullable<number>;
  length_cm: Nullable<number>;
  content: Nullable<string>;
  lat: Nullable<string | number>;
  lng: Nullable<string | number>;
  geohash: Nullable<string>;
  location_visible: number;
  like_count: number;
  comment_count: number;
  fav_count: number;
  created_at: Date;
  user_nickname: Nullable<string>;
  user_avatar: Nullable<string>;
  spot_name: Nullable<string>;
  spot_city: Nullable<string>;
}

function parseJsonField<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function toNum(v: string | number | { toString(): string }): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return Number(v.toString());
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64');
}

function decodeCursor(cursor: Nullable<string>): number {
  if (!cursor) return 0;
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
      o?: number;
    };
    return Math.max(0, Math.floor(obj.o ?? 0));
  } catch {
    return 0;
  }
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

function firstPhoto(photos: string[]): string | null {
  return photos.length > 0 ? photos[0] : null;
}

@Injectable()
export class CatchesService {
  constructor(private readonly prisma: PrismaService) {}

  // 鱼获默认审核通过；TODO(content-review): 接入 imgSecCheck/msgSecCheck 后默认改 'pending'
  private readonly defaultReviewStatus = 'approved';

  // ──────────────────────────────────────────────────────────────
  // Feed 列表（recommend / nearby / follow）
  // ──────────────────────────────────────────────────────────────
  async list(
    viewerId: bigint | null,
    dto: ListCatchesDto,
  ): Promise<{
    list: CatchFeedItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = dto.limit ?? 20;
    const offset = decodeCursor(dto.cursor);

    if (dto.tab === 'nearby') {
      if (dto.lat == null || dto.lng == null) {
        throw new BadRequestException('nearby tab 必须传 lat/lng');
      }
      return this.listNearby(viewerId, dto.lat, dto.lng, dto.radius ?? 50_000, limit, offset);
    }

    if (dto.tab === 'follow') {
      if (!viewerId) {
        throw new BadRequestException('follow tab 需登录');
      }
      return this.listFollow(viewerId, limit, offset);
    }

    return this.listRecommend(viewerId, limit, offset);
  }

  private async listRecommend(
    viewerId: bigint | null,
    limit: number,
    offset: number,
  ) {
    const rows = await this.prisma.catch.findMany({
      where: { reviewStatus: 'approved' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      include: {
        user: { select: { id: true, nickname: true, avatar: true } },
        spot: { select: { id: true, name: true, city: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const likedSet = await this.fetchLikedSet(
      viewerId,
      page.map((c) => c.id),
    );

    return {
      list: page.map((c) => this.mapCatchRow(c, likedSet)),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  private async listFollow(viewerId: bigint, limit: number, offset: number) {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followeeId: true },
    });
    const followeeIds = follows.map((f) => f.followeeId);
    if (followeeIds.length === 0) {
      return { list: [], nextCursor: null, hasMore: false };
    }
    const rows = await this.prisma.catch.findMany({
      where: { reviewStatus: 'approved', userId: { in: followeeIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      include: {
        user: { select: { id: true, nickname: true, avatar: true } },
        spot: { select: { id: true, name: true, city: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const likedSet = await this.fetchLikedSet(
      viewerId,
      page.map((c) => c.id),
    );
    return {
      list: page.map((c) => this.mapCatchRow(c, likedSet)),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  private async listNearby(
    viewerId: bigint | null,
    lat: number,
    lng: number,
    radius: number,
    limit: number,
    offset: number,
  ) {
    const precision = precisionForRadius(radius);
    const prefixes = geohashNeighbors(lat, lng, precision);

    const rows = await this.prisma.$queryRaw<RawNearbyCatchRow[]>`
      SELECT
        c.id, c.user_id, c.spot_id, c.photos, c.fish_species, c.weight_g, c.length_cm,
        c.content, c.lat, c.lng, c.geohash, c.location_visible,
        c.like_count, c.comment_count, c.fav_count, c.created_at,
        u.nickname AS user_nickname, u.avatar AS user_avatar,
        s.name AS spot_name, s.city AS spot_city
      FROM catches c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN spots s ON s.id = c.spot_id
      WHERE c.review_status = 'approved'
        AND c.geohash IS NOT NULL
        AND LEFT(c.geohash, ${precision}) IN (${Prisma.join(prefixes)})
      ORDER BY c.created_at DESC
      LIMIT 500
    `;

    const enriched = rows
      .map((r) => {
        const cLat = r.lat != null ? toNum(r.lat) : null;
        const cLng = r.lng != null ? toNum(r.lng) : null;
        const dist =
          cLat != null && cLng != null ? distanceM(lat, lng, cLat, cLng) : Infinity;
        return { row: r, dist };
      })
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist);

    const page = enriched.slice(offset, offset + limit);
    const hasMore = enriched.length > offset + limit;
    const likedSet = await this.fetchLikedSet(
      viewerId,
      page.map((x) => x.row.id),
    );

    return {
      list: page.map((x) => this.mapRawNearbyRow(x.row, x.dist, likedSet)),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  private async fetchLikedSet(
    viewerId: bigint | null,
    catchIds: bigint[],
  ): Promise<Set<string>> {
    if (!viewerId || catchIds.length === 0) return new Set();
    const likes = await this.prisma.catchLike.findMany({
      where: { userId: viewerId, catchId: { in: catchIds } },
      select: { catchId: true },
    });
    return new Set(likes.map((l) => l.catchId.toString()));
  }

  private mapCatchRow(
    c: Prisma.CatchGetPayload<{
      include: {
        user: { select: { id: true; nickname: true; avatar: true } };
        spot: { select: { id: true; name: true; city: true } };
      };
    }>,
    likedSet: Set<string>,
  ): CatchFeedItem {
    const photos = parseJsonField<string[]>(c.photos as unknown, []);
    const fishSpecies = parseJsonField<string[]>(c.fishSpecies as unknown, []);
    const cityFromSpot = c.spot?.city ?? null;
    return {
      id: c.id.toString(),
      cover: firstPhoto(photos),
      photos,
      fishSpecies,
      weight: c.weightG,
      length: c.lengthCm,
      content: c.content,
      spotId: c.spot?.id?.toString() ?? null,
      spotName: c.spot?.name ?? null,
      city: cityFromSpot,
      likeCount: c.likeCount,
      commentCount: c.commentCount,
      favCount: c.favCount,
      liked: likedSet.has(c.id.toString()),
      userId: c.user.id.toString(),
      userName: c.user.nickname,
      userAvatar: c.user.avatar,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private mapRawNearbyRow(
    r: RawNearbyCatchRow,
    distance: number,
    likedSet: Set<string>,
  ): CatchFeedItem {
    const photos = parseJsonField<string[]>(r.photos, []);
    const fishSpecies = parseJsonField<string[]>(r.fish_species, []);
    return {
      id: r.id.toString(),
      cover: firstPhoto(photos),
      photos,
      fishSpecies,
      weight: r.weight_g ?? null,
      length: r.length_cm ?? null,
      content: r.content ?? null,
      spotId: r.spot_id ? r.spot_id.toString() : null,
      spotName: r.spot_name ?? null,
      city: r.spot_city ?? null,
      distance: Number.isFinite(distance) ? Math.round(distance) : undefined,
      likeCount: r.like_count,
      commentCount: r.comment_count,
      favCount: r.fav_count,
      liked: likedSet.has(r.id.toString()),
      userId: r.user_id.toString(),
      userName: r.user_nickname ?? null,
      userAvatar: r.user_avatar ?? null,
      createdAt: r.created_at.toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 发布鱼获
  // ──────────────────────────────────────────────────────────────
  async create(userId: bigint, dto: CreateCatchDto) {
    let spotId: bigint | null = null;
    if (dto.spotId) {
      const sId = parseBigIntId(dto.spotId, 'spotId');
      const spot = await this.prisma.spot.findUnique({
        where: { id: sId },
        select: { id: true, status: true },
      });
      if (!spot || spot.status !== 'approved') {
        throw new NotFoundException('关联钓点不存在或未审核通过');
      }
      spotId = sId;
    }

    let geohash: string | null = null;
    if (dto.lat != null && dto.lng != null) {
      geohash = geohashEncode(dto.lat, dto.lng, 8);
    }

    const created = await this.prisma.catch.create({
      data: {
        userId,
        spotId: spotId ?? undefined,
        photos: dto.photos as unknown as Prisma.InputJsonValue,
        fishSpecies: dto.fishSpecies as unknown as Prisma.InputJsonValue,
        weightG: dto.weight ?? null,
        lengthCm: dto.length ?? null,
        technique: dto.technique ?? null,
        bait: dto.bait ?? null,
        content: dto.content ?? null,
        lat: dto.lat != null ? new Prisma.Decimal(dto.lat) : null,
        lng: dto.lng != null ? new Prisma.Decimal(dto.lng) : null,
        geohash,
        locationVisible: dto.locationVisible ?? true,
        allowComments: dto.allowComments ?? true,
        reviewStatus: this.defaultReviewStatus,
      },
      select: { id: true, reviewStatus: true, createdAt: true },
    });

    return {
      id: created.id.toString(),
      reviewStatus: created.reviewStatus,
      createdAt: created.createdAt.toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 详情
  // ──────────────────────────────────────────────────────────────
  async detail(viewerId: bigint | null, dto: CatchIdDto) {
    const id = parseBigIntId(dto.catchId, 'catchId');
    const c = await this.prisma.catch.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, nickname: true, avatar: true } },
        spot: {
          select: { id: true, name: true, city: true, lat: true, lng: true },
        },
      },
    });
    if (!c || c.reviewStatus !== 'approved') {
      throw new NotFoundException('鱼获不存在或未审核通过');
    }

    const [liked, collected] = viewerId
      ? await Promise.all([
          this.prisma.catchLike.findUnique({
            where: { catchId_userId: { catchId: id, userId: viewerId } },
            select: { catchId: true },
          }),
          this.prisma.catchFavorite.findUnique({
            where: { catchId_userId: { catchId: id, userId: viewerId } },
            select: { catchId: true },
          }),
        ])
      : [null, null];

    const photos = parseJsonField<string[]>(c.photos as unknown, []);
    const fishSpecies = parseJsonField<string[]>(c.fishSpecies as unknown, []);
    const weather = parseJsonField<Record<string, unknown> | null>(
      c.weatherSnapshot as unknown,
      null,
    );

    // 隐私：locationVisible=false 时不外漏坐标（spot 信息保留，已是显式公开）
    const showLoc = c.locationVisible;

    return {
      id: c.id.toString(),
      photos,
      cover: firstPhoto(photos),
      fishSpecies,
      weight: c.weightG,
      length: c.lengthCm,
      technique: c.technique,
      bait: c.bait,
      content: c.content,
      lat: showLoc && c.lat ? c.lat.toNumber() : null,
      lng: showLoc && c.lng ? c.lng.toNumber() : null,
      locationVisible: c.locationVisible,
      allowComments: c.allowComments,
      weatherSnapshot: weather,
      likeCount: c.likeCount,
      commentCount: c.commentCount,
      favCount: c.favCount,
      reviewStatus: c.reviewStatus,
      createdAt: c.createdAt.toISOString(),
      user: {
        id: c.user.id.toString(),
        nickname: c.user.nickname,
        avatar: c.user.avatar,
      },
      spot: c.spot
        ? {
            id: c.spot.id.toString(),
            name: c.spot.name,
            city: c.spot.city,
            lat: c.spot.lat.toNumber(),
            lng: c.spot.lng.toNumber(),
          }
        : null,
      yourLikeStatus: !!liked,
      yourCollectStatus: !!collected,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 点赞 / 取消点赞（幂等）
  // ──────────────────────────────────────────────────────────────
  async like(userId: bigint, dto: LikeCatchDto) {
    const id = parseBigIntId(dto.catchId, 'catchId');
    const exists = await this.prisma.catch.findUnique({
      where: { id },
      select: { id: true, reviewStatus: true },
    });
    if (!exists || exists.reviewStatus !== 'approved') {
      throw new NotFoundException('鱼获不存在或未审核通过');
    }

    const likeCount = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.catchLike.findUnique({
        where: { catchId_userId: { catchId: id, userId } },
        select: { catchId: true },
      });
      if (dto.action === 'like' && !existing) {
        await tx.catchLike.create({ data: { catchId: id, userId } });
        const u = await tx.catch.update({
          where: { id },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        });
        return u.likeCount;
      }
      if (dto.action === 'unlike' && existing) {
        await tx.catchLike.delete({
          where: { catchId_userId: { catchId: id, userId } },
        });
        const cur = await tx.catch.findUniqueOrThrow({
          where: { id },
          select: { likeCount: true },
        });
        const next = Math.max(0, cur.likeCount - 1);
        await tx.catch.update({ where: { id }, data: { likeCount: next } });
        return next;
      }
      const cur = await tx.catch.findUniqueOrThrow({
        where: { id },
        select: { likeCount: true },
      });
      return cur.likeCount;
    });

    return { ok: true, likeCount };
  }

  // ──────────────────────────────────────────────────────────────
  // 收藏 / 取消收藏（幂等）
  // ──────────────────────────────────────────────────────────────
  async collect(userId: bigint, dto: CollectCatchDto) {
    const id = parseBigIntId(dto.catchId, 'catchId');
    const exists = await this.prisma.catch.findUnique({
      where: { id },
      select: { id: true, reviewStatus: true },
    });
    if (!exists || exists.reviewStatus !== 'approved') {
      throw new NotFoundException('鱼获不存在或未审核通过');
    }

    const favCount = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.catchFavorite.findUnique({
        where: { catchId_userId: { catchId: id, userId } },
        select: { catchId: true },
      });
      if (dto.action === 'collect' && !existing) {
        await tx.catchFavorite.create({ data: { catchId: id, userId } });
        const u = await tx.catch.update({
          where: { id },
          data: { favCount: { increment: 1 } },
          select: { favCount: true },
        });
        return u.favCount;
      }
      if (dto.action === 'uncollect' && existing) {
        await tx.catchFavorite.delete({
          where: { catchId_userId: { catchId: id, userId } },
        });
        const cur = await tx.catch.findUniqueOrThrow({
          where: { id },
          select: { favCount: true },
        });
        const next = Math.max(0, cur.favCount - 1);
        await tx.catch.update({ where: { id }, data: { favCount: next } });
        return next;
      }
      const cur = await tx.catch.findUniqueOrThrow({
        where: { id },
        select: { favCount: true },
      });
      return cur.favCount;
    });

    return { ok: true, favCount };
  }

  // ──────────────────────────────────────────────────────────────
  // 我的（或他人的）鱼获列表
  // ──────────────────────────────────────────────────────────────
  async listForUser(viewerId: bigint, dto: UserCatchesDto) {
    const targetId = dto.userId ? parseBigIntId(dto.userId, 'userId') : viewerId;
    const visibility = dto.visibility ?? 'all';
    const limit = dto.limit ?? 20;
    const offset = decodeCursor(dto.cursor);
    const isSelf = targetId === viewerId;

    // 看别人时只能看 public 的
    if (!isSelf && visibility === 'private') {
      throw new ForbiddenException('不能查看他人私密鱼获');
    }
    const where: Prisma.CatchWhereInput = {
      userId: targetId,
      reviewStatus: 'approved',
    };
    if (!isSelf) {
      where.locationVisible = true;
    } else if (visibility === 'public') {
      where.locationVisible = true;
    } else if (visibility === 'private') {
      where.locationVisible = false;
    }

    const rows = await this.prisma.catch.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      include: {
        user: { select: { id: true, nickname: true, avatar: true } },
        spot: { select: { id: true, name: true, city: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const likedSet = await this.fetchLikedSet(
      viewerId,
      page.map((c) => c.id),
    );

    return {
      list: page.map((c) => this.mapCatchRow(c, likedSet)),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 个人鱼获统计：total / monthCount / monthAdd / heaviestG
  // ──────────────────────────────────────────────────────────────
  async statsForUser(viewerId: bigint, dto: UserCatchesStatsDto) {
    const targetId = dto.userId ? parseBigIntId(dto.userId, 'userId') : viewerId;
    const isSelf = targetId === viewerId;

    // 看自己：所有鱼获；看别人：仅 locationVisible=true（与隐私语义一致）
    const baseWhere: Prisma.CatchWhereInput = {
      userId: targetId,
      reviewStatus: 'approved',
      ...(isSelf ? {} : { locationVisible: true }),
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [total, monthCount, lastMonthCount, heaviest] = await Promise.all([
      this.prisma.catch.count({ where: baseWhere }),
      this.prisma.catch.count({
        where: { ...baseWhere, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.catch.count({
        where: {
          ...baseWhere,
          createdAt: { gte: startOfLastMonth, lt: startOfMonth },
        },
      }),
      this.prisma.catch.findFirst({
        where: { ...baseWhere, weightG: { not: null } },
        orderBy: { weightG: 'desc' },
        select: { weightG: true, fishSpecies: true, createdAt: true },
      }),
    ]);

    return {
      total,
      monthCount,
      monthAdd: monthCount - lastMonthCount,
      heaviest: heaviest
        ? {
            weightG: heaviest.weightG,
            fishSpecies: parseJsonField<string[]>(
              heaviest.fishSpecies as unknown,
              [],
            ),
            createdAt: heaviest.createdAt.toISOString(),
          }
        : null,
    };
  }
}
