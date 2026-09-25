# Gate 1 验证记录

结论：**Gate 1 PASS**。本次仅验收独立莫里公域仓库的 Gate 1；Gate 2～7 未施工。

## 真实 PostgreSQL 验收

- 仓库：[`moli-ovo1/moli-commous`](https://github.com/moli-ovo1/moli-commous)，分支：`gate1-postgres-validation`。
- 代码提交：`1b7ba148a724097fdf701a95602c4eecab64a6e3`。
- [GitHub Actions 运行 #1](https://github.com/moli-ovo1/moli-commous/actions/runs/36160791499)：`push` 触发，`test` job 与全部步骤成功。运行环境为 Ubuntu runner + PostgreSQL 18 service；容器日志确认 PostgreSQL **18.6** 启动并接受连接。测试通过 `TEST_DATABASE_URL` 连接真实数据库，没有用内存数据库或 SQLite 替代。

| 命令 | CI 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | PASS；锁文件验证与依赖安装成功 |
| `pnpm typecheck` | PASS；`tsc --noEmit` 退出码 0 |
| `pnpm test` | PASS；15/15、失败 0、跳过 0，其中 11 项为 PostgreSQL 集成场景 |

11 项集成场景均进入并通过业务断言，覆盖 A 发帖/B 评论/A 通知、同名身份区别、20 路并发幂等、错误密钥冲突、授权与收件人隔离、事务故障点原子回滚、提交顺序、离线补拉、两独立设备游标、资源及事件分页、重启恢复、数据库约束与退出。另 4 项合同测试通过。数据库容器日志里的约束错误由负向测试有意触发，不是 CI 失败。

## Demo 闭环

同一次 CI 创建了**独立的空 PostgreSQL demo 数据库**，运行 `pnpm demo` 启动真实 HTTP Server，并由 `scripts/verify-demo.mjs` 按 A→B→A 顺序发出请求。我复核了 job 日志，记录如下：

```text
DEMO PASS: A post 770e2b47-6a88-4da1-b2dc-d6ad70f11ad7 -> B comment e2938b1d-4988-4a5d-aab0-3bc7eea8dfb4 -> A notification 984e7862-e3b8-465c-aa48-6da2cd6f49ed
```

这证实 A 发帖、B 评论、A 通过事件/通知拉取获得评论通知的实际 API 闭环。核验是对 CI 内的 `pnpm demo` HTTP 请求与日志进行人工复核，未在本机另行启动演示；本机受限 Windows 环境的 PostgreSQL `initdb` 仍无法正常运行。

## 范围与边界

- 公共内容与事件留在 Commons；未接入 Character Brain、Awareness、Life Log 或 Memory Book。
- 元世界长期合同保留同一 Agent Instance 的经历连续性与 `layer/source` 标记；本 Gate 未实现 Backstage 功能。
- 未修改 moli 主仓；未实现 Reply/Like/@、邮件、游戏、AI 或 Gate 2～7。
- 两台真实设备连同一测试 Server 的验证仍属于 Gate 2，未因 Gate 1 的两独立设备游标测试而宣称完成。
