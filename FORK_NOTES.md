# Fork notes (Ayshinko/pi-web)

基于上游 [ygncode/pi-web](https://github.com/ygncode/pi-web) `v0.0.1-beta.38`，分支 `local/status-copy`。
加入了和本机 Pi 终端里一致的三个功能。

## 改动

### 1. 扩展状态行（额度 / TPS）

Pi 扩展通过 `ctx.ui.setStatus(key, text)` 在终端底栏显示的内容，在 `pi --mode rpc` 下会以
`{"type":"extension_ui_request","method":"setStatus","statusKey":…,"statusText":…}` 输出，
上游 pi-web 直接丢弃了这些事件。

- `internal/rpc/worker.go`：`handleRPCLine` 处理 `setStatus`，去掉 ANSI（CSI/OSC）后按 key 存在 worker 上，`statusText` 为空/缺省时删除该 key。
- `internal/workers/manager.go`：`WorkerStatus` 新增 `extensionStatuses`。
- `internal/server/chat.go`：`/api/worker-status` 返回 `extensionStatuses`（只读已存在的 worker，不会为此创建 worker）。
- 前端 `worker-status.js` → `ChatToolbarState.extensionStatuses` → `ChatComposer.svelte` 在工具栏下方按 key 排序显示，每个 key 一行（窄屏自动换行）。

是通用转发：例如 `codex-usage` 的 `quota`（Codex/Claude 额度）、`pi-task-benchmark` 的 `taskBenchmark`（`Live / Avg tok/s`）都会显示，其他扩展的状态也一样。
状态只在会话有 worker 时存在；worker 空闲 10 分钟被回收后消失，下次发消息重新出现。

### 2. 复制单条消息

- `SessionEntry.svelte`：用户/助手消息右上角新增复制按钮（`.copy-text-btn`，仅 live 页面），复制该消息的可见正文（不含 thinking 和工具调用）。

### 3. 复制整个会话（Copy Session）

- `web/src/session/render/session-copy.js`：[pi-copy-session](https://github.com/Ayshinko/pi-copy-session) `/copy-session` 格式化逻辑的浏览器移植，输出格式一致。
  - **full**：当前分支完整执行轨迹（thinking、工具调用参数与结果、bash、模型切换、摘要、元数据），图片和大段 base64 用占位符代替。
  - **text only**：只有用户文字和助手最终文字。
- 会话菜单新增 “Copy Session (full)” / “Copy Session (text only)”，复制的是当前正在查看的分支，写入浏览器端剪贴板（手机上也可用）。
- 会话已完整加载时同步复制；分页会话先拉取完整数据，若 HTTP/Safari 拒绝延迟写入剪贴板，会提示再点一次（第二次同步复制缓存文本）。

新增界面文字只加在 `web/src/shared/locales/en.js`（其他语言回退英文），按上游规则翻译需用脚本生成。

## 在 Windows 上构建

无需 `make`；前端构建脚本用到 `cp`，在 Git Bash 里执行：

```bash
cd web && npm ci && npm run build && cd ..
go build -ldflags="-s -w -X main.version=$(git describe --tags --always --dirty)" -o pi-web.exe ./cmd/pi-web
```

测试：`cd web && npx vitest run`，`go test ./...`。

## 替换运行中的 pi-web

运行中的 pi-web 由计划任务以 S4U 方式启动，普通权限 shell 停不掉，需要管理员 PowerShell：

```powershell
Stop-Process -Name pi-web -Force; Start-Sleep 2; Copy-Item .\pi-web.exe "$env:USERPROFILE\.pi\agent\bin\pi-web.exe" -Force; Start-ScheduledTask -TaskName pi-web
```

`pi update` 或官方 `install.ps1` 会用官方二进制覆盖；升级上游时把本分支 rebase 到新 tag 后重新构建。
带 `-dirty` 或领先 tag 的版本号会被 pi-web 的更新检查视为开发版，不会提示降级到官方版本。
