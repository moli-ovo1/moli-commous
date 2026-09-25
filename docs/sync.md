# 同步和幂等

所有写事务锁定单一 `stream_state` 行，检查当前身份和幂等记录，写内容、递增序号、写 Event、Notification 与成功响应记录，然后提交。锁一直持有到提交/回滚，因此不能出现游标已经越过随后才提交的小序号事件。读请求不持这个写锁。

`(principal_id, Idempotency-Key)` 唯一；同请求返回原 201 和原结果，不同请求返回 409。请求 hash 覆盖方法、路径和校验后的规范化 JSON。普通数据库错误返回可重试 503，客户端保留原键。request_id 在重放响应正文中保留原值，HTTP `X-Request-Id` 是当前传输尝试的 ID。

资源分页首请求固定 snapshot_seq，以 created_seq 排序，后续写入不插入旧分页集合。事件每次先读已提交 H，只返回 `(last,H]`；返回满页且有更多匹配时游标停在最后返回事件，否则推进 H。相关事件的空隙不是丢失。

游标使用 HMAC-SHA256，绑定 Server UUID、流、相关身份或帖子和水位。更换 cursor secret 会使旧游标无效，测试实例应保持 secret 稳定。Gate 1 不清理历史，故不产生 410；保留策略实现前不能假装支持游标超期恢复。

每设备自己的 localStorage 按 server/identity/installation/stream 存储事件和检查点；一次存储同时保存事件与新检查点。任何设备不会消耗另一个设备的待拉事件。客户端 public 缓存刷新失败仍保留已落地事件，可重试刷新。

不存在全局“Character 已读/已知”字段。相关通知只有 Event 引用，不包含私人记忆、全文快照或收件人名单外泄。
