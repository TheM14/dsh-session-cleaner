# dsh-session-cleaner 形态与安全决策

## 插件形态

- 形态：单包双端的树外插件。Host 提供 JSON API，Client 通过 additive `settings.section` 增加「已归档对话」设置页。
- Host 挂载：`ctx.webServer.register`，前缀 `/api/dsh-session-cleaner`。
- Client 挂载：`ctx.slots`，不覆盖官方侧栏、根节点或工作区槽位。
- 数据能力：使用公开服务 `workspaceRegistry`、`sessionPersistence`、`sessions`、`storageDomain`、`agents` 和 `agentPresets`。
- 构建产物：`lib/index.js` 为 Host ESM；`lib/client.js` 为 Client ModuleLoader bundle；二者均带 sourcemap。

路由如下：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/list` | 按工作区返回归档会话及有效预设状态 |
| GET | `/presets` | 返回可选择的预设 id、名称、trust 与 broken 状态 |
| POST | `/restore` | 取消归档，保留原工作区席位 |
| POST | `/delete` | 安全删除已归档且非 live 的会话 |
| POST | `/continue` | 以目标预设创建完整历史 lineage 子会话 |
| POST | `/sweep` | 清理四类可判定残留 |

## 数据边界

1. 日志位于 `$DSH_HOME/sessions/<workspace>/<session-id>/session.jsonl.zstd`。
2. 工作区域保存 `global.archivedSessionIds` 和 `tables.workspaces[*].sessionIds`。
3. 投影缓存域的 `tables.sessions[id]` 保存标题等派生信息。
4. 删除只处理持久化归档集合中仍存在的 id；持久态无 id 而内存态有 id 时返回 `stale-registry`，不会继续操作。
5. 非单文件持久化后端返回 `unsupported-backend`，避免出现只删注册表的假成功。

读取到已打开的宿主存储域时，该域是唯一权威来源：域读取失败会终止操作，不回退到可能过期的磁盘副本。只有域不存在时才读写磁盘，磁盘写使用带 pid 和随机后缀的临时文件并原子替换。

## 删除状态机

```text
校验 durable archived + 非 live
  -> 读取日志定位与投影缓存快照
  -> rename 日志到隔离目录（可回滚）
  -> 再次校验非 live
  -> 提交 workspace global + workspace slots
  -> 提交 projection cache
  -> 删除隔离文件
  -> tombstone + 审计日志
```

- registry 失败：停止，恢复隔离日志；已经写过的 workspace 记录做补偿回滚。
- projcache 失败：停止，恢复 registry、projcache 快照与隔离日志。
- 最终 purge 失败：逻辑删除已提交，响应为 `partial` 且 `committed: true`；隔离文件留给 sweep。
- tombstone 有 256 条上限，用于阻止同一宿主周期中的重复操作和旧列表响应复活条目。
- 宿主没有提供会话级写锁，因此在隔离后、提交前再做一次 live 检查，把不可避免的竞态窗口压到最小。

恢复只更新归档集合，保留原工作区席位。存储域写入会广播官方状态，真实 Web 回归确认恢复后侧边栏立即出现该会话，冷重启后状态仍正确。

## Sweep 语义

sweep 在任何写入前收集全部输入并调用纯函数 `planSweep`：

- 归档幽灵：无持久 header、非 live 的归档 id；
- 孤儿席位：无持久 header、非 live、也不再有效归档的 workspace session id；
- 孤儿缓存：无持久 header、非 live、且不被有效 workspace 席位占用的投影缓存行；
- 隔离日志：插件 trash 目录中上次已提交但未 purge 的文件。

工作区、投影缓存或隔离目录任一读取失败都会 fail-closed，不做删除。写入按归档集合、workspace slots、projcache、quarantine 顺序执行；任一步失败立即停止，返回 `partial`、失败阶段和已经完成的计数。

## Continue-with-Preset

不允许修改源会话 header 或历史事件。续接使用 `sessionPersistence.inspect` 读取已闭合的完整事件前缀，以 `ctx.agents.create` 创建新 session id，并通过 `agentPresets.mount` 挂载目标预设。seed 末尾追加新的 `agent-preset/selected` 边界，meta 记录：

- `parentSession`: 源归档会话 id；
- `seedLength`: 源事件数量；
- `agentPreset`: 目标预设 id。

创建后尝试通过源 workspace 的 `attachSession` 挂载子会话。挂载失败不破坏已经创建的子会话，响应会返回 `workspaceAttached: false`。

完整历史模式曾是 POC 决策点。真实安装回归已验证：已删除的源预设可显示为失效；选择 `standard` 后成功创建子会话；完整历史可渲染；目标预设在冷重启后仍为 `standard`；源日志逐字节哈希不变。因此保留完整历史模式，不实现原地改 preset，也不降级为会丢上下文的摘要注入。

## HTTP 安全

- 所有 POST 必须携带 `x-dsh-session-cleaner: 1`。
- 若存在 `Origin`，其 host 必须等于请求 `Host`。
- 若存在 `Sec-Fetch-Site`，只接受 `same-origin`。
- 403 响应包含 `Vary: Origin`；不返回 CORS 许可头。
- session id 使用 `session-<uuid>` 正则；preset id 长度限制为 1 到 128。
- JSON 语法错误返回 400，请求体超过 64KB 返回 413；业务冲突使用 409。
- 变更请求串行排队；continue 对同一 `sessionId + presetId` 的并发请求合并。

## Client 一致性

- `requestSeq` 阻止旧 `/list` 响应恢复已处理行。
- `pendingIds` 和同步 ref 防止按钮连点；sweep 也有独立防重。
- 未提交的失败保留当前行；仅 `committed: true` 的部分删除移除行并提示 sweep。
- 仅实际成功或已提交的操作刷新官方会话列表。
- 中英文 locale key 由 TypeScript 做严格全集校验。
- notice 使用 `role=status/alert` 和 `aria-live`；确认框支持 Escape、焦点恢复与 Tab 圈定；恢复历史最多保留 20 条。

## 已知限制

- live 会话只能由宿主释放，插件不会强制终止；需重启 dsh 后再删除或续接。
- 检测到内存态/持久态归档集合分歧时，插件拒绝猜测，要求重启后重试。
- 用户预设可以挂载用户组合，其能力与官方“用该预设新建会话”等价；API 只向客户端返回 roster 元数据，不返回组合内容或路径。
- dsh 处于开发者预览，公开服务契约和目录布局升级后仍需复核。

## 验证策略

`npm test` 先 clean + build，再运行纯逻辑和 fake-host 路由测试。覆盖内容包括：非数组字段、无变化写、分组容错、sweep 计划、哨兵/Origin/Sec-Fetch-Site、坏 JSON/超限 body、registry/projcache 失败补偿、stale durable 状态、sweep fail-closed、continue lineage 以及未知/broken preset。

真实回归必须通过不改动的安装脚本加载已编译 bundle，并限定在专用测试会话内验证恢复、续接、冷重启和源日志哈希。测试完成后停止临时 `dsh web` 实例。
