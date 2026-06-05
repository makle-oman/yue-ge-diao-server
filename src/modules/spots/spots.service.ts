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
  CreateSpotDto,
  ListSpotsDto,
  NearbySpotsDto,
  SearchSpotsDto,
  SpotCitiesDto,
  SpotHistoryDto,
  SpotIdDto,
  UpdateSpotDto,
  UserSpotsDto,
  UserSpotsStatsDto,
  WantSpotDto,
} from './dto/spots.dto';

type Nullable<T> = T | null | undefined;

interface RawSpotRow {
  id: bigint;
  name: string;
  type: string;
  water_type: Nullable<string>;
  lat: string | number;
  lng: string | number;
  geohash: string;
  address: Nullable<string>;
  city: Nullable<string>;
  creator_id: bigint;
  status: string;
  fish_species: Nullable<string | unknown[]>;
  facilities: Nullable<string | Record<string, unknown>>;
  description: Nullable<string>;
  photos: Nullable<string | unknown[]>;
  avg_rating: string | number;
  rating_count: number;
  want_count: number;
  created_at: Date;
  updated_at: Date;
}

interface RawCityRow {
  name: string;
  spots: bigint | number;
  anglers: bigint | number | null;
  latitude: string | number;
  longitude: string | number;
}

export interface SpotListItem {
  id: string;
  name: string;
  type: string;
  waterType: Nullable<string>;
  lat: number;
  lng: number;
  address: Nullable<string>;
  city: Nullable<string>;
  distance?: number;
  avgRating: number;
  ratingCount: number;
  wantCount: number;
  photos: string[];
  fishSpecies: string[];
  createdAt: string;
}

export interface SpotCityOption {
  name: string;
  spots: number;
  anglers: number;
  latitude: number;
  longitude: number;
}

const SPOT_RAW_COLUMNS = `
  id, name, type, water_type, lat, lng, geohash, address, city,
  creator_id, status, fish_species, facilities, description, photos,
  avg_rating, rating_count, want_count, created_at, updated_at
`;

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

function parseSpotId(raw: string): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw new BadRequestException('spotId 必须是数字字符串');
  }
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException('spotId 解析失败');
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

function mapRawSpot(r: RawSpotRow, distance?: number): SpotListItem {
  return {
    id: r.id.toString(),
    name: r.name,
    type: r.type,
    waterType: r.water_type ?? null,
    lat: toNum(r.lat),
    lng: toNum(r.lng),
    address: r.address ?? null,
    city: r.city ?? null,
    distance,
    avgRating: toNum(r.avg_rating),
    ratingCount: r.rating_count,
    wantCount: r.want_count,
    photos: parseJsonField<string[]>(r.photos, []),
    fishSpecies: parseJsonField<string[]>(r.fish_species, []),
    createdAt: r.created_at.toISOString(),
  };
}

@Injectable()
export class SpotsService {
  constructor(private readonly prisma: PrismaService) {}

  // 钓点目前默认开放可见，未来接入内容审核时改回 'pending' 等管理员审核
  // TODO(content-review): 接入 imgSecCheck/msgSecCheck 后默认改 'pending'
  private readonly defaultCreateStatus = 'approved';

