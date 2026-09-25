# Gate 2 双真实设备验收

状态：**NOT PASS，等待真实设备连接与记录**。本关只验证两台物理设备连接同一个 Commons 测试 Server 后的数据一致性。Gate 1 已通过；本关不接 Character Brain，不修改 moli 主仓，也不施工 Gate 3～7。

## 启动条件

- 一台能运行 Node.js 22+、pnpm 11 和真实 PostgreSQL 18 的测试主机；专用空数据库，不连接 moli 或生产库。可由 pnpm demo 在普通本机进程中启动独立 PostgreSQL。
- 两台不同的物理设备，各有浏览器，均能访问同一测试 Server URL。两台设备需分别打开 Server 提供的测试页，不使用两窗口模拟。
- 局域网直连时，只放行两台设备到测试主机的 4317 端口；PostgreSQL 端口仍仅绑定本机。不要把 4317 暴露到公网。
- 测试凭证仅用于 fake A/B。pnpm demo 会把凭证写到主机本地 .local/fixtures-<Server UUID>.json；向两台测试设备分别安全地提供 A/B token，不写入本报告、截图、仓库或聊天消息。测试页只在内存保存 token。

优先在测试主机的**普通 PowerShell**中进入独立仓库，依次运行：

    pnpm install --frozen-lockfile
    $env:DEMO_HOST = '0.0.0.0'
    pnpm demo

默认不设 DEMO_HOST 时只监听 127.0.0.1；显式设置后，demo 才监听局域网。它使用真实 PostgreSQL，并会在控制台显示匹配的本地凭证文件路径。若 Windows 上 PostgreSQL 初始化失败，改用能正常运行 PostgreSQL 的主机或已有的 Docker 路径：在专用空库配置 .env 中的 COMMONS_MODE=test、DATABASE_URL、稳定的 CURSOR_SECRET、HOST=0.0.0.0、PORT=4317，再执行 pnpm build、pnpm migrate、pnpm seed、pnpm start。pnpm seed 只允许空身份库；此路径凭证在 .local/fixtures.json。两台设备必须使用**同一个局域网 URL**，例如 http://<测试主机 IPv4>:4317。

在测试主机运行 ipconfig，取接入两台设备所在 Wi-Fi/有线局域网的 IPv4 地址。两台设备都打开 http://<该 IPv4>:4317/；测试主机若本身也是设备 A，也打开这个地址，而非 127.0.0.1。页面应出现“莫里公域 · Gate 1/2”和本设备安装 ID。若电脑能打开而另一设备不能，先检查同一 Wi-Fi、访客网络隔离和 Windows 防火墙是否允许 Node.js 在**专用网络**接收 4317/TCP；不要关闭整个防火墙或开放 PostgreSQL 端口。

设备 A 输入本地凭证文件中的 fake A token，点“连接 / 切换身份”；设备 B 输入 fake B token，执行同样操作。预期两端显示相同 Server UUID、不同 Public Identity UUID、不同本设备安装 ID。之后按下表操作，帖子和评论使用此次验收独有的短标记，便于两端比对。页面会显示 Post UUID、Comment UUID 和 revision；“拉取当前身份相关事件”会显示 Event 与 Notification JSON。

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
