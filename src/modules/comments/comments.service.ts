import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CommentIdDto,
  CreateCommentDto,
  LikeCommentDto,
  ListCommentsDto,
} from './dto/comments.dto';

type Nullable<T> = T | null | undefined;

export interface CommentItem {
  id: string;
  catchId: string;
  parentId: string | null;
  content: string;
  likeCount: number;
  likedByMe: boolean;
  userId: string;
  userName: string | null;
  userAvatar: string | null;
  isAuthor: boolean; // 该评论作者是不是鱼获主
  createdAt: string;
  replies?: CommentItem[];
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

interface CursorPayload {
  // 时间游标：以 createdAt(ms) + id 为复合键，避免同毫秒并列丢条
  t: number;
  i: string;
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

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 列出某鱼获下的评论（一级评论分页，二级 reply 整组展开）
   * - sort=hot：likeCount DESC, createdAt DESC
   * - sort=new：createdAt DESC（默认）
   * - 游标对 new 生效；hot 走 offset（每页固定，不支持深翻）
   */
  async list(viewerId: bigint | null, dto: ListCommentsDto) {
    const catchId = parseBigIntId(dto.catchId, 'catchId');
    const sort = dto.sort ?? 'new';
    const limit = Math.min(Math.max(dto.limit ?? 20, 1), 50);

    const meta = await this.prisma.catch.findUnique({
      where: { id: catchId },
      select: { id: true, userId: true, reviewStatus: true, allowComments: true },
    });
    if (!meta || meta.reviewStatus !== 'approved') {
      throw new NotFoundException('鱼获不存在或未审核通过');
    }
    const authorId = meta.userId;

    // 1) 拉一级评论
    let parents: Array<{
      id: bigint;
      catchId: bigint;
      parentId: bigint | null;
      content: string;
      likeCount: number;
      createdAt: Date;
      userId: bigint;
    }> = [];
    let nextCursor: string | null = null;

    if (sort === 'new') {
      const cursor = decodeCursor(dto.cursor);
      const where: Prisma.CommentWhereInput = {
        catchId,
        parentId: null,
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
      const rows = await this.prisma.comment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          catchId: true,
          parentId: true,
          content: true,
          likeCount: true,
          createdAt: true,
          userId: true,
        },
      });
      const sliced = rows.slice(0, limit);
      parents = sliced;
      if (rows.length > limit) {
        const last = sliced[sliced.length - 1];
        nextCursor = encodeCursor({
          t: last.createdAt.getTime(),
          i: last.id.toString(),
        });
      }
    } else {
      // hot：按 likeCount/createdAt 排，cursor 用 offset 简化
      const offset = (() => {
        const c = decodeCursor(dto.cursor);
        return c ? Math.max(0, c.t) : 0;
      })();
      const rows = await this.prisma.comment.findMany({
        where: { catchId, parentId: null },
        orderBy: [{ likeCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit + 1,
        select: {
          id: true,
          catchId: true,
          parentId: true,
          content: true,
          likeCount: true,
          createdAt: true,
          userId: true,
        },
      });
      const sliced = rows.slice(0, limit);
      parents = sliced;
      if (rows.length > limit) {
        nextCursor = encodeCursor({ t: offset + limit, i: '' });
      }
    }

    if (parents.length === 0) {
      const total = await this.prisma.comment.count({ where: { catchId } });
      return { list: [], nextCursor: null, total };
    }

    // 2) 拉这些一级评论下的所有二级 reply（不分页，整组返回）
    const parentIds = parents.map((p) => p.id);
    const replies = await this.prisma.comment.findMany({
      where: { catchId, parentId: { in: parentIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        catchId: true,
        parentId: true,
        content: true,
        likeCount: true,
        createdAt: true,
        userId: true,
      },
    });

    // 3) 用户信息批量查
    const userIds = new Set<bigint>();
    parents.forEach((p) => userIds.add(p.userId));
    replies.forEach((r) => userIds.add(r.userId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, nickname: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.id.toString(), u]));

    // 4) 当前用户点过赞的评论集合
    let likedSet = new Set<string>();
    if (viewerId) {
      const allIds = [...parents.map((p) => p.id), ...replies.map((r) => r.id)];
      const likes = await this.prisma.commentLike.findMany({
        where: {
          userId: viewerId,
          commentId: { in: allIds },
        },
        select: { commentId: true },
      });
      likedSet = new Set(likes.map((l) => l.commentId.toString()));
    }

    const toItem = (
      row: (typeof parents)[number],
      withReplies = false,
    ): CommentItem => {
      const u = userMap.get(row.userId.toString());
      const item: CommentItem = {
        id: row.id.toString(),
        catchId: row.catchId.toString(),
        parentId: row.parentId ? row.parentId.toString() : null,
        content: row.content,
        likeCount: row.likeCount,
        likedByMe: likedSet.has(row.id.toString()),
        userId: row.userId.toString(),
        userName: u?.nickname ?? null,
        userAvatar: u?.avatar ?? null,
        isAuthor: row.userId === authorId,
        createdAt: row.createdAt.toISOString(),
      };
      if (withReplies) item.replies = [];
      return item;
    };

    const repliesByParent = new Map<string, CommentItem[]>();
    for (const r of replies) {
      const pid = r.parentId!.toString();
      const arr = repliesByParent.get(pid) ?? [];
      arr.push(toItem(r));
      repliesByParent.set(pid, arr);
    }

    const list: CommentItem[] = parents.map((p) => {
      const item = toItem(p, true);
      item.replies = repliesByParent.get(p.id.toString()) ?? [];
      return item;
    });

    const total = await this.prisma.comment.count({ where: { catchId } });
    return { list, nextCursor, total, allowComments: meta.allowComments };
  }

  /** 列出一条鱼获下最新 N 条评论摘要（用于详情页预览，不分页） */
  async previewLatest(viewerId: bigint | null, catchIdRaw: string, take = 3) {
    const catchId = parseBigIntId(catchIdRaw, 'catchId');
    const meta = await this.prisma.catch.findUnique({
      where: { id: catchId },
      select: { id: true, reviewStatus: true, commentCount: true },
    });
    if (!meta || meta.reviewStatus !== 'approved') {
      return { list: [], total: 0 };
    }
    const rows = await this.prisma.comment.findMany({
      where: { catchId, parentId: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        catchId: true,
        parentId: true,
        content: true,
        likeCount: true,
        createdAt: true,
        userId: true,
      },
    });
    if (rows.length === 0) return { list: [], total: meta.commentCount };

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, nickname: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.id.toString(), u]));
    let likedSet = new Set<string>();
    if (viewerId) {
      const likes = await this.prisma.commentLike.findMany({
        where: { userId: viewerId, commentId: { in: rows.map((r) => r.id) } },
        select: { commentId: true },
      });
      likedSet = new Set(likes.map((l) => l.commentId.toString()));
    }
    return {
      total: meta.commentCount,
      list: rows.map<CommentItem>((row) => {
        const u = userMap.get(row.userId.toString());
        return {
          id: row.id.toString(),
          catchId: row.catchId.toString(),
          parentId: null,
          content: row.content,
          likeCount: row.likeCount,
          likedByMe: likedSet.has(row.id.toString()),
          userId: row.userId.toString(),
          userName: u?.nickname ?? null,
          userAvatar: u?.avatar ?? null,
          isAuthor: false,
          createdAt: row.createdAt.toISOString(),
        };
      }),
    };
  }

  /** 创建评论；二级回复时强制拍平到两层 */
  async create(userId: bigint, dto: CreateCommentDto) {
    const catchId = parseBigIntId(dto.catchId, 'catchId');
    const meta = await this.prisma.catch.findUnique({
      where: { id: catchId },
      select: { id: true, userId: true, reviewStatus: true, allowComments: true },
    });
    if (!meta || meta.reviewStatus !== 'approved') {
      throw new NotFoundException('鱼获不存在或未审核通过');
    }
    if (!meta.allowComments) {
      throw new ForbiddenException('该鱼获已关闭评论');
    }

    let parentId: bigint | null = null;
    let parentUserId: bigint | null = null;
    if (dto.parentId) {
      const pid = parseBigIntId(dto.parentId, 'parentId');
      const parent = await this.prisma.comment.findUnique({
        where: { id: pid },
        select: { id: true, catchId: true, parentId: true, userId: true },
      });
      if (!parent || parent.catchId !== catchId) {
        throw new NotFoundException('父评论不存在');
      }
      // 两层拍平：父评论自身有 parentId 时（已经是 reply），把新评论 reply 到祖父
      parentId = parent.parentId ?? parent.id;
      parentUserId = parent.userId;
    }

    const trimmed = dto.content.trim();
    if (!trimmed) {
      throw new BadRequestException('评论内容不能为空');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: {
          catchId,
          userId,
          parentId,
          content: trimmed,
        },
        select: {
          id: true,
          catchId: true,
          parentId: true,
          content: true,
          likeCount: true,
          createdAt: true,
          userId: true,
        },
      });
      await tx.catch.update({
        where: { id: catchId },
        data: { commentCount: { increment: 1 } },
      });
      return c;
    });

    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, avatar: true },
    });

    // 通知:回复评论 -> 通知父评论作者;一级评论 -> 通知鱼获作者
    if (parentId != null && parentUserId != null) {
      await this.notifications.emit({
        type: 'comment_reply',
        recipientId: parentUserId,
        actorId: userId,
        refType: 'comment',
        refId: created.id,
        payload: {
          catchId: catchId.toString(),
          parentCommentId: parentId.toString(),
          excerpt: trimmed.slice(0, 80),
        },
      });
    } else {
      await this.notifications.emit({
        type: 'catch_comment',
        recipientId: meta.userId,
        actorId: userId,
        refType: 'catch',
        refId: catchId,
        payload: {
          commentId: created.id.toString(),
          excerpt: trimmed.slice(0, 80),
        },
      });
    }

    const item: CommentItem = {
      id: created.id.toString(),
      catchId: created.catchId.toString(),
      parentId: created.parentId ? created.parentId.toString() : null,
      content: created.content,
      likeCount: 0,
      likedByMe: false,
      userId: created.userId.toString(),
      userName: u?.nickname ?? null,
      userAvatar: u?.avatar ?? null,
      isAuthor: false,
      createdAt: created.createdAt.toISOString(),
    };
    return item;
  }

  /** 删除评论（评论作者 OR 鱼获主） */
  async remove(userId: bigint, dto: CommentIdDto) {
    const id = parseBigIntId(dto.commentId, 'commentId');
    const c = await this.prisma.comment.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        catchId: true,
        parentId: true,
        catch: { select: { userId: true } },
      },
    });
    if (!c) throw new NotFoundException('评论不存在');
    if (c.userId !== userId && c.catch.userId !== userId) {
      throw new ForbiddenException('无权删除该评论');
    }

    // 一级评论删除时，连带 reply 一起删，commentCount 全减
    const removed = await this.prisma.$transaction(async (tx) => {
      let n = 1;
      if (c.parentId === null) {
        const replyCount = await tx.comment.count({
          where: { parentId: id },
        });
        // 先删 reply 上的 like，再删 reply
        await tx.commentLike.deleteMany({
          where: { comment: { parentId: id } },
        });
        await tx.comment.deleteMany({ where: { parentId: id } });
        n += replyCount;
      }
      // 删自身 like 与自身
      await tx.commentLike.deleteMany({ where: { commentId: id } });
      await tx.comment.delete({ where: { id } });
      // 维护 catch.commentCount，不能减到负
      const cur = await tx.catch.findUniqueOrThrow({
        where: { id: c.catchId },
        select: { commentCount: true },
      });
      const next = Math.max(0, cur.commentCount - n);
      await tx.catch.update({
        where: { id: c.catchId },
        data: { commentCount: next },
      });
      return { removed: n, commentCount: next };
    });

    return { ok: true, ...removed };
  }

  /** 评论点赞/取消（幂等） */
  async like(userId: bigint, dto: LikeCommentDto) {
    const id = parseBigIntId(dto.commentId, 'commentId');
    const exists = await this.prisma.comment.findUnique({
      where: { id },
      select: { id: true, userId: true, catchId: true, content: true },
    });
    if (!exists) throw new NotFoundException('评论不存在');

    let newlyLiked = false;
    const likeCount = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.commentLike.findUnique({
        where: { commentId_userId: { commentId: id, userId } },
        select: { commentId: true },
      });
      if (dto.action === 'like' && !existing) {
        await tx.commentLike.create({ data: { commentId: id, userId } });
        const u = await tx.comment.update({
          where: { id },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        });
        newlyLiked = true;
        return u.likeCount;
      }
      if (dto.action === 'unlike' && existing) {
        await tx.commentLike.delete({
          where: { commentId_userId: { commentId: id, userId } },
        });
        const cur = await tx.comment.findUniqueOrThrow({
          where: { id },
          select: { likeCount: true },
        });
        const next = Math.max(0, cur.likeCount - 1);
        await tx.comment.update({ where: { id }, data: { likeCount: next } });
        return next;
      }
      const cur = await tx.comment.findUniqueOrThrow({
        where: { id },
        select: { likeCount: true },
      });
      return cur.likeCount;
    });

    if (newlyLiked) {
      await this.notifications.emit({
        type: 'comment_like',
        recipientId: exists.userId,
        actorId: userId,
        refType: 'comment',
        refId: id,
        payload: {
          catchId: exists.catchId.toString(),
          excerpt: exists.content.slice(0, 80),
        },
      });
    }

    return { ok: true, likeCount };
  }
}