  async cities(dto: SpotCitiesDto): Promise<{ list: SpotCityOption[] }> {
    const limit = dto.limit ?? 20;
    const keyword = dto.keyword?.trim();
    const filters: Prisma.Sql[] = [
      Prisma.sql`s.status = 'approved'`,
      Prisma.sql`s.city IS NOT NULL`,
      Prisma.sql`s.city <> ''`,
    ];
    if (keyword) {
      const kw = `%${keyword}%`;
      filters.push(Prisma.sql`s.city LIKE ${kw}`);
    }

    const rows = await this.prisma.$queryRaw<RawCityRow[]>`
      SELECT
        s.city AS name,
        COUNT(*) AS spots,
        COALESCE(u.anglers, 0) AS anglers,
        AVG(s.lat) AS latitude,
        AVG(s.lng) AS longitude
      FROM spots s
      LEFT JOIN (
        SELECT city, COUNT(*) AS anglers
        FROM users
        WHERE status = 'active'
          AND allow_nearby = 1
          AND city IS NOT NULL
          AND city <> ''
        GROUP BY city
      ) u ON u.city = s.city
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY s.city, u.anglers
      ORDER BY spots DESC, anglers DESC, name ASC
      LIMIT ${Math.min(limit * 3, 150)}
    `;

    const merged = new Map<
      string,
      {
        spots: number;
        anglers: number;
        latitudeSum: number;
        longitudeSum: number;
      }
    >();
    for (const row of rows) {
      const name = row.name.trim().replace(/市$/, '');
      if (!name) continue;
      const spots = Number(row.spots);
      const item = merged.get(name) ?? {
        spots: 0,
        anglers: 0,
        latitudeSum: 0,
        longitudeSum: 0,
      };
      item.spots += spots;
      item.anglers += Number(row.anglers ?? 0);
      item.latitudeSum += toNum(row.latitude) * spots;
      item.longitudeSum += toNum(row.longitude) * spots;
      merged.set(name, item);
    }

    const list = Array.from(merged.entries())
      .map(([name, item]) => ({
        name,
        spots: item.spots,
        anglers: item.anglers,
        latitude: item.latitudeSum / item.spots,
        longitude: item.longitudeSum / item.spots,
      }))
      .sort((a, b) => b.spots - a.spots || b.anglers - a.anglers || a.name.localeCompare(b.name))
      .slice(0, limit);

    return { list };
  }

  // ──────────────────────────────────────────────────────────────
  // 列表（首页地图）
  // ──────────────────────────────────────────────────────────────
  async list(dto: ListSpotsDto): Promise<{
    list: SpotListItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const radius = dto.radius ?? 5000;
    const limit = dto.limit ?? 20;
    const precision = precisionForRadius(radius);
    const prefixes = geohashNeighbors(dto.lat, dto.lng, precision);

    const filters: Prisma.Sql[] = [Prisma.sql`status = 'approved'`];
    filters.push(
      Prisma.sql`LEFT(geohash, ${precision}) IN (${Prisma.join(prefixes)})`,
    );
    if (dto.city) filters.push(Prisma.sql`city = ${dto.city}`);
    if (dto.type) filters.push(Prisma.sql`type = ${dto.type}`);

    const where = Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
    const rows = await this.prisma.$queryRaw<RawSpotRow[]>`
      SELECT ${Prisma.raw(SPOT_RAW_COLUMNS)}
      FROM spots
      ${where}
      LIMIT 500
    `;

    const enriched = rows
      .map((r) => ({
        row: r,
        dist: distanceM(dto.lat, dto.lng, toNum(r.lat), toNum(r.lng)),
      }))
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist);

    const offset = decodeCursor(dto.cursor);
    const page = enriched.slice(offset, offset + limit);
    const hasMore = enriched.length > offset + limit;

    return {
      list: page.map((x) => mapRawSpot(x.row, Math.round(x.dist))),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 附近（发鱼获选钓点；不分页，返回扁平 list）
  // ──────────────────────────────────────────────────────────────
  async nearby(dto: NearbySpotsDto): Promise<{ list: SpotListItem[] }> {
    const radius = dto.radius ?? 5000;
    const limit = dto.limit ?? 50;
    const precision = precisionForRadius(radius);
    const prefixes = geohashNeighbors(dto.lat, dto.lng, precision);

    const filters: Prisma.Sql[] = [Prisma.sql`status = 'approved'`];
    filters.push(
      Prisma.sql`LEFT(geohash, ${precision}) IN (${Prisma.join(prefixes)})`,
    );
    if (dto.type) filters.push(Prisma.sql`type = ${dto.type}`);
    if (dto.waterType) filters.push(Prisma.sql`water_type = ${dto.waterType}`);
    if (dto.city) filters.push(Prisma.sql`(city = ${dto.city} OR city = ${dto.city + '市'})`);

    const where = Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
    const rows = await this.prisma.$queryRaw<RawSpotRow[]>`
      SELECT ${Prisma.raw(SPOT_RAW_COLUMNS)}
      FROM spots
      ${where}
      LIMIT 500
    `;

    const list = rows
      .map((r) => ({
        row: r,
        dist: distanceM(dto.lat, dto.lng, toNum(r.lat), toNum(r.lng)),
      }))
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit)
      .map((x) => mapRawSpot(x.row, Math.round(x.dist)));

    return { list };
  }

