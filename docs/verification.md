# Gate 1 验证记录

日期：2026-09-25。结论：代码与合同已交付，**Gate 1 仍为 NOT PASS**。真实 PostgreSQL 集成验收与 demo 手工闭环均未完成。

## 本轮按要求复验的命令

在本仓库根目录依次执行了以下命令：

| 命令 | 实际结果 |
|---|---|
| `pnpm install --frozen-lockfile` | PASS；锁文件一致、依赖已齐全 |
| `pnpm typecheck` | PASS；`tsc --noEmit` 退出码 0 |
| `pnpm test` | FAIL；15 项中 4 项合同测试通过，11 项依赖 PostgreSQL 的测试均停在测试 `before` 钩子 |
| `pnpm demo` | FAIL；数据库 `initdb` 失败，HTTP 测试页面未能启动，A→B→A 未执行 |

两次数据库初始化均出现下述错误。测试命令的原始日志位于本地未交付的 `.local/requested-test.txt`，演示日志位于 `.local/requested-demo.txt`；日志不含测试令牌。

## 已通过

- TypeScript 严格类型检查与编译。
- 4 个无需数据库的合同测试：非测试模式拒绝启动；敏感/伪造身份字段与非本 Gate 交互拒绝；UTF-8 正文限制与 NUL/格式检查；OpenAPI 引用完整性及仅 9 个 Gate 1 操作。
- 已生成版本化 OpenAPI、事件 JSON Schema 和数据库迁移；测试实例不接受 Backstage 输入。

## 尚未通过的验收

已尝试使用下载到本项目的真实 PostgreSQL 原生二进制初始化测试集群。当前 Windows 受限进程环境报告：

```text
initdb: error: could not create restricted token: error code 87
initdb: error: could not re-execute with restricted token: error code 3
child process was terminated by exception 0xC0000005
```

已尝试缩短二进制路径及使用相对数据目录，能够完成 bootstrap，但 post-bootstrap 仍崩溃。未绕过环境限制、未替换成内存模拟数据库，也未声称事务测试通过。

因此，11 个 PostgreSQL 集成场景因 before 初始化钩子失败未进入业务断言。并发幂等、原子回滚、提交顺序、分页、离线补拉与重启语义均仍待真实数据库运行验证。没有进行两台真实设备验证（属于 Gate 2）。测试页未完成带数据库的端到端浏览器验收。

## 可复现验证路径

1. 在能正常运行 PostgreSQL 的环境，使用专用空测试数据库。
2. 设置 `TEST_DATABASE_URL`，运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`。
3. 或在普通本地环境直接运行 `pnpm test`，由脚本创建独立 PostgreSQL 测试集群。
4. 仓库提供 PostgreSQL 18 service 的 GitHub Actions 配置；本次未推送远程、未触发 CI，CI 文件存在不代表 CI 已通过。
5. 集成测试全部通过后，使用 `pnpm demo` 人工执行 A 发帖、B 评论、A 拉取通知，记录最终 Gate 1 验收结果。

## 范围核对

仅在本次交付的独立目录创建新仓库；未修改 moli 主仓。没有实现 Gate 2～7、元世界、正式 Human 代发、Brain 接入、Cloud 或 Companion 依赖。

元世界长期合同已按复审修正；真实经历连续性不以默认记忆检索/写入隔离切断。

## 验收环境调查与准备

当前独立仓库的 `git remote -v` 为空；连接的 GitHub 仓库列表为空，因此没有可直接推送测试分支并运行的仓库 CI。本机未发现 Docker、Podman、PostgreSQL 命令或已安装的 WSL 发行版；`localhost:5432` 和 `localhost:54329` 均未监听。环境中未设置 `TEST_DATABASE_URL` 或 `DATABASE_URL`。这些检查只说明本次可用环境，不断言用户其他机器不存在 PostgreSQL。

为了允许选择独立外部测试库验收，`pnpm demo` 现可读取 `DEMO_DATABASE_URL`，与 `pnpm test` 的 `TEST_DATABASE_URL` 分开；演示凭证文件按 Server UUID 命名。需要两个专用空库，避免集成测试留下的身份干扰手工闭环。此改动只涉及验收环境接入，没有扩大 Gate 1 产品功能。

在实际提供可用库或可推送的测试仓库前，上述已记录的测试结果仍为准；不得标为 PASS。
