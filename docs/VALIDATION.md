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
- 最终源码 `a751e9f6741f429b170919bc8422741500cd7798` 的 [Windows 构建](https://github.com/lotusfromkarasu-cyber/LotusTokenDash/actions/runs/36991713691) 通过。下载后的免安装包及更新到 `K:/App/TOOL/LotusTokenDash` 的 v0.1.1 安装版，分别在本机通过两次原生启动自检。
- 未使用 Computer Use；真实鼠标拖动与多显示器行为保持原来的人工验收范围。

# v0.1.2 语言、余量、尺寸与吸附

- 用本地中英文词表与 React 状态订阅实现即时切换，不增加翻译运行时依赖。语言变化保留数据来源、日期范围和统计指标；会话原文、模型名称、路径不作翻译。
- HUD 用量与余量切换只改变官方配额比例和进度条，缺失值继续显示“—”；今日 Token 与缓存命中率仍属于当前选中的来源。
- 来源控件收窄至 154 像素，箭头位于控件内部右端；独立缩小／放大按钮在 75%–150% 范围内工作，不再循环切换档位。
- 将拖动、悬停、按钮选择交给同一个控制器。异步命令按版本处理，过期的拖动和布局结果不覆盖新的选择；原生几何操作串行处理，调用窗口接口前释放状态锁。
- [Tauri 维护者说明](https://github.com/orgs/tauri-apps/discussions/14446)指出 Windows 的 `startDragging` 可能提前返回。仅在当前拖动期间通过 [GetAsyncKeyState 的高位](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate)等待实际松开鼠标；新的模式选择会取消旧拖动的结束处理。
- 类型检查和 194 项单元测试通过，包含悬停计时器、旧拖动结果、并发布局结果和尺寸上下限的 4 项回归测试。
- 57 项界面用例通过：完整首次运行通过 53 项，更新旧文字／配色定位后其余 4 项通过。覆盖语言切换和保留筛选、中文会话详情和设置、余量记忆与未知配额、箭头位置、独立缩放及三轮恢复／重新吸附。
- 原生验收路径保留分析页实际渲染、唯一窗口、两次冷启动、关闭重开及 HUD 刷新，并增加三轮“旧拖动结果在重新吸附后返回”的场景。真实鼠标拖动由用户操作验收；未使用 Computer Use。
- 源码 `2e7f86f98f66288072417148eea5f7db9ed608b4` 的 [Windows 构建与原生验收](https://github.com/lotusfromkarasu-cyber/LotusTokenDash/actions/runs/36997201652)通过。本机下载后的免安装包和更新到 `K:/App/TOOL/LotusTokenDash` 的 v0.1.2 安装版分别通过两次冷启动与全部原生场景。发布目录包含安装包、免安装包、版本说明、构建来源与 SHA256 校验文件，保留 v0.1.0 / v0.1.1。