  // ──────────────────────────────────────────────────────────────
  // 搜索（关键词 + 多筛选 + 排序：评分>热度>新鲜）
  // ──────────────────────────────────────────────────────────────
  async search(dto: SearchSpotsDto): Promise<{
    list: SpotListItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = dto.limit ?? 20;
    const offset = decodeCursor(dto.cursor);

    const filters: Prisma.Sql[] = [Prisma.sql`status = 'approved'`];
    if (dto.keyword) {
      const kw = `%${dto.keyword}%`;
      filters.push(
        Prisma.sql`(name LIKE ${kw} OR city LIKE ${kw} OR address LIKE ${kw} OR JSON_SEARCH(fish_species, 'one', ${kw}) IS NOT NULL)`,
      );
    }
    if (dto.type) filters.push(Prisma.sql`type = ${dto.type}`);
    if (dto.waterType) filters.push(Prisma.sql`water_type = ${dto.waterType}`);
    if (dto.city) filters.push(Prisma.sql`city = ${dto.city}`);
    const hasGeo = dto.lat != null && dto.lng != null;
    const radius = dto.radius ?? 50_000;
    const precision = hasGeo ? precisionForRadius(radius) : null;
    const prefixes = hasGeo ? geohashNeighbors(dto.lat!, dto.lng!, precision!) : [];
    if (hasGeo) {
      filters.push(
        Prisma.sql`LEFT(geohash, ${precision}) IN (${Prisma.join(prefixes)})`,
      );
    }
    if (dto.minRating != null) {
      filters.push(Prisma.sql`avg_rating >= ${dto.minRating}`);
    }
    if (dto.hasParking) {
      filters.push(Prisma.sql`JSON_EXTRACT(facilities, '$.park') = true`);
    }
    if (dto.hasToilet) {
      filters.push(Prisma.sql`JSON_EXTRACT(facilities, '$.toilet') = true`);
    }

    const where = Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
    const rows = await this.prisma.$queryRaw<RawSpotRow[]>`
      SELECT ${Prisma.raw(SPOT_RAW_COLUMNS)}
      FROM spots
      ${where}
      ORDER BY avg_rating DESC, (rating_count + want_count) DESC, created_at DESC
      LIMIT ${hasGeo ? 500 : limit + 1} OFFSET ${hasGeo ? 0 : offset}
    `;

    const enriched = hasGeo
      ? rows
          .map((r) => ({
            row: r,
            dist: distanceM(dto.lat!, dto.lng!, toNum(r.lat), toNum(r.lng)),
          }))
          .filter((x) => x.dist <= radius)
          .sort((a, b) => a.dist - b.dist)
      : rows.map((r) => ({ row: r, dist: undefined }));
    const hasMore = enriched.length > offset + limit;
    const page = enriched.slice(offset, offset + limit);

    return {
      list: page.map((x) =>
        mapRawSpot(
          x.row,
          x.dist != null && Number.isFinite(x.dist)
            ? Math.round(x.dist)
            : undefined,
        ),
      ),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 详情（含近 7/30 天鱼获数 + 用户的 wantStatus）
  // ──────────────────────────────────────────────────────────────
  async detail(userId: bigint, dto: SpotIdDto) {
    const id = parseSpotId(dto.spotId);
    const spot = await this.prisma.spot.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, nickname: true, avatar: true } },
      },
    });
    if (!spot || spot.status !== 'approved') {
      throw new NotFoundException('钓点不存在或未审核通过');
    }

    const now = new Date();
    const day7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [c7, c30, last, want] = await Promise.all([
      this.prisma.catch.count({
        where: { spotId: id, reviewStatus: 'approved', createdAt: { gte: day7 } },
      }),
      this.prisma.catch.count({
        where: { spotId: id, reviewStatus: 'approved', createdAt: { gte: day30 } },
      }),
      this.prisma.catch.findFirst({
        where: { spotId: id, reviewStatus: 'approved' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.spotWant.findUnique({
        where: { spotId_userId: { spotId: id, userId } },
        select: { spotId: true },
      }),
    ]);

    return {
      id: spot.id.toString(),
      name: spot.name,
      type: spot.type,
      waterType: spot.waterType,
      lat: spot.lat.toNumber(),
      lng: spot.lng.toNumber(),
      address: spot.address,
      city: spot.city,
      description: spot.description,
      photos: parseJsonField<string[]>(spot.photos as string | string[] | null, []),
      fishSpecies: parseJsonField<string[]>(
        spot.fishSpecies as string | string[] | null,
        [],
      ),
      facilities: parseJsonField<Record<string, unknown>>(
        spot.facilities as string | Record<string, unknown> | null,
        {},
      ),
      avgRating: spot.avgRating.toNumber(),
      ratingCount: spot.ratingCount,
      wantCount: spot.wantCount,
      creatorId: spot.creator.id.toString(),
      creatorName: spot.creator.nickname,
      creatorAvatar: spot.creator.avatar,
      createdAt: spot.createdAt.toISOString(),
      updatedAt: spot.updatedAt.toISOString(),
      catchCount7Days: c7,
      catchCount30Days: c30,
      lastCatchTime: last?.createdAt?.toISOString() ?? null,
      yourWantStatus: !!want,
    };
  }

  async mineDetail(userId: bigint, dto: SpotIdDto) {
    const id = parseSpotId(dto.spotId);
    const spot = await this.prisma.spot.findUnique({ where: { id } });
    if (!spot) {
      throw new NotFoundException('钓点不存在');
    }
    if (spot.creatorId !== userId) {
      throw new ForbiddenException('只能编辑自己上报的钓点');
    }

    return {
      id: spot.id.toString(),
      name: spot.name,
      type: spot.type,
      waterType: spot.waterType,
      lat: spot.lat.toNumber(),
      lng: spot.lng.toNumber(),
      address: spot.address,
      city: spot.city,
      description: spot.description,
      photos: parseJsonField<string[]>(spot.photos as string | string[] | null, []),
      fishSpecies: parseJsonField<string[]>(
        spot.fishSpecies as string | string[] | null,
        [],
      ),
      facilities: parseJsonField<Record<string, unknown>>(
        spot.facilities as string | Record<string, unknown> | null,
        {},
      ),
      status: spot.status,
      updatedAt: spot.updatedAt.toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 新建（防作弊：accuracy<50m；status=approved；自动算 geohash）
  // ──────────────────────────────────────────────────────────────
  async create(userId: bigint, dto: CreateSpotDto) {
    if (dto.accuracy != null && dto.accuracy > 50) {
      throw new ForbiddenException(
        `定位精度 ${dto.accuracy}m 太低，必须 < 50m`,
      );
    }
    const geohash = geohashEncode(dto.lat, dto.lng, 8);

    const spot = await this.prisma.spot.create({
      data: {
        name: dto.name,
        type: dto.type,
        waterType: dto.waterType,
        lat: new Prisma.Decimal(dto.lat),
        lng: new Prisma.Decimal(dto.lng),
        geohash,
        address: dto.address,
        city: dto.city,
        description: dto.description,
        fishSpecies: dto.fishSpecies ?? Prisma.JsonNull,
        facilities:
          dto.facilities != null
            ? (dto.facilities as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        photos: dto.photos ?? Prisma.JsonNull,
        status: this.defaultCreateStatus,
        creatorId: userId,
      },
      select: { id: true, status: true, createdAt: true },
    });
    return {
      id: spot.id.toString(),
      status: spot.status,
      createdAt: spot.createdAt.toISOString(),
    };
  }

  async update(userId: bigint, dto: UpdateSpotDto) {
    const spotId = parseSpotId(dto.spotId);
    const spot = await this.prisma.spot.findUnique({
      where: { id: spotId },
      select: { id: true, creatorId: true, status: true },
    });
    if (!spot) {
      throw new NotFoundException('钓点不存在');
    }
    if (spot.creatorId !== userId) {
      throw new ForbiddenException('只能编辑自己上报的钓点');
    }
    if ((dto.lat == null) !== (dto.lng == null)) {
      throw new BadRequestException('lat/lng 必须同时传');
    }
    if (dto.lat != null && dto.lng != null && dto.accuracy != null && dto.accuracy > 50) {
      throw new ForbiddenException(
        `定位精度 ${dto.accuracy}m 太低，必须 < 50m`,
      );
    }

    const data: Prisma.SpotUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.waterType !== undefined) data.waterType = dto.waterType;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.fishSpecies !== undefined) {
      data.fishSpecies = dto.fishSpecies.length
        ? (dto.fishSpecies as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (dto.facilities !== undefined) {
      data.facilities =
        Object.keys(dto.facilities).length > 0
          ? (dto.facilities as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;
    }
    if (dto.photos !== undefined) {
      data.photos = dto.photos.length
        ? (dto.photos as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (dto.lat != null && dto.lng != null) {
      data.lat = new Prisma.Decimal(dto.lat);
      data.lng = new Prisma.Decimal(dto.lng);
      data.geohash = geohashEncode(dto.lat, dto.lng, 8);
    }

    const updated = await this.prisma.spot.update({
      where: { id: spotId },
      data,
      select: { id: true, status: true, updatedAt: true },
    });
    return {
      id: updated.id.toString(),
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 标记/取消"想去"
  // ──────────────────────────────────────────────────────────────
  async want(userId: bigint, dto: WantSpotDto) {
    const spotId = parseSpotId(dto.spotId);
    const spot = await this.prisma.spot.findUnique({
      where: { id: spotId },
      select: { id: true, status: true },
    });
    if (!spot || spot.status !== 'approved') {
      throw new NotFoundException('钓点不存在或未审核通过');
    }

    const updatedWantCount = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.spotWant.findUnique({
        where: { spotId_userId: { spotId, userId } },
        select: { spotId: true },
      });
      if (dto.action === 'want' && !existing) {
        await tx.spotWant.create({ data: { spotId, userId } });
        const u = await tx.spot.update({
          where: { id: spotId },
          data: { wantCount: { increment: 1 } },
          select: { wantCount: true },
        });
        return u.wantCount;
      }
      if (dto.action === 'unwant' && existing) {
        await tx.spotWant.delete({
          where: { spotId_userId: { spotId, userId } },
        });
        // 防御性：want_count 不能小于 0
        const cur = await tx.spot.findUniqueOrThrow({
          where: { id: spotId },
          select: { wantCount: true },
        });
        const next = Math.max(0, cur.wantCount - 1);
        await tx.spot.update({
          where: { id: spotId },
          data: { wantCount: next },
        });
        return next;
      }
      // no-op (重复 want 或 重复 unwant)
      const cur = await tx.spot.findUniqueOrThrow({
        where: { id: spotId },
        select: { wantCount: true },
      });
      return cur.wantCount;
    });

    return { ok: true, wantCount: updatedWantCount };
  }

  // ──────────────────────────────────────────────────────────────
  // 历史鱼获 + 周趋势
  // ──────────────────────────────────────────────────────────────
  async history(dto: SpotHistoryDto) {
    const spotId = parseSpotId(dto.spotId);
    const days = dto.days ?? 7;
    const limit = dto.limit ?? 20;
    const offset = decodeCursor(dto.cursor);
    const sinceDays = new Date(Date.now() - days * 24 * 3600 * 1000);

    const exists = await this.prisma.spot.findUnique({
      where: { id: spotId },
      select: { id: true, status: true },
    });
    if (!exists || exists.status !== 'approved') {
      throw new NotFoundException('钓点不存在或未审核通过');
    }

    const [catchesRows, totalApproved, trendRaw] = await Promise.all([
      this.prisma.catch.findMany({
        where: {
          spotId,
          reviewStatus: 'approved',
          createdAt: { gte: sinceDays },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit + 1,
        include: {
          user: { select: { id: true, nickname: true, avatar: true } },
        },
      }),
      this.prisma.catch.count({
        where: {
          spotId,
          reviewStatus: 'approved',
          createdAt: { gte: sinceDays },
        },
      }),
      // 周趋势：按日聚合最近 7 天，不受 days 参数影响
      this.prisma.$queryRaw<{ day: string; cnt: bigint }[]>`
        SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS cnt
        FROM catches
        WHERE spot_id = ${spotId}
          AND review_status = 'approved'
          AND created_at >= ${new Date(Date.now() - 7 * 24 * 3600 * 1000)}
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    const hasMore = catchesRows.length > limit;
    const page = catchesRows.slice(0, limit);
    const trendMap = new Map<string, number>();
    for (const t of trendRaw) {
      trendMap.set(t.day, Number(t.cnt));
    }
    const weekTrend: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      weekTrend.push({ date: key, count: trendMap.get(key) ?? 0 });
    }

    return {
      catches: page.map((c) => ({
        id: c.id.toString(),
        userId: c.user.id.toString(),
        userName: c.user.nickname,
        userAvatar: c.user.avatar,
        photos: parseJsonField<string[]>(c.photos as string | string[] | null, []),
        fishSpecies: parseJsonField<string[]>(
          c.fishSpecies as string | string[] | null,
          [],
        ),
        weight: c.weightG,
        length: c.lengthCm,
        content: c.content,
        likeCount: c.likeCount,
        commentCount: c.commentCount,
        createdAt: c.createdAt.toISOString(),
      })),
      weekTrend,
      total: totalApproved,
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // "我的钓点" 列表 — 创建者维度（viewer 自看含 pending/rejected，
  // 看别人只看 approved）
  // ──────────────────────────────────────────────────────────────
  async listForUser(viewerId: bigint, dto: UserSpotsDto) {
    const targetId = dto.userId ? parseBigIntId(dto.userId, 'userId') : viewerId;
    const tab = dto.tab ?? 'all';
    const keyword = dto.keyword?.trim();
    const limit = dto.limit ?? 20;
    const offset = decodeCursor(dto.cursor);
    const isSelf = targetId === viewerId;

    const where: Prisma.SpotWhereInput = { creatorId: targetId };
    if (!isSelf) {
      // 别人只看 approved
      where.status = 'approved';
    } else if (tab === 'published') {
      where.status = 'approved';
    } else if (tab === 'review') {
      where.status = { in: ['pending', 'rejected'] };
    }
    // tab === 'all' 且 isSelf → 不加 status 过滤
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { city: { contains: keyword } },
      ];
    }

    const rows = await this.prisma.spot.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        name: true,
        type: true,
        waterType: true,
        lat: true,
        lng: true,
        address: true,
        city: true,
        status: true,
        photos: true,
        fishSpecies: true,
        avgRating: true,
        ratingCount: true,
        wantCount: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      list: page.map((s) => ({
        id: s.id.toString(),
        name: s.name,
        type: s.type,
        waterType: s.waterType,
        lat: s.lat.toNumber(),
        lng: s.lng.toNumber(),
        address: s.address,
        city: s.city,
        status: s.status,
        photos: parseJsonField<string[]>(s.photos as string | string[] | null, []),
        fishSpecies: parseJsonField<string[]>(
          s.fishSpecies as string | string[] | null,
          [],
        ),
        avgRating: s.avgRating.toNumber(),
        ratingCount: s.ratingCount,
        wantCount: s.wantCount,
        createdAt: s.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // "我的钓点" 统计 — total / 审核中 / 本月新增 / 最热钓点
  // ──────────────────────────────────────────────────────────────
  async statsForUser(viewerId: bigint, dto: UserSpotsStatsDto) {
    const targetId = dto.userId ? parseBigIntId(dto.userId, 'userId') : viewerId;
    const isSelf = targetId === viewerId;

    // 别人看到的 total 只含 approved；自己看含所有
    const baseWhere: Prisma.SpotWhereInput = isSelf
      ? { creatorId: targetId }
      : { creatorId: targetId, status: 'approved' };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, reviewing, monthAdd, hottest] = await Promise.all([
      this.prisma.spot.count({ where: baseWhere }),
      isSelf
        ? this.prisma.spot.count({
            where: { creatorId: targetId, status: 'pending' },
          })
        : Promise.resolve(0),
      this.prisma.spot.count({
        where: { ...baseWhere, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.spot.findFirst({
        where: { creatorId: targetId, status: 'approved' },
        orderBy: [{ wantCount: 'desc' }, { ratingCount: 'desc' }],
        select: { id: true, name: true, wantCount: true, ratingCount: true },
      }),
    ]);

    return {
      total,
      reviewing,
      monthAdd,
      hottest: hottest
        ? {
            id: hottest.id.toString(),
            name: hottest.name,
            wantCount: hottest.wantCount,
            ratingCount: hottest.ratingCount,
          }
        : null,
    };
  }
}
