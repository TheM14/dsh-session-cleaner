# dsh-session-cleaner

[English](README.md) | **简体中文**

DeepSeek Harness 的已归档会话管理插件。它在设置面板中增加「已归档对话」页面，提供恢复、安全删除、残留清理，以及使用新预设继续旧对话的能力。

插件不会替换现有菜单，也不会修改源会话的 header 或历史事件。界面使用宿主的语义设计令牌，可自动适配主题。

## 功能

- 按工作区列出已归档对话及其标题、创建时间、日志状态和运行状态。
- 显示会话的有效预设，并标记已删除或不可用的源预设。
- 将对话恢复至原工作区，无需重启即可在官方侧边栏看到。
- 通过可回滚的隔离与提交流程彻底删除已归档对话。
- 清理归档幽灵、孤儿工作区席位、孤儿投影缓存和隔离日志。
- 使用任意可用的系统或用户预设创建完整历史续接会话，同时保留原归档。

## 要求

- DeepSeek Harness `0.1.0-rc.6` 兼容版本。
- Node.js 与 npm。
- 当前实现面向 dsh Web profile。

## 安装

克隆仓库并构建：

```powershell
git clone <repository-url>
cd dsh-session-cleaner
npm install
npm run build
```

将仓库的绝对路径添加到 dsh Web profile，然后重启 `dsh web`：

```powershell
dsh plugin --profile web add (Get-Location).Path
dsh web
```

卸载：

```powershell
dsh plugin --profile web remove dsh-session-cleaner
```

## 使用

1. 打开 dsh 的设置面板并进入「已归档对话」。
2. 点击「恢复」可将对话移回原工作区。
3. 点击「删除」并确认，可永久删除日志和相关注册表数据。
4. 选择目标预设后点击「用此预设继续」，可创建继承完整历史的新会话。
5. 点击「清理残留」，可处理此前操作或外部变化留下的安全可判定残留。

删除是永久操作。运行中的会话不会被删除；若会话仍由宿主持有，请重启 dsh，并在删除前不要再次打开它。

## 数据安全

删除采用以下顺序：

```text
验证已归档且非运行中
  -> 将日志重命名至隔离目录
  -> 提交工作区注册表
  -> 提交投影缓存
  -> 最终删除隔离日志
```

注册表或投影缓存写入失败时，插件会停止后续步骤并尽量回滚。若逻辑删除已经提交但最终文件清理失败，隔离日志会保留在 `$DSH_HOME/storages/.dsh-session-cleaner-trash/`，可由「清理残留」再次处理。

sweep 在开始写入前会读取所有必需状态。任何前置读取失败都会终止清理；分阶段写入失败也会停止后续阶段并返回已完成计数。

所有 POST 请求必须携带插件专用哨兵头。Host 还会验证 `Origin`、`Sec-Fetch-Site`、session id 格式以及 64KB 请求体上限。

## 使用新预设继续

续接功能通过公开的 `ctx.agents.create` 和 `ctx.agentPresets.mount` 创建 lineage 子会话：

- seed 使用源会话完整的持久事件前缀；
- 末尾追加目标 `agent-preset/selected` 边界；
- meta 记录 `parentSession`、`seedLength` 和目标 `agentPreset`；
- 创建后将子会话挂回源工作区；
- 源会话日志、header 和归档状态保持不变。

真实 Web 回归已经验证完整历史可以渲染，目标预设在冷重启后保持生效，源日志哈希不变。

## 开发

```powershell
npm run build
npm test
npx tsc --noEmit -p tsconfig.json
```

`npm test` 会先清理并重新生成 `lib/`，再执行纯逻辑和 fake-host 路由测试。预构建的 Host、Client、类型声明及 sourcemap 均保存在 `lib/`，可随仓库发布。

更详细的事务、安全和架构说明参见 [plugin-design.md](plugin-design.md)。

## 许可证

[MIT](LICENSE)
