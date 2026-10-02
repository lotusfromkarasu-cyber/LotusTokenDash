# LotusTokenDash

用一扇紧凑的悬浮窗查看 Codex 配额和今日使用量，在独立桌面窗口中打开完整 TokenDash 分析。

## Windows 运行

从 Releases 下载安装包，或解压免安装包后运行 `LotusTokenDash.exe`，无需另装 Node。

悬停 HUD 展开来源选择和缩放控件；拖到显示器顶部变为细条。点击右上角箭头打开独立分析窗口。退出、显示/隐藏和置顶开关位于系统托盘菜单。

分析窗口顶部可选择中文或 English，切换立即生效并记住选择。HUD 点击“用量／余量”切换官方 5h / 7day 已用或剩余比例；今日 Token 与缓存命中率继续显示所选来源的消费统计。悬停后通过独立的“−／＋”按钮缩小或放大（75%–150%）。

分析窗口只有一个：连续点击或从托盘打开都会复用它；关闭会隐藏，再次打开会恢复。启动连接失败时显示错误并提供重试。Windows 启动日志在 `%APPDATA%/com.lotus.tokendash/desktop.log` 和 `service.log`，仅记录启动阶段，不记录会话内容或凭据。

## 功能

- 悬浮 HUD：5h / 7day 用量或余量、重置时间、理想使用进度标线、今日 token、缓存命中率。
- 拖到显示器顶部自动变为细条，悬停展开；可缩放、隐藏到托盘、恢复位置。
- Codex 官方与各 custom provider 独立分组，HUD 来源可切换。
- 独立分析窗口保留 TokenDash 的日/月/会话、模型、项目、时段、热力图、会话详情和数据路径设置。
- 中英文切换覆盖分析页、图表、会话详情和设置；保留原始会话文字、模型名称与目录路径。
- 支持 Claude Code / Codex / OpenClaw / OpenCode / Pi，及 Codex / Claude / GLM / MiniMax / Kimi 配额适配器。
- 色彩来自 `22222B / AF8369 / FFFDD8 / 6F252A / EDEDED`。

## 开发

需要 Node 24、Rust 和对应系统的 Tauri 构建依赖。

```sh
node tools/tasks.mjs install
node tools/tasks.mjs test
node tools/tasks.mjs build
node tools/tasks.mjs desktop
```

`source/app/node_modules` 是指向 `runtime/development/node_modules` 的链接。Windows 优先构建；GitHub Actions 可手动选择三平台，也会在版本 tag 时构建三平台。产物位于 `build/rust-target`；本地交付包归档到 `releases/<version>`。

首次运行读取本机的会话目录和 Codex 登录状态。个人会话、登录文件、API token 和使用量索引不会提交到仓库。应用设置独立存放在系统应用数据目录。来源无法确认的历史日志单独展示。

上游与口径说明见 [docs/UPSTREAM.md](docs/UPSTREAM.md)。
