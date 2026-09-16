# Vork 第一阶段开发版

这是单用户的本地开发版：可通过 Electron 创建 Bot、聊天并查看确定性 FakeModel 的流式回复。浏览器、终端、文件云电脑和真实 AI 尚未接入。不要将此 Compose 配置直接暴露到公网。

## 环境与启动

需要 macOS、Node.js 22+、pnpm 10+ 和 Docker。首次运行先执行 `pnpm install`。复制 `.env.example` 为 `.env`，其中密码仅适用于本地开发；如更改 `VORK_DB_PASSWORD`，同步更改 `DATABASE_URL`。不要将 `.env` 提交到仓库。

```sh
docker compose up -d --build
pnpm healthcheck
pnpm dev
```

Compose 依次启动 PostgreSQL、Valkey、数据库迁移、API 和 Worker；API 只监听本机 `127.0.0.1:3000`。Electron 使用本机 API，客户端关闭后 Worker 仍在容器里运行。数据库数据存放在 Docker 命名卷中。

## 测试与排查

```sh
pnpm test
pnpm typecheck
pnpm --filter @vork/desktop build
pnpm e2e
docker compose logs api worker migrate
```

`pnpm e2e` 需要 Compose 服务已就绪，并使用构建后的 Electron 入口。`pnpm healthcheck` 检查 API、数据库、Valkey 和 Worker 心跳。测试数据库使用单独的 `TEST_DATABASE_URL`，不要指向包含个人数据的数据库。

## 停止与数据

`docker compose down` 会停止容器，但保留 PostgreSQL 命名卷和 Bot/对话数据。若确实要清空本地开发数据，请先自行确认卷名与内容；本项目的常规停止流程不会删除卷。
