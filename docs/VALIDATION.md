# v0.1.0 验证记录

- TypeScript 服务端与界面类型检查通过。
- 190 项解析与数据测试通过，包括累计 token 去重、缓存、分叉历史与 provider 分组。
- 47 项上游界面用例已完成；修复新增选择器定位和默认 agent 差异后重跑失败项。另有 2 项 Lotus 界面用例验证来源切换、HUD 和顶部细条，缩放布局经过尺寸检查。
- 打包后的服务使用合成 JSONL 验证匿名请求拒绝、并发来源隔离、今日比例以及日/项目/时段/会话接口。
- 使用本机真实会话记录与当前 Codex 登录状态验证来源识别、当日 token 和缓存比例、5h / 7day 配额读取；未将个人数据写入仓库。
- Windows 原生编译及安装包由 [GitHub Actions](https://github.com/lotusfromkarasu-cyber/LotusTokenDash/actions) 完成。
- 交付的免安装包已解压检查，并用包内 Node 和实际打包服务运行同一组接口验证，结果通过。
- 未使用 Computer Use。原生窗口拖动、托盘交互和多显示器吸附需用户实际操作确认。macOS / Linux 保留构建流程，本次优先交付 Windows。

# v0.1.1 黑窗与单窗口修复

- 根因：`open_details` 在同步命令及托盘回调中创建 WebView2 窗口，触发 [Tauri 官方记录的 Windows 死锁](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html#method.new)。改为异步命令内后台创建，互斥保护查找与创建，关闭时隐藏并保留唯一实例。
- 190 项数据测试及前后端类型检查通过。
- 5 项相关界面用例通过：启动失败提示及重试（HUD / 分析两种入口）、监听器不会重复注册、配额失败及刷新恢复、原有来源切换与细条展开。
- 新增打包原生程序自检（`tools/native-smoke.mjs`）：真实运行 Tauri + WebView2 + Node 服务，所有测试窗口隐藏；从 HUD 原生 IPC 同时发出 8 次打开命令，验证仅有 HUD 和一个分析窗口，分析内容完成渲染，关闭后重开两次、HUD 刷新、第二次冷启动均正常。
- 自检使用临时合成会话和独立服务数据目录，完成后清理。日志只记录阶段；个人会话及鉴权信息不进入测试结果。
- 未使用 Computer Use；真实鼠标拖动与多显示器行为保持原来的人工验收范围。
