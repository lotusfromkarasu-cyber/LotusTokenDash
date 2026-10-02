# 上游与实现选择

- TokenDash 1.9.1，MIT，commit `0e17ffd0f578404ba112aa66a323409e26d18472`：保留 React 分析页、5 种 agent 解析器、索引、会话分析、配额适配器与数据路径设置。许可证见 `source/app/LICENSE`。
- codex-quota-widget，MIT，commit `dff6d5323a25174a385ac2976d55a201432f39ff`：参考 0.2.0 的 HUD、顶部细条、悬停展开、拖动吸附、配额进度与理想进度标线。桌面壳独立重写。
- CodexBar：参考数据适配器与展示分离的结构；未复制其源代码。
- Tauri 2：系统 WebView、托盘与多窗口。Node 服务保留上游数据处理能力，随安装包分发，无需用户另装 Node。

源码位于 source；生成文件、索引测试数据与构建缓存在 build；开发依赖在 runtime；交付包在 releases。应用个人设置、凭据与增量索引位于系统应用数据目录，均不进入 Git。

## 数据口径

Codex 按历史 `session_meta.model_provider` 分组，`turn_context.model_provider` 可逐次覆盖。`openai` 是官方，其余各 provider 独立列为 custom；缺失字段归入“来源未确认”。目录或模型名称不决定来源。

缓存比例为该组缓存输入 / 该组总输入。TokenDash 的展示输入为未缓存输入，因此分母是 `inputTokens + cacheReadTokens`。不平均多段对话的命中率。

配额通过已登录 Codex 的 `account/rateLimits/read` 获取，独立于本地 token 统计。仅显示接口确实报告的窗口。模型费用是价格表估算，不是订阅账单。

一个持久解析 worker 共享增量文件索引；各组响应、HTTP 缓存与会话分析 revision 带来源标识。关闭详情窗口会释放其 WebView；HUD 和详情共用本地服务，不重复启动服务器。
