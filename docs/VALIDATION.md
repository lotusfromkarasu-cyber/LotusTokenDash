# v0.1.0 验证记录

- TypeScript 服务端与界面类型检查通过。
- 190 项解析与数据测试通过，包括累计 token 去重、缓存、分叉历史与 provider 分组。
- 47 项上游界面用例已完成；修复新增选择器定位和默认 agent 差异后重跑失败项。另有 2 项 Lotus 界面用例验证来源切换、HUD 和顶部细条，缩放布局经过尺寸检查。
- 打包后的服务使用合成 JSONL 验证匿名请求拒绝、并发来源隔离、今日比例以及日/项目/时段/会话接口。
- 使用本机真实会话记录与当前 Codex 登录状态验证来源识别、当日 token 和缓存比例、5h / 7day 配额读取；未将个人数据写入仓库。
- Windows 原生编译及安装包由 [GitHub Actions](https://github.com/lotusfromkarasu-cyber/LotusTokenDash/actions) 完成。
- 交付的免安装包已解压检查，并用包内 Node 和实际打包服务运行同一组接口验证，结果通过。
- 未使用 Computer Use。原生窗口拖动、托盘交互和多显示器吸附需用户实际操作确认。macOS / Linux 保留构建流程，本次优先交付 Windows。
