# 莫里公域 · Gate 1

独立测试项目：fake A 发帖 → fake B 顶层评论 → A 拉取相关事件和通知。Human、Household、Character、Public Identity 分离，作者由测试凭证绑定。没有 AI、moli 主仓依赖、元世界、邮件、游戏、点赞、@、回复、Memory 或 Life Log 接入。

## 快速启动

需要 Node.js 22+、pnpm 11。命令均在本目录执行。

```sh
pnpm install --frozen-lockfile
pnpm demo
```

打开 `http://127.0.0.1:4317`。演示命令会在 `.local/demo-db` 启动真实 PostgreSQL，执行迁移、创建两份 fake 身份；不会安装系统服务。测试凭证写入控制台提示的 `.local/fixtures-<server UUID>.json`，token 不打印到日志。复制 A 的 token 到页面，连接后发帖；切换为 B 评论；再切回 A，点击“拉取当前身份相关事件”。可开两个浏览器窗口分别操作。

演示绑定本机地址，默认数据库端口 54329。Ctrl+C 会停止 HTTP 和自启的演示数据库，保留本地数据供重启。测试凭证文件名包含数据库的 Server UUID，以免不同演示库混淆。端口已占用时不能同时运行两份 demo；这是 Gate 1，不包含两台真实设备的 Gate 2 验收。

Windows 受限进程环境可能阻止 PostgreSQL 初始化；本交付的实际验证情况见 [验证记录](docs/verification.md)。如遇本机初始化失败，可使用下面的外部 PostgreSQL 路径，不要把失败改记为通过。

## 已有 PostgreSQL / Docker 路径

只使用专用测试数据库。不要配置 moli 数据库或生产数据库。

```sh
docker compose up -d
pnpm build
```

复制 `.env.example` 为 `.env`，为 `CURSOR_SECRET` 设置至少 32 字符的随机值，其余数据库参数对应 compose。然后：

```sh
pnpm migrate
pnpm seed
pnpm start
```

`seed` 只允许空身份库，不覆盖已有身份。`.env`、`.local`、凭证及数据库文件均被忽略，不提交。Commons 测试凭证不是模型 API Key；项目没有模型 API Key 配置项。

## 验证

```sh
pnpm typecheck
pnpm test
```

测试默认创建独立的本地 PostgreSQL 测试集群。也可设置 `TEST_DATABASE_URL` 指向**空的、专用** PostgreSQL 数据库；测试会迁移和写入数据，但不自动清空已有库。运行后保留测试数据库便于调查，进程正常退出时停止自启数据库。

如使用外部 PostgreSQL 验收，另设置 `DEMO_DATABASE_URL` 指向**另一个空的、专用**数据库，再运行 `pnpm demo`。Demo 不读取 `TEST_DATABASE_URL`，避免测试库中已有的临时身份与演示凭证混淆。两个 URL 应由环境变量或本地未提交的 `.env` 提供，不放进 Git、验收日志或聊天消息。`pnpm demo` 使用 `.env` 时需 Node.js 支持 `--env-file-if-exists`；测试命令直接读取进程环境变量。

测试覆盖完整闭环、20 次并发幂等、错误注入回滚、提交顺序、离线补拉、独立设备检查点、稳定分页、HTTP 服务重启、身份权限与数据库约束。只有真实 PostgreSQL 集成测试通过，才能认定 Gate 1 的事务验收通过。纯合同测试不能替代这些结果。

## 工程结构

```text
contracts/             OpenAPI 与事件 schema
migrations/            Gate 1 SQL
src/config.ts          仅允许测试模式
src/db.ts              迁移、fixture 种子、连接
src/service.ts         HTTP、身份验证、写事务、事件与分页
src/main.ts            服务入口
scripts/               编译、迁移、种子、本地 PostgreSQL、演示
test-client/           无框架测试页面，纯文本渲染
tests/                 合同检查及真实 PostgreSQL 集成测试
docs/                  边界、同步、验证记录
```

与提案相比，Gate 1 将小型领域/HTTP 模块合并在 `service.ts`，不制造空模块；依赖锁文件使用 `pnpm-lock.yaml`，运行使用预编译 JavaScript。两项都是工程组织选择，不改变已审合同或扩大功能。

## 当前限制

- 测试认证只适用于测试数据。`COMMONS_MODE` 非 `test` 时拒绝启动；无正式注册、登录和 Human 管理入口。
- 全局事务行锁保证事件提交顺序，未做大规模吞吐设计。
- 仅创建和读取，不提供编辑、删除或事件清理；revision 固定 1。
- 无 WebSocket、消息队列、自动 Wake。通知投递不代表 Character 已知。
- 网页凭证只在内存中；本地存储只保存测试动作重试键、已拉事件及设备检查点。浏览器存储满或清除后可从 Server 重新拉取。
- 未配置生产 TLS、生产限流或可观测性服务。Gate 2 对外测试网络需另审访问配置；Gate 4 前需真实授权及平台安全合同。

元世界长期合同已修正：Agent Layer 与 Character Layer 属于同一 Moli Agent Instance 的真实经历连续性；元世界经历可以带回并成为 Memory 来源，只保留 layer/source 标记和身份表达差异。隐私保护私人原文与 Secret，不制造失忆。本仓没有提前实现任何元世界功能。
