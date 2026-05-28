import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListFavoritesDto, RemoveFavoriteDto } from './dto/favorites.dto';

type FavoriteKind = 'spot' | 'catch' | 'user';

export interface FavoriteItem {
  id: string;
  kind: FavoriteKind;
  tagText: string;
  name: string;
  meta: string;
  foot: string;
  createdAt: string;
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

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64');
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { o?: number };
    return Math.max(0, Math.floor(obj.o ?? 0));
  } catch {
    return 0;
  }
}

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: bigint, dto: ListFavoritesDto) {
    const type = dto.type ?? 'spot';
    const limit = dto.limit ?? 20;
    const offset = decodeCursor(dto.cursor);
    const counts = await this.counts(userId);
    const list = type === 'user'
      ? await this.listUsers(userId, offset, limit)
      : await this.listContent(userId, offset, limit);

    return {
      list: list.slice(0, limit),
      counts,
      nextCursor: list.length > limit ? encodeCursor(offset + limit) : null,
      hasMore: list.length > limit,
    };
  }

  async remove(userId: bigint, dto: RemoveFavoriteDto) {
    const id = parseBigIntId(dto.id, 'id');
    if (dto.kind === 'spot') {
      await this.prisma.spotWant.deleteMany({ where: { userId, spotId: id } });
    } else if (dto.kind === 'catch') {
      await this.prisma.catchFavorite.deleteMany({ where: { userId, catchId: id } });
    } else {
      await this.prisma.follow.deleteMany({ where: { followerId: userId, followeeId: id } });
    }
    return { ok: true };
  }

  private async counts(userId: bigint) {
    const [spot, catchCount, user] = await Promise.all([
      this.prisma.spotWant.count({ where: { userId } }),
      this.prisma.catchFavorite.count({ where: { userId } }),
      this.prisma.follow.count({ where: { followerId: userId } }),
    ]);
    return { spot: spot + catchCount, user };
  }

  private async listContent(userId: bigint, offset: number, limit: number): Promise<FavoriteItem[]> {
    const [spots, catches] = await Promise.all([
      this.prisma.spotWant.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { spot: true },
      }),
      this.prisma.catchFavorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          catch: {
            include: {
              user: { select: { nickname: true } },
              spot: { select: { name: true, city: true } },
            },
          },
        },
      }),
    ]);

    const list: FavoriteItem[] = [
      ...spots.map((x) => {
        const fish = parseJsonField<string[]>(x.spot.fishSpecies as Prisma.JsonValue | null, []);
        return {
          id: x.spot.id.toString(),
          kind: 'spot' as const,
          tagText: '钓点',
          name: x.spot.name,
          meta: [x.spot.city, fish.slice(0, 2).join('/')].filter(Boolean).join(' · ') || '收藏钓点',
          foot: x.spot.wantCount > 0 ? `${x.spot.wantCount} 人想去` : '已收藏',
          createdAt: x.createdAt.toISOString(),
        };
      }),
      ...catches.map((x) => {
        const fish = parseJsonField<string[]>(x.catch.fishSpecies as Prisma.JsonValue, []);
        const weight = x.catch.weightG ? `${Math.round(x.catch.weightG)}g` : '未记录重量';
        return {
          id: x.catch.id.toString(),
          kind: 'catch' as const,
          tagText: '鱼获',
          name: `${x.catch.user.nickname ?? '钓友'}的${fish[0] ?? '鱼获'}`,
          meta: x.catch.spot?.name ?? x.catch.spot?.city ?? '公开鱼获',
          foot: `${weight} · ${x.catch.likeCount} 赞`,
          createdAt: x.createdAt.toISOString(),
        };
      }),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return list.slice(offset, offset + limit + 1);
  }

  private async listUsers(userId: bigint, offset: number, limit: number): Promise<FavoriteItem[]> {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit + 1,
      include: { followee: true },
    });

    return follows.map((x) => {
      const styles = parseJsonField<string[]>(x.followee.playStyles as Prisma.JsonValue | null, []);
      return {
        id: x.followee.id.toString(),
        kind: 'user' as const,
        tagText: '钓友',
        name: x.followee.nickname ?? `钓友${x.followee.id.toString().slice(-4)}`,
        meta: [x.followee.city, styles.slice(0, 2).join('/')].filter(Boolean).join(' · ') || '已关注钓友',
        foot: x.followee.lastActiveAt ? `上次活跃 ${x.followee.lastActiveAt.toISOString().slice(5, 16)}` : '已关注',
        createdAt: x.createdAt.toISOString(),
      };
    });
  }
}
