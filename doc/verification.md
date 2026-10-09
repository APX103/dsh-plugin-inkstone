# 验证记录

按功能阶段记录的实测结果。环境：DSH 源码启动（profile `web-inkstone`，bundles `dsh-base` +
`dsh-web-app` + 本插件 symlink），OpenXLab staging 环境，模型 DeepSeek-V41-Flash。日期均为
2026-10-09。

## 1. Agent Registry（v0.1.0）

对 staging 目录五个 agent 的全量连通验证（人工 + `A2A_TEST_ALL=1` 定时问候脚本）：

| Registry agent | 鉴权 | 结果 | 备注 |
| --- | --- | --- | --- |
| a2a-test-agent | orbit_jwt | ✅ | 流式回复 + artifacts；大纲确认 → contextId 续接两轮验证 |
| MolClaw-agent | orbit_jwt | ✅ | 答案经 artifacts 返回，正文为空——客户端按 artifacts 兜底 |
| ep-agent | token_exchange | ✅ | 卡片在 origin 返回 SPA HTML，探测回退父/祖父路径后可用 |
| caicopilot-agent | http | ✅ | SSO 直带 |
| EarthLink | http | ✅（连通/鉴权） | 空回复：staging 算法服务上游 key 配额耗尽（429），且 earthlink-be 把错误误判为成功——已从 K8s 日志根因定位，非本插件问题 |

委派 E2E：提示词 → `subagent_a2a` 委派 a2a-test-agent → 大纲确认 → contextId 续接 → 235 行评审
落盘工作区，全链路通过。5-agent 定时问候 5/5 PASS（EarthLink 完成但为空，同上）。

## 2. SCP Hub 三 Tab（feat/scp-hub）

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 插件激活、三子 Tab 渲染 | ✅ | 浏览器设置页 Agent Registry / SCP Services / Skills；SSO 会话延续（User 20101151） |
| SCP 目录搜索（真实目录） | ✅ | 空关键词 + 关键词搜索均返回（SciGraph、ToolUniverse、VenusFactory 等） |
| 添加 ToolUniverse | ✅ | 列表出现 "1894 tools"；配置落 profile 用户层；`SCP-HUB-API-KEY` 自动换取并写凭据库 `scp-hub/staging` |
| MCP 工具模型可见 | ✅ | 新会话模型可列出 `mcp__tooluniverse__ADA_*`、`mcp__tooluniverse__ADMETAI_*` 等；session log `request/header` 确认 1,894 个工具全量下发（≈450K tok schema） |
| 技能目录搜索 | ✅ | 返回 BaiChuanShuHui、InterSci-KD、literature-concept-mapper 等 |
| 安装 BaiChuanShuHui | ✅ | SKILL.md + toolkit（141 个文件）原子安装到 `~/.dsh/inkstone/skills/scp-7684/`；frontmatter 完整 |
| 技能模型可见 | ✅ | 新会话询问技能目录，模型确认 `baichuanshuhui` 存在 |
| 冷启动重建 | ✅ | 重启宿主后按持久化配置自动重建：API key 换取 → mcp-client 挂载（fiber ACTIVE）→ 工具同步 |
| 委派回归 | ✅ | Agent Registry 目录加载、roster 展示、`subagent_a2a` 工具在模型工具列表中 |
| 单元测试 / 类型 | ✅ | 179 tests 全绿（含 deflate zip 解包、apikey 翻页、镜像 inject 转发用例）；tsc 零错误 |

### 排障过程中确认的服务端行为

这些是 SCP Hub staging 的实测 wire 行为，接入方需要知道：

- 全线分页 0 起始：`page=1` 静默返回空列表（目录搜索与 apikey/list 都如此）。
- MCP 执行端点（streamable-http）对 initialize 之后的请求要求 `MCP-Protocol-Version` 头，缺失时
  返回误导性的 `-32602 Invalid params`；可无会话（不下发 `MCP-Session-Id`）。
- toolkit zip 的 local header 一律带数据描述位（flag bit 3），尺寸只可信中央目录。

## 3. 选择性工具挂载（feat/scp-hub 后续）

全量挂载把整台服务器的工具 schema 灌进模型上下文（1,894 工具 ≈ 450K token），改为按工具勾选：
添加 SCP 默认不挂载，设置页分页清单勾选后才注册。实测（同上环境）：

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 新添加 SCP 默认零挂载 | ✅ | 行显示 "no tools" + 停靠提示；模型工具清单 0 个 mcp__ |
| 工具选择器 | ✅ | 打开后拉取 1,894 个工具，50/页分页渲染，勾选即时写配置 |
| 勾选 3 个工具（ToolUniverse_get_usage_tips / Tool_RAG / Tool_Finder） | ✅ | 行 tag "3 selected"；新会话模型精确列出且仅列出这 3 个 `mcp__tooluniverse__*` |
| 上下文占用 | ✅ | 会话用量 22.6K tok（全量挂载时同提示词为 463K tok） |
| 无状态执行转发 | ✅ | 模型真实调用 ToolUniverse_get_usage_tips，返回原文（"tu.load_tools()" 等提示） |
| 单元测试 / 类型 | ✅ | 188 tests 全绿（无状态 JSON-RPC、选择性注册、名字规范化、isError 拒绝、镜像截断）；tsc 零错误 |

实现备注：dsh-mcp-client 无工具白名单能力，SCP Hub 执行面又实测无会话（每请求独立），故插件自管
轻量桥（发现一次 + 按调用 POST），细节见设计文档第 4 节。

## 4. 已知事项

- EarthLink 空回复为上游 staging 配额问题（见上表），客户端无待办。
- 需要会话（拒绝无状态请求）的 SCP 服务器暂不支持（见设计文档第 4 节边界说明）；上游工具清单
  变化不自动同步，靠改动勾选触发重拉。
- 外部安装依赖 DSH 发布 `>=0.2.1-alpha.1` 之前需从源码启动宿主（README 已注明）。
