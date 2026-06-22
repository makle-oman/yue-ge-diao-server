import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MessageHistoryDto,
  MessageThreadsDto,
  SendMessageDto,
} from './dto/messages.dto';

interface MessageRow {
  id: bigint;
  fromId: bigint;
  toId: bigint;
  content: string;
  type: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface MessageItem {
  id: string;
  fromId: string;
  toId: string;
  content: string;
  type: string;
  readAt: string | null;
  createdAt: string;
}

export interface MessageThreadItem {
  peer: {
    id: string;
    nickname: string | null;
    avatar: string | null;
  };
  lastMessage: MessageItem;
  unreadCount: number;
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

function toMessageItem(row: MessageRow): MessageItem {
  return {
    id: row.id.toString(),
    fromId: row.fromId.toString(),
    toId: row.toId.toString(),
    content: row.content,
    type: row.type,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async threads(viewerId: bigint, dto: MessageThreadsDto) {
    const limit = Math.min(Math.max(dto.limit ?? 20, 1), 50);
    const rows = await this.prisma.message.findMany({
      where: {
        OR: [{ fromId: viewerId }, { toId: viewerId }],
      },
      orderBy: { id: 'desc' },
      take: 200,
      include: {
        from: { select: { id: true, nickname: true, avatar: true } },
        to: { select: { id: true, nickname: true, avatar: true } },
      },
    });

    const unreadRows = await this.prisma.message.groupBy({
      by: ['fromId'],
      where: { toId: viewerId, readAt: null },
      _count: { _all: true },
    });
    const unreadMap = new Map(
      unreadRows.map((r) => [r.fromId.toString(), r._count._all]),
    );

    const seen = new Set<string>();
    const list: MessageThreadItem[] = [];
    for (const row of rows) {
      const peer = row.fromId === viewerId ? row.to : row.from;
      const peerId = peer.id.toString();
      if (seen.has(peerId)) continue;
      seen.add(peerId);
      list.push({
        peer: {
          id: peerId,
          nickname: peer.nickname,
          avatar: peer.avatar,
        },
        lastMessage: toMessageItem(row),
        unreadCount: unreadMap.get(peerId) ?? 0,
      });
      if (list.length >= limit) break;
    }

    return { list };
  }

  async history(viewerId: bigint, dto: MessageHistoryDto) {
    const peerId = parseBigIntId(dto.peerId, 'peerId');
    const cursorId = dto.cursor ? parseBigIntId(dto.cursor, 'cursor') : null;
    const limit = Math.min(Math.max(dto.limit ?? 30, 1), 50);

    const peer = await this.prisma.user.findUnique({
      where: { id: peerId },
      select: { id: true, status: true },
    });
    if (!peer || peer.status !== 'active') {
      throw new NotFoundException('用户不存在');
    }

    const rows = await this.prisma.message.findMany({
      where: {
        OR: [
          { fromId: viewerId, toId: peerId },
          { fromId: peerId, toId: viewerId },
        ],
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    await this.prisma.message.updateMany({
      where: { fromId: peerId, toId: viewerId, readAt: null },
      data: { readAt: new Date() },
    });

    const page = rows.slice(0, limit);
    const oldest = page[page.length - 1];
    return {
      list: page.reverse().map(toMessageItem),
      nextCursor: rows.length > limit && oldest ? oldest.id.toString() : null,
      hasMore: rows.length > limit,
    };
  }

  async send(viewerId: bigint, dto: SendMessageDto): Promise<MessageItem> {
    const toUserId = parseBigIntId(dto.toUserId, 'toUserId');
    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('消息内容不能为空');
    }
    if (toUserId === viewerId) {
      throw new BadRequestException('不能给自己发送消息');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, status: true },
    });
    if (!target || target.status !== 'active') {
      throw new NotFoundException('用户不存在');
    }

    const row = await this.prisma.message.create({
      data: {
        fromId: viewerId,
        toId: toUserId,
        content,
        type: dto.type ?? 'text',
      },
    });
    return toMessageItem(row);
  }
}
