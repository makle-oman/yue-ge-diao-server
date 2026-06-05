import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FishLibraryDto } from './dto/fishes.dto';

export type FishCategory = 'fresh' | 'sea';
export type FishRarity = 'rare' | 'epic' | 'legendary';

interface CatalogFish {
  name: string;
  category: FishCategory;
  common: boolean;
  rarity?: FishRarity;
  image?: string;
}

export interface FishLibraryItem {
  name: string;
  category: FishCategory;
  common: boolean;
  rarity?: FishRarity;
  image?: string;
  unlocked: boolean;
  firstCatchAt: string | null;
  maxWeightG: number | null;
}

const CATALOG: CatalogFish[] = [
  { name: '鲫鱼', category: 'fresh', common: true },
  { name: '鲤鱼', category: 'fresh', common: true },
  { name: '草鱼', category: 'fresh', common: true },
  { name: '鲢鳙', category: 'fresh', common: true },
  { name: '黑鱼', category: 'fresh', common: true },
  { name: '翘嘴', category: 'fresh', common: true },
  { name: '黄颡鱼', category: 'fresh', common: true },
  { name: '鲶鱼', category: 'fresh', common: true },
  { name: '罗非鱼', category: 'fresh', common: true },
  { name: '鳊鱼', category: 'fresh', common: true },
  { name: '鲮鱼', category: 'fresh', common: true },
  { name: '白条', category: 'fresh', common: true },
  { name: '麦穗鱼', category: 'fresh', common: true },
  { name: '泥鳅', category: 'fresh', common: true },
  { name: '鳜鱼', category: 'fresh', common: false, rarity: 'rare' },
  { name: '青鱼', category: 'fresh', common: false, rarity: 'epic' },
  { name: '鲈鱼', category: 'fresh', common: true },
  { name: '海鲈', category: 'sea', common: true },
  { name: '黄花鱼', category: 'sea', common: true },
  { name: '小黄鱼', category: 'sea', common: true },
  { name: '鲷鱼', category: 'sea', common: true },
  { name: '真鲷', category: 'sea', common: true },
  { name: '黑鲷', category: 'sea', common: true },
  { name: '黄鳍鲷', category: 'sea', common: true },
  { name: '马鲛鱼', category: 'sea', common: true },
  { name: '鲅鱼', category: 'sea', common: true },
  { name: '带鱼', category: 'sea', common: true },
  { name: '鲳鱼', category: 'sea', common: true },
  { name: '鲐鱼', category: 'sea', common: true },
  { name: '竹荚鱼', category: 'sea', common: true },
  { name: '海鲫', category: 'sea', common: true },
  { name: '剥皮鱼', category: 'sea', common: true },
  { name: '梭鱼', category: 'sea', common: true },
  { name: '鲻鱼', category: 'sea', common: true },
  { name: '沙丁鱼', category: 'sea', common: true },
  { name: '鳕鱼', category: 'sea', common: true },
  { name: '石斑', category: 'sea', common: false, rarity: 'rare' },
  { name: '石九公', category: 'sea', common: false, rarity: 'legendary' },
];

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

@Injectable()
export class FishesService {
  constructor(private readonly prisma: PrismaService) {}

  async library(userId: bigint, dto: FishLibraryDto) {
    const catches = await this.prisma.catch.findMany({
      where: { userId, reviewStatus: 'approved' },
      select: { fishSpecies: true, weightG: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const record = new Map<string, { firstCatchAt: Date; maxWeightG: number | null }>();

    for (const c of catches) {
      const names = parseJsonField<string[]>(c.fishSpecies as Prisma.JsonValue, []);
      for (const name of names) {
        const old = record.get(name);
        record.set(name, {
          firstCatchAt: old?.firstCatchAt ?? c.createdAt,
          maxWeightG: Math.max(old?.maxWeightG ?? 0, c.weightG ?? 0) || null,
        });
      }
    }

    const list = CATALOG
      .map((f): FishLibraryItem => {
        const r = record.get(f.name);
        return {
          name: f.name,
          category: f.category,
          common: f.common,
          rarity: f.rarity,
          image: f.image,
          unlocked: !!r,
          firstCatchAt: r?.firstCatchAt.toISOString() ?? null,
          maxWeightG: r?.maxWeightG ?? null,
        };
      });

    return {
      list: this.filterLibrary(list, dto),
      stats: this.stats(list),
    };
  }

  async progress(userId: bigint) {
    const { stats } = await this.library(userId, {});
    return stats;
  }

  listCatalog(dto: FishLibraryDto) {
    return {
      list: CATALOG
        .filter((f) => !dto.category || f.category === dto.category)
        .map((f) => ({ ...f })),
    };
  }

  private stats(list: Array<{ category: FishCategory; unlocked: boolean }>) {
    const fresh = list.filter((f) => f.category === 'fresh');
    const sea = list.filter((f) => f.category === 'sea');
    return {
      fresh: {
        done: fresh.filter((f) => f.unlocked).length,
        total: fresh.length,
      },
      sea: {
        done: sea.filter((f) => f.unlocked).length,
        total: sea.length,
      },
    };
  }

  private filterLibrary(list: FishLibraryItem[], dto: FishLibraryDto) {
    return list.filter((f) => {
      if (dto.category && f.category !== dto.category) return false;
      switch (dto.filter ?? 'all') {
        case 'common': return f.common;
        case 'rare': return !!f.rarity;
        case 'locked': return !f.unlocked;
        default: return true;
      }
    });
  }
}
