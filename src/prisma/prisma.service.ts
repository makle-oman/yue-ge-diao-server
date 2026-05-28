import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

interface ConnInfo {
  host: string;
  port: number;
  user: string;
  database: string;
}

function parseDatabaseUrl(): ConnInfo & { password: string } {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set — 检查 .env 文件是否存在且包含 DATABASE_URL',
    );
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(
      `DATABASE_URL 格式错误，应为 mysql://user:pwd@host:port/db，当前值：${url}`,
    );
  }
  const database = u.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL 未指定数据库名（路径部分为空）');
  }
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

function buildAdapter(conn: ConnInfo & { password: string }): PrismaMariaDb {
  return new PrismaMariaDb({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,

    // ───── 连接池 ─────
    // dev 用 5 个连接足够；minimumIdle 故意不设，让它走默认 (=connectionLimit)，
    // 池启动时会建好 5 条连接备用。
    // 试过 minimumIdle:0，mariadb-connector 3.5.2 在首次 acquire 时会卡死，详见
    // https://github.com/mariadb-corporation/mariadb-connector-nodejs/issues
    connectionLimit: 5,

    // ───── 超时（关键修复点）─────
    // mariadb 默认 connectTimeout 只有 1s，家用网络到阿里云的 RTT 可能 50-200ms，
    // 但握手 + 鉴权多个 round-trip，加上偶发抖动很容易超过 1s。设 30s 留足缓冲。
    connectTimeout: 30_000, // TCP 建连 + 握手
    acquireTimeout: 30_000, // 从池里拿可用连接的等待时间
    socketTimeout: 0, // 单条 query 不限时（业务层自行控制慢查询）

    // ───── 长连接保活（防 NAT 断开）─────
    // 家庭路由器 / 公司 NAT 通常会回收 5-15 分钟无数据的 TCP 连接。
    // 启用 TCP keepalive，每 60 秒发探测包，确保连接被识别为"活的"。
    keepAliveDelay: 60_000,

    // 空闲超过 5 分钟主动关闭，下次用时重新握手，避免使用半死连接
    idleTimeout: 300,

    // ───── 字符集 / 排序规则 ─────
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',

    // 每个新连接都跑一次，统一会话变量，避免依赖服务端默认值漂移
    initSql: [
      "SET time_zone = '+08:00'",
      'SET SESSION wait_timeout = 28800',
    ],

    // MySQL 8 默认 caching_sha2_password，无 SSL 时客户端默认拒绝 RSA 公钥拉取。
    // dev 走明文允许；上线请改 TLS。
    allowPublicKeyRetrieval: true,
  });
}

function diagnose(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return '⏱  连接超时：检查 ①阿里云安全组是否开放 3306 ②本地网络是否墙了 3306 出站 ③DATABASE_URL host/port 是否正确';
  }
  if (code === 'ECONNREFUSED') {
    return '🚫 连接被拒：①MySQL 服务未运行（服务器上 docker ps 看一下）②端口不对';
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(msg)) {
    return '🌐 DNS 解析失败：检查 DATABASE_URL 里的主机名是否打错';
  }
  if (/Access denied/i.test(msg)) {
    return '🔐 用户名或密码错：检查 DATABASE_URL（密码里的 @ 必须 URL-encode 成 %40）';
  }
  if (/Unknown database/i.test(msg)) {
    return '📁 数据库不存在：去服务器上 CREATE DATABASE，或检查 URL 末尾的库名';
  }
  if (/ER_NOT_SUPPORTED_AUTH_MODE|ER_CANNOT_RETRIEVE_RSA_KEY|caching_sha2|RSA public key/i.test(msg)) {
    return '🔑 认证插件不兼容：MySQL 8 默认 caching_sha2_password，需要 allowPublicKeyRetrieval=true 或 SSL；若仍报错可在服务器 ALTER USER ... IDENTIFIED WITH mysql_native_password';
  }
  return `❓ ${msg}`;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly connInfo: ConnInfo;

  constructor() {
    const parsed = parseDatabaseUrl();
    super({
      adapter: buildAdapter(parsed),
      log: ['warn', 'error'],
    });
    // 不保存密码，只留连接元信息用于日志
    this.connInfo = {
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      database: parsed.database,
    };
  }

  async onModuleInit() {
    const { host, port, user, database } = this.connInfo;
    this.logger.log(
      `正在连接数据库 mysql://${user}@${host}:${port}/${database} ...`,
    );

    const maxAttempts = 5;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t0 = Date.now();
      try {
        await this.$connect();
        // $connect 在 driver-adapter 模式下不一定真正握手，所以再做一次 ping
        await this.$queryRaw`SELECT 1`;
        const ms = Date.now() - t0;
        this.logger.log(
          `✅ 数据库连接成功 (${ms}ms, 尝试 ${attempt}/${maxAttempts})`,
        );
        return;
      } catch (e) {
        lastErr = e;
        const reason = diagnose(e);
        this.logger.warn(
          `连接失败 (${attempt}/${maxAttempts}): ${reason}`,
        );
        if (attempt < maxAttempts) {
          // 指数退避：1s, 2s, 4s, 8s, 8s
          const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
          this.logger.log(`${delay}ms 后重试...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    this.logger.error(
      `❌ 数据库连接失败（重试 ${maxAttempts} 次后放弃）`,
      lastErr instanceof Error ? lastErr.stack : String(lastErr),
    );
    throw lastErr;
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /** 健康检查 ping —— 供 /health 端点和监控使用 */
  async ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const t0 = Date.now();
    try {
      await this.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: diagnose(e) };
    }
  }

  /** 连接元信息（不含密码），供 /health 等使用 */
  getConnInfo(): ConnInfo {
    return { ...this.connInfo };
  }
}
