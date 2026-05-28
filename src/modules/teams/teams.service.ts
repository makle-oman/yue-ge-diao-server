import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  distanceM,
  encode as geohashEncode,
  neighbors as geohashNeighbors,
  precisionForRadius,
} from '../../common/utils/geohash';
import {
  ApplyTeamDto,
  CreateTeamDto,
  ListTeamsDto,
  ReviewMemberDto,
  TeamIdDto,
  UserTeamsDto,
} from './dto/teams.dto';

type Nullable<T> = T | null | undefined;

export interface TeamListItem {
  id: string;
  title: string;
  spotId: string;
  spotName: string;
  spotCity: string | null;
  startTime: string;
  endTime: string;
  targetFish: string[];
  maxPeople: number;
  joinedCount: number;
  costMode: string; // 'aa' | 'host' | 'self'
  needCarpool: boolean;
  status: string; // 'recruiting' | 'full' | ...
  note: string | null;
  distance?: number; // 米；仅 nearby 列表带
  owner: {
    id: string;
    name: string | null;
    avatar: string | null;
  };
  yourMemberStatus: string | null; // 'pending' | 'approved' | 'rejected' | 'cancelled' | null
  createdAt: string;
}

export interface TeamDetail extends TeamListItem {
  members: Array<{
    userId: string;
    name: string | null;
    avatar: string | null;
    status: string;
    message: string | null;
    appliedAt: string;
    reviewedAt: string | null;
  }>;
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

/** 计算本周末（周六 00:00 — 周日 23:59:59.999） */
function weekendRange(now: Date): { from: Date; to: Date } {
  const day = now.getDay(); // 0=Sun ... 6=Sat
  const offsetToSat = (6 - day + 7) % 7; // 距下个周六（含今天若是周六=0）
  const sat = new Date(now);
  sat.setDate(now.getDate() + offsetToSat);
  sat.setHours(0, 0, 0, 0);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  sun.setHours(23, 59, 59, 999);
  return { from: sat, to: sun };
}

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // 列表：附近 / 本周末 / 可拼车 / 全部
  // ──────────────────────────────────────────────────────────────
  async list(viewerId: bigint | null, dto: ListTeamsDto) {
    const filter = dto.filter ?? 'all';
    const limit = Math.min(Math.max(dto.limit ?? 20, 1), 50);
    const offset = decodeCursor(dto.cursor);

    if (filter === 'nearby') {
      if (dto.lat == null || dto.lng == null) {
        throw new BadRequestException('nearby 过滤必须传 lat/lng');
      }
      return this.listNearby(
        viewerId,
        dto.lat,
        dto.lng,
        dto.radius ?? 50_000,
        limit,
        offset,
      );
    }

    const where: Prisma.TeamWhereInput = {
      status: { in: ['recruiting', 'full'] },
      endTime: { gte: new Date() },
    };
    if (filter === 'weekend') {
      const { from, to } = weekendRange(new Date());
      where.startTime = { gte: from, lte: to };
    } else if (filter === 'carpool') {
      where.needCarpool = true;
    }

    const rows = await this.prisma.team.findMany({
      where,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit + 1,
      include: {
        owner: { select: { id: true, nickname: true, avatar: true } },
        spot: { select: { id: true, name: true, city: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const memberMap = await this.fetchMyMemberStatus(
      viewerId,
      page.map((t) => t.id),
    );

    return {
      list: page.map((t) => this.mapTeamRow(t, memberMap)),
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

    // 通过 spots.geohash 限定附近钓点，再 join teams
    const spots = await this.prisma.$queryRaw<
      Array<{ id: bigint; lat: string | number; lng: string | number }>
    >`
      SELECT id, lat, lng
      FROM spots
      WHERE status = 'approved'
        AND LEFT(geohash, ${precision}) IN (${Prisma.join(prefixes)})
      LIMIT 500
    `;
    if (spots.length === 0) {
      return { list: [], nextCursor: null, hasMore: false };
    }
    const distById = new Map<string, number>();
    for (const s of spots) {
      const sLat = toNum(s.lat);
      const sLng = toNum(s.lng);
      const d = distanceM(lat, lng, sLat, sLng);
      if (d <= radius) distById.set(s.id.toString(), d);
    }
    const spotIds = [...distById.keys()].map((k) => BigInt(k));
    if (spotIds.length === 0) {
      return { list: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.team.findMany({
      where: {
        spotId: { in: spotIds },
        status: { in: ['recruiting', 'full'] },
        endTime: { gte: new Date() },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      include: {
        owner: { select: { id: true, nickname: true, avatar: true } },
        spot: { select: { id: true, name: true, city: true } },
      },
      take: 200,
    });

    // 按距离排序（spot 距离）
    const enriched = rows
      .map((t) => ({
        row: t,
        dist: distById.get(t.spotId.toString()) ?? Infinity,
      }))
      .sort((a, b) => a.dist - b.dist);

    const page = enriched.slice(offset, offset + limit);
    const hasMore = enriched.length > offset + limit;
    const memberMap = await this.fetchMyMemberStatus(
      viewerId,
      page.map((x) => x.row.id),
    );

    return {
      list: page.map((x) => this.mapTeamRow(x.row, memberMap, x.dist)),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }

  private async fetchMyMemberStatus(
    viewerId: bigint | null,
    teamIds: bigint[],
  ): Promise<Map<string, string>> {
    if (!viewerId || teamIds.length === 0) return new Map();
    const rows = await this.prisma.teamMember.findMany({
      where: { userId: viewerId, teamId: { in: teamIds } },
      select: { teamId: true, status: true },
    });
    return new Map(rows.map((r) => [r.teamId.toString(), r.status]));
  }

  private mapTeamRow(
    t: Prisma.TeamGetPayload<{
      include: {
        owner: { select: { id: true; nickname: true; avatar: true } };
        spot: { select: { id: true; name: true; city: true } };
      };
    }>,
    memberMap: Map<string, string>,
    distance?: number,
  ): TeamListItem {
    const targetFish = parseJsonField<string[]>(t.targetFish as unknown, []);
    const fishLabel = targetFish.length > 0 ? '主攻 ' + targetFish.join('/') : '';
    const title = [t.spot.name, fishLabel].filter(Boolean).join(' · ') || '组队';
    return {
      id: t.id.toString(),
      title,
      spotId: t.spot.id.toString(),
      spotName: t.spot.name,
      spotCity: t.spot.city,
      startTime: t.startTime.toISOString(),
      endTime: t.endTime.toISOString(),
      targetFish,
      maxPeople: t.maxPeople,
      joinedCount: t.joinedCount,
      costMode: t.costMode,
      needCarpool: t.needCarpool,
      status: t.status,
      note: t.note,
      distance:
        distance != null && Number.isFinite(distance)
          ? Math.round(distance)
          : undefined,
      owner: {
        id: t.owner.id.toString(),
        name: t.owner.nickname,
        avatar: t.owner.avatar,
      },
      yourMemberStatus: memberMap.get(t.id.toString()) ?? null,
      createdAt: t.createdAt.toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 详情
  // ──────────────────────────────────────────────────────────────
  async detail(viewerId: bigint | null, dto: TeamIdDto): Promise<TeamDetail> {
    const id = parseBigIntId(dto.teamId, 'teamId');
    const t = await this.prisma.team.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, nickname: true, avatar: true } },
        spot: { select: { id: true, name: true, city: true } },
        members: {
          orderBy: [{ status: 'asc' }, { appliedAt: 'asc' }],
          include: {
            user: { select: { id: true, nickname: true, avatar: true } },
          },
        },
      },
    });
    if (!t) throw new NotFoundException('组队不存在');

    const memberMap = await this.fetchMyMemberStatus(viewerId, [t.id]);
    const base = this.mapTeamRow(t, memberMap);

    return {
      ...base,
      members: t.members.map((m) => ({
        userId: m.user.id.toString(),
        name: m.user.nickname,
        avatar: m.user.avatar,
        status: m.status,
        // 非队长 / 非本人不返回 message（避免泄露申请话术）
        message:
          viewerId != null &&
          (viewerId === t.ownerId || viewerId === m.userId)
            ? m.message
            : null,
        appliedAt: m.appliedAt.toISOString(),
        reviewedAt: m.reviewedAt ? m.reviewedAt.toISOString() : null,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // 创建组队（owner 自动 approved 入队）
  // ──────────────────────────────────────────────────────────────
  async create(userId: bigint, dto: CreateTeamDto) {
    const spotId = parseBigIntId(dto.spotId, 'spotId');
    const spot = await this.prisma.spot.findUnique({
      where: { id: spotId },
      select: { id: true, status: true },
    });
    if (!spot) throw new NotFoundException('关联钓点不存在');
    if (spot.status !== 'approved') {
      throw new BadRequestException('关联钓点尚未审核通过,请稍后再试');
    }

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('开始/结束时间格式错误');
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }
    if (start.getTime() < Date.now() - 5 * 60 * 1000) {
      throw new BadRequestException('开始时间不能早于当前时间');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const t = await tx.team.create({
        data: {
          ownerId: userId,
          spotId,
          startTime: start,
          endTime: end,
          targetFish:
            dto.targetFish && dto.targetFish.length
              ? (dto.targetFish as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          maxPeople: dto.maxPeople,
          costMode: dto.costMode,
          needCarpool: dto.needCarpool ?? false,
          note: dto.note ?? null,
          status: 'recruiting',
          joinedCount: 1,
        },
        select: { id: true },
      });
      await tx.teamMember.create({
        data: {
          teamId: t.id,
          userId,
          status: 'approved',
          reviewedAt: new Date(),
        },
      });
      return t;
    });

    return { id: created.id.toString() };
  }

  // ──────────────────────────────────────────────────────────────
  // 申请加入
  // ──────────────────────────────────────────────────────────────
  async apply(userId: bigint, dto: ApplyTeamDto) {
    const teamId = parseBigIntId(dto.teamId, 'teamId');
    const result = await this.prisma.$transaction(async (tx) => {
      const t = await tx.team.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          ownerId: true,
          status: true,
          maxPeople: true,
          joinedCount: true,
          endTime: true,
          spot: { select: { name: true } },
        },
      });
      if (!t) throw new NotFoundException('组队不存在');
      if (t.ownerId === userId) {
        throw new BadRequestException('你是队长,无需申请');
      }
      if (t.status !== 'recruiting') {
        throw new BadRequestException('该组队当前不接受报名');
      }
      if (t.endTime.getTime() <= Date.now()) {
        throw new BadRequestException('该组队已结束');
      }
      if (t.joinedCount >= t.maxPeople) {
        throw new BadRequestException('已满员');
      }

      const existing = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
        select: { status: true },
      });
      if (existing) {
        if (existing.status === 'pending') {
          throw new ConflictException('已申请,等待审核');
        }
        if (existing.status === 'approved') {
          throw new ConflictException('已加入该组队');
        }
        // rejected / cancelled → 重新申请
        await tx.teamMember.update({
          where: { teamId_userId: { teamId, userId } },
          data: {
            status: 'pending',
            message: dto.message ?? null,
            appliedAt: new Date(),
            reviewedAt: null,
          },
        });
      } else {
        await tx.teamMember.create({
          data: {
            teamId,
            userId,
            status: 'pending',
            message: dto.message ?? null,
          },
        });
      }
      return {
        ok: true as const,
        status: 'pending' as const,
        ownerId: t.ownerId,
        spotName: t.spot?.name ?? null,
      };
    });

    await this.notifications.emit({
      type: 'team_apply',
      recipientId: result.ownerId,
      actorId: userId,
      refType: 'team',
      refId: teamId,
      payload: {
        message: dto.message ?? null,
        spotName: result.spotName,
      },
    });

    return { ok: result.ok, status: result.status };
  }

  // ──────────────────────────────────────────────────────────────
  // 撤销自己的申请
  // ──────────────────────────────────────────────────────────────
  async cancelApply(userId: bigint, dto: TeamIdDto) {
    const teamId = parseBigIntId(dto.teamId, 'teamId');
    const result = await this.prisma.$transaction(async (tx) => {
      const t = await tx.team.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          ownerId: true,
          status: true,
          maxPeople: true,
          joinedCount: true,
          spot: { select: { name: true } },
        },
      });
      if (!t) throw new NotFoundException('组队不存在');
      if (t.ownerId === userId) {
        throw new BadRequestException('队长不能撤销,请取消整个组队');
      }
      const m = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
        select: { status: true },
      });
      if (!m) throw new NotFoundException('没有申请记录');
      if (m.status === 'cancelled' || m.status === 'rejected') {
        return {
          ok: true as const,
          status: m.status,
          notifyLeft: false,
          ownerId: t.ownerId,
          spotName: t.spot?.name ?? null,
        };
      }
      const wasApproved = m.status === 'approved';
      await tx.teamMember.update({
        where: { teamId_userId: { teamId, userId } },
        data: { status: 'cancelled', reviewedAt: new Date() },
      });
      if (wasApproved) {
        // approved → cancelled，joinedCount 减 1；若原状态是 full，自动回到 recruiting
        const next = Math.max(0, t.joinedCount - 1);
        await tx.team.update({
          where: { id: teamId },
          data: {
            joinedCount: next,
            status: t.status === 'full' ? 'recruiting' : t.status,
          },
        });
      }
      return {
        ok: true as const,
        status: 'cancelled' as const,
        notifyLeft: wasApproved,
        ownerId: t.ownerId,
        spotName: t.spot?.name ?? null,
      };
    });

    if (result.notifyLeft) {
      await this.notifications.emit({
        type: 'team_member_left',
        recipientId: result.ownerId,
        actorId: userId,
        refType: 'team',
        refId: teamId,
        payload: { spotName: result.spotName },
      });
    }

    return { ok: result.ok, status: result.status };
  }

  // ──────────────────────────────────────────────────────────────
  // 队长审核
  // ──────────────────────────────────────────────────────────────
  async review(userId: bigint, dto: ReviewMemberDto) {
    const teamId = parseBigIntId(dto.teamId, 'teamId');
    const targetUserId = parseBigIntId(dto.userId, 'userId');
    const result = await this.prisma.$transaction(async (tx) => {
      const t = await tx.team.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          ownerId: true,
          status: true,
          maxPeople: true,
          joinedCount: true,
          spot: { select: { name: true } },
        },
      });
      if (!t) throw new NotFoundException('组队不存在');
      if (t.ownerId !== userId) {
        throw new ForbiddenException('只有队长可以审核');
      }
      const m = await tx.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: targetUserId } },
        select: { status: true },
      });
      if (!m) throw new NotFoundException('没有该申请');
      if (m.status !== 'pending') {
        throw new BadRequestException(`该申请已 ${m.status},不能再处理`);
      }

      if (dto.action === 'approve') {
        if (t.joinedCount >= t.maxPeople) {
          throw new BadRequestException('已满员');
        }
        await tx.teamMember.update({
          where: { teamId_userId: { teamId, userId: targetUserId } },
          data: { status: 'approved', reviewedAt: new Date() },
        });
        const next = t.joinedCount + 1;
        const nextStatus =
          next >= t.maxPeople && t.status === 'recruiting' ? 'full' : t.status;
        await tx.team.update({
          where: { id: teamId },
          data: { joinedCount: next, status: nextStatus },
        });
        return {
          ok: true as const,
          status: 'approved' as const,
          spotName: t.spot?.name ?? null,
        };
      }
      // reject
      await tx.teamMember.update({
        where: { teamId_userId: { teamId, userId: targetUserId } },
        data: { status: 'rejected', reviewedAt: new Date() },
      });
      return {
        ok: true as const,
        status: 'rejected' as const,
        spotName: t.spot?.name ?? null,
      };
    });

    await this.notifications.emit({
      type:
        result.status === 'approved'
          ? 'team_review_approved'
          : 'team_review_rejected',
      recipientId: targetUserId,
      actorId: userId,
      refType: 'team',
      refId: teamId,
      payload: { spotName: result.spotName },
    });

    return { ok: result.ok, status: result.status };
  }

  // ──────────────────────────────────────────────────────────────
  // 我（或他人）发起 / 参与的组队
  // ──────────────────────────────────────────────────────────────
  async listForUser(viewerId: bigint, dto: UserTeamsDto) {
    const targetId = dto.userId
      ? parseBigIntId(dto.userId, 'userId')
      : viewerId;
    const role = dto.role ?? 'all';
    const limit = Math.min(Math.max(dto.limit ?? 20, 1), 50);
    const offset = decodeCursor(dto.cursor);

    const where: Prisma.TeamWhereInput = {};
    if (role === 'owner') {
      where.ownerId = targetId;
    } else if (role === 'joined') {
      where.members = {
        some: { userId: targetId, status: 'approved' },
      };
      where.ownerId = { not: targetId };
    } else {
      where.OR = [
        { ownerId: targetId },
        { members: { some: { userId: targetId, status: 'approved' } } },
      ];
    }

    const rows = await this.prisma.team.findMany({
      where,
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      include: {
        owner: { select: { id: true, nickname: true, avatar: true } },
        spot: { select: { id: true, name: true, city: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const memberMap = await this.fetchMyMemberStatus(
      viewerId,
      page.map((t) => t.id),
    );

    return {
      list: page.map((t) => this.mapTeamRow(t, memberMap)),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      hasMore,
    };
  }
}
