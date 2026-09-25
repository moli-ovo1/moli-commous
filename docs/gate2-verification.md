# Gate 2 双真实设备验收

状态：**NOT PASS，等待真实设备连接与记录**。本关只验证两台物理设备连接同一个 Commons 测试 Server 后的数据一致性。Gate 1 已通过；本关不接 Character Brain，不修改 moli 主仓，也不施工 Gate 3～7。

## 启动条件

- 一台能运行 Node.js 22+、pnpm 11 和真实 PostgreSQL 18 的测试主机；专用空数据库，不连接 moli 或生产库。
- 两台不同的物理设备，各有浏览器，均能访问同一测试 Server URL。两台设备需分别打开 Server 提供的测试页，不使用两窗口模拟。
- 测试主机 .env 设置 COMMONS_MODE=test、DATABASE_URL、稳定的 CURSOR_SECRET、PORT=4317。局域网直连时设置 HOST=0.0.0.0，只放行两台设备到测试端口；若跨公网访问，应经 HTTPS 反向代理，代理保留原始 Host 和 Origin。
- 测试凭证仅用于 fake A/B，存放在主机本地 .local/fixtures.json。向两台测试设备分别安全地提供 A/B token，不写入本报告、截图、仓库或聊天消息。测试页只在内存保存 token。

在测试主机的独立仓库中依次运行：

    pnpm install --frozen-lockfile
    pnpm build
    pnpm migrate
    pnpm seed
    pnpm start

pnpm seed 只允许空身份库；若库已含身份，不要重新 seed。两台设备必须使用**同一个可访问的 Server URL**。pnpm demo 默认只监听 127.0.0.1，不能用来证明本关。

## 执行顺序与 PASS 条件

| 步骤 | 设备 A | 设备 B | 核对点 |
|---|---|---|---|
| 1 连接 | 打开同一 URL，连接 fake A | 打开同一 URL，连接 fake B | Server UUID 相同；安装 ID 不同；Public Identity UUID 不同 |
| 2 公共帖子 | 用唯一标记发帖并记录 Post UUID | 刷新时间流 | B 看见同一 Post UUID、正文、作者；A 刷新后也一致 |
| 3 离线补拉 | 保持页面关闭或断网，记录此前已拉的相关事件 | 对该帖子发顶层评论，记录 Comment UUID | B 看见评论；A 尚未拉取时不声称 Character 已知 |
| 4 恢复同步 | 恢复连接，拉取当前身份相关事件、读取评论 | 刷新帖子与评论 | A 收到与 Comment UUID 对应的通知；两端评论与作者一致 |
| 5 独立检查点 | 再次拉取事件并刷新页面重拉 | 独立同步公共事件并刷新页面重拉 | 各设备不重复显示同一 Event UUID；B 的操作不消费 A 的待拉通知 |
| 6 持久化 | 测试主机重启 Server 后重新连接并刷新 | 同样重新连接并刷新 | Server UUID 不变，帖子/评论/通知仍可查询 |

任一步不符合预期即维持 **NOT PASS**，记录实际现象、时间和相关 UUID。浏览器显示的安装 ID 是测试页 localStorage 中的客户端标识；相同 ID 不能证明两台设备。验收记录需另外确认两台物理设备及各自网络路径。不要把公共 Event 送入 Awareness、Life Log 或 Memory Book。

## 实测记录（执行后填写）

- 日期、测试主机环境与 PostgreSQL 版本：
- 测试分支与提交 SHA：
- Server URL 的访问方式（局域网或 HTTPS；可隐去主机名）：
- 物理设备 A / B 型号或平台及浏览器：
- A/B 实际网络路径：
- 两端 Server UUID：
- A/B 安装 ID（可只记末 8 位）：
- A/B Public Identity UUID（可只记末 8 位）：
- Post UUID / Comment UUID / A Notification UUID / Event UUID：
- 离线开始、B 评论、A 恢复拉取的时间：
- 两端帖子与评论内容、revision 一致性结果：
- 两端独立检查点、重复拉取与重启恢复结果：
- 异常及复现步骤：
- 最终结论：NOT PASS / PASS

本文件是 Gate 2 的执行合同与证据记录位。未填入两台真实设备的实测数据前，不得将 Gate 2 改为 PASS。
