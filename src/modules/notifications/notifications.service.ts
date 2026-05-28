import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListNotificationsDto,
  MarkReadDto,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationType,
} from './dto/notifications.dto';

type Nullable<T> = T | null | undefined;

interface CursorPayload {
  t: number; // createdAt(ms)
  i: string; // notification id (string)
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}
function decodeCursor(cursor: Nullable<string>): CursorPayload | null {
  if (!cursor) return null;
  try {
    const obj = JSON.parse(
      Buffer.from(cursor, 'base64').toString('utf8'),
    ) as Partial<CursorPayload>;
    if (typeof obj.t !== 'number' || typeof obj.i !== 'string') return null;
    return { t: obj.t, i: obj.i };
  } catch {
    return null;
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

const TYPE_TO_GROUP: Record<NotificationType, NotificationGroup> = {
  catch_like: 'like',
  catch_collect: 'like',
  comment_like: 'like',
  catch_comment: 'comment',
  comment_reply: 'comment',
  team_apply: 'team',
  team_review_approved: 'team',
  team_review_rejected: 'team',
  team_member_left: 'team',
};

function typesOfGroup(group: NotificationGroup): NotificationType[] {
  return (Object.keys(TYPE_TO_GROUP) as NotificationType[]).filter(
    (t) => TYPE_TO_GROUP[t] === group,
  );
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  group: NotificationGroup;
  refType: string | null;
  refId: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    avatar: string | null;
  } | null;
}

export interface EmitParams {
  type: NotificationType;
  recipientId: bigint;
  actorId?: bigint | null;
  refType?: string | null;
  refId?: bigint | null;
  payload?: Record<string, unknown> | null;
  /**
   * 一些事件天然幂等(如:同一个人多次申请同一组队、点赞→取消→再点赞),
   * 传 tx 时本方法会在同事务内插入;不传则用普通 prisma 客户端。
   */
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写入一条通知(自己给自己的事件直接跳过)。
   * 设计成「失败不阻塞主流程」:在主 service 调用处用 try/catch 包裹。
   */
  async emit(params: EmitParams): Promise<void> {
    if (params.actorId != null && params.actorId === params.recipientId) {
      return;
    }
    const client = params.tx ?? this.prisma;
    try {
      await client.notification.create({
        data: {
          userId: params.recipientId,
          type: params.type,
          actorId: params.actorId ?? null,
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          payload:
            params.payload != null
              ? (params.payload as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
      });
    } catch (e) {
      this.logger.warn(
        `[notification.emit] type=${params.type} recipient=${params.recipientId} failed: ${String(e)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 列表
  // ──────────────────────────────────────────────────────────────
  async list(viewerId: bigint, dto: ListNotificationsDto) {
    const limit = Math.min(Math.max(dto.limit ?? 20, 1), 50);
    const cursor = decodeCursor(dto.cursor);

    const typeFilter: Prisma.NotificationWhereInput = {};
    if (dto.type) {
      typeFilter.type = dto.type;
    } else if (dto.group) {
      typeFilter.type = { in: typesOfGroup(dto.group) };
    }

    const where: Prisma.NotificationWhereInput = {
      userId: viewerId,
      ...typeFilter,
      ...(dto.unreadOnly ? { readAt: null } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.t) } },
              {
                AND: [
                  { createdAt: new Date(cursor.t) },
                  { id: { lt: BigInt(cursor.i) } },
                ],
              },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        actor: { select: { id: true, nickname: true, avatar: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor = hasMore
      ? encodeCursor({
          t: page[page.length - 1].createdAt.getTime(),
          i: page[page.length - 1].id.toString(),
        })
      : null;

    const list: NotificationItem[] = page.map((n) => {
      const type = n.type as NotificationType;
      const group = TYPE_TO_GROUP[type] ?? 'system';
      let payload: Record<string, unknown> | null = null;
      if (n.payload != null) {
        if (typeof n.payload === 'string') {
          try {
            payload = JSON.parse(n.payload) as Record<string, unknown>;
          } catch {
            payload = null;
          }
        } else {
          payload = n.payload as unknown as Record<string, unknown>;
        }
      }
      return {
        id: n.id.toString(),
        type,
        group,
        refType: n.refType,
        refId: n.refId ? n.refId.toString() : null,
        payload,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
        actor: n.actor
          ? {
              id: n.actor.id.toString(),
              name: n.actor.nickname,
              avatar: n.actor.avatar,
            }
          : null,
      };
    });

    return { list, nextCursor, hasMore };
  }

  // ──────────────────────────────────────────────────────────────
  // 未读数(总数 + 各 group 分组)
  // ──────────────────────────────────────────────────────────────
  async unreadCount(viewerId: bigint) {
    const grouped = await this.prisma.notification.groupBy({
      by: ['type'],
      where: { userId: viewerId, readAt: null },
      _count: { _all: true },
    });
    const counts: Record<NotificationGroup, number> = {
      comment: 0,
      like: 0,
      team: 0,
      system: 0,
    };
    let total = 0;
    for (const g of grouped) {
      const t = g.type as NotificationType;
      const grp = TYPE_TO_GROUP[t] ?? 'system';
      counts[grp] += g._count._all;
      total += g._count._all;
    }
    return { total, byGroup: counts };
  }

  // ──────────────────────────────────────────────────────────────
  // 标记已读
  // ──────────────────────────────────────────────────────────────
  async markRead(viewerId: bigint, dto: MarkReadDto) {
    if (!dto.ids && !dto.all) {
      throw new BadRequestException('需要传 ids 或 all=true');
    }
    const where: Prisma.NotificationWhereInput = {
      userId: viewerId,
      readAt: null,
    };
    if (dto.ids && dto.ids.length > 0) {
      where.id = { in: dto.ids.map((i) => parseBigIntId(i, 'id')) };
    }
    if (dto.group) {
      where.type = { in: typesOfGroup(dto.group) };
    }
    const r = await this.prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }
}

// 给外部 module 复用(避免每个事件源都自己拼字符串)
export { NOTIFICATION_GROUPS };
