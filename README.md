<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

约个钓后端 — NestJS + Prisma + MySQL。

---

## 🚀 在新机器/换网络上从零启动（避坑指南）

**TL;DR**：仓库里没有 `.env`（被 `.gitignore` 排除了），只 `pnpm install` 启动会报 `DATABASE_URL is not set`。必须先建 `.env`。

### 步骤

1. **装依赖**
   ```bash
   pnpm install
   ```

2. **建 `.env`**（最常踩的坑就是这步缺失）

   仓库根目录有两个参考文件：
   - [`.env.example`](./.env.example) — 脱敏模板，含字段说明，进 git
   - [`.env.local-backup`](./.env.local-backup) — 本地 docker 版连接串备份

   推荐做法：复制模板再填值
   ```bash
   cp .env.example .env
   ```

   然后把占位的 `<用户>` / `<URL编码后的密码>` / `<阿里云IP>` 填成真实值。完整真值见团队内部记录（或本地 `.env.local-backup` 也有一份指向 127.0.0.1 的版本）。

   **密码里的 `@` 必须写成 `%40`**，否则 URL 解析会出错。

3. **生成 Prisma Client**
   ```bash
   pnpm prisma generate
   ```

4. **启动**
   ```bash
   pnpm run start:dev
   ```
   启动日志应该看到 `✅ 数据库连接成功 (xxx ms, 尝试 1/5)`。

### 两种数据源怎么选

| 场景 | 用哪个 | DATABASE_URL host |
|------|--------|-------------------|
| 默认（公司/家里换机器开发，数据一致） | 阿里云远程测试库 | `60.205.167.169` |
| 离线/没网/不想动远程数据 | 本地 docker MySQL | `127.0.0.1`（参见 [`.env.local-backup`](./.env.local-backup)） |

切换时只需改 `.env` 里 `DATABASE_URL` / `SHADOW_DATABASE_URL` 两行的 host 部分，无需改代码。

### 在家连不上阿里云？

启动报 `⏱ 连接超时 ETIMEDOUT`，按顺序排查：

1. **本地网络**：`telnet 60.205.167.169 3306` 或 `Test-NetConnection 60.205.167.169 -Port 3306`（PowerShell）。某些运营商/公司网会墙 3306 出站。
2. **阿里云安全组**：如果之前限定了 IP，回家 IP 变了就连不上。`curl ifconfig.me` 看自家公网 IP，去阿里云控制台 → ECS → 安全组 → 把家里 IP 加进 3306 入方向规则。当前默认已放行 `0.0.0.0/0`，理论上不需要。
3. **看错误码**：[`src/prisma/prisma.service.ts`](./src/prisma/prisma.service.ts) 里 `diagnose()` 会把常见错误翻译成中文提示，照着排即可。
4. **重试机制**：服务启动时会自动重试 5 次（1s/2s/4s/8s/8s 指数退避），偶发抖动会自愈，无需手动重启。

### Prisma 迁移

```bash
# 本地修改 schema 后生成迁移
pnpm prisma migrate dev --name <迁移名>

# 部署到目标库（不会跑 shadow）
pnpm prisma migrate deploy
```

`migrate dev` 需要 `SHADOW_DATABASE_URL`，已配在 `.env` 里。

---

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
