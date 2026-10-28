# 端砚 (dsh-plugin-inkstone) 集成现状与差距分析

## 1. 概述

本报告基于对 `dsh-plugin-inkstone` 仓库源码的实际阅读（`src/` 下全部模块、客户端、测试与文档），并结合 Intern InkStone 桌面版公开帮助中心所描述的产品能力，梳理：

1. 插件已经实现的功能清单；
2. 与 intern-inkstone 桌面版相比仍然缺失或薄弱的能力；
3. 下一步最值得优先做的 10 项集成建议；
4. 对当前插件架构与 DSH/Cordis 集成方式的评价。

仓库根路径：`/Volumes/ssd/main_link/work/dsh-plugin-inkstone`。

---

## 2. 已实现功能清单

| # | 功能 | 主要代码路径 | 说明 |
|---|---|---|---|
| 1 | A2A 1.0 协议客户端 | `src/a2a/` | 包括卡片发现/探测、JSON-RPC/HTTP+JSON 传输选择、SSE 流式消费、任务状态分类、part/artifact 投影、reasoning 文本提取、错误分类。 |
| 2 | OpenXLab SSO 认证链 | `src/registry/sso.ts` | AK/SK → nonce/HMAC-SHA1 → JWT；refresh_token 续期；并发单飞（single-flight）token 获取；提前刷新。 |
| 3 | 每 Agent STS 票据交换 | `src/registry/sts.ts` | 按 agent 缓存短效 ticket，依据真实 TTL 失效；支持 `token_exchange` / `orbit_jwt` / `http` / `none` 等 scheme。 |
| 4 | Agent Registry 目录发现 | `src/registry/discovery.ts` | 通过 MCP streamable-http 调用 `list_resources` 拉取可见 A2A agent 列表。 |
| 5 | Registry 宿主服务 | `src/registry/service.ts` | 提供 `ctx.a2aRegistry`：status/login/logout/discover/`agentHeaders`/identity。 |
| 6 | A2A 委派镜像 | `src/subagent/` | 每个启用的 roster agent 注册一个 `a2a/<name>` 远程 subagent provider；同时提供模型面 `subagent_a2a` 工具；支持 contextId/taskId 续接、认证失败重试、delegation depth 限制。 |
| 7 | SCP Hub 目录客户端 | `src/scphub/client.ts` | 搜索 SCP/Skill 目录、SCP/Skill 详情、签名资源下载、响应严格校验。 |
| 8 | SCP Hub 执行面 API Key 生命周期 | `src/scphub/credential.ts` | 按日命名创建/复用 `SCP-HUB-API-KEY`，写入 DSH credentials store，过期前 60s 自动 renew。 |
| 9 | SCP Hub 宿主服务 | `src/scphub/service.ts` | 提供 `ctx.scpHub`：search、`scpDetail`、`skillDetail`、`skillArchive`、API key 获取。 |
| 10 | 选择性 SCP 工具桥 | `src/scphub/tools-bridge.ts`, `src/scphub/mcp.ts` | 无状态 JSON-RPC MCP 执行桥；只注册用户勾选的工具；工具名规范化；结果投影支持图片 durable admission；30s 截止。 |
| 11 | 技能安装与 zip 解包 | `src/skills/install.ts` | 中央目录解析、deflate 解压、路径逃逸防护、原子 staging/rename、旧版本退役清理。 |
| 12 | 内置端砚技能 | `src/skills/builtin.ts`, `skills/` | 随包分发 5 个科研 SKILL.md（文献综述、科研作图、figure-composer、论文叙事、适应症档案），支持 `disabledBuiltinSkills` 热开关。 |
| 13 | 设置页 UI | `src/client/` | Settings → 端砚 Tab：SSO 登录卡、Agent Registry、SCP Services、Skills、Inkstone Skills 四个子 Tab；目录刷新、roster 编辑、工具勾选器、目录搜索/安装。 |
| 14 | 热重建镜像 | `src/index.ts` | `inkstone-delegation` 与 `inkstone-scp-hub` 两个子插件监听 `loader/volatile-update`（`{ global: true }`），dispose 后全量重建 roster/SCP/技能。 |
| 15 | Remote 边界与凭证隔离 | `src/remote/`, `src/scphub/remote.ts` | 浏览器侧只能拿到投影（view），AK/SK、JWT、STS ticket、API key 均不出宿主；手写 zod schema 的 Typert Remote namespace。 |
| 16 | 配置持久化 | `cordis.patch.yml`, Config schema | volatile 字段 `agents`/`scps`/`skills`/`disabledBuiltinSkills` 落入 profile 用户层；支持 `cordis.patch.yml` 预设。 |
| 17 | 测试覆盖 | `tests/` | 15 个 spec 文件覆盖 A2A 客户端、registry SSO/STS/discovery、SCP 工具桥、skill 安装、provider、Remote 等场景。 |

---

## 3. 架构评价

### 3.1 与 DSH/Cordis 的集成方式

- **分层清晰**：浏览器面 / Remote 面 / 宿主面严格分离，层间只通过 Cordis 服务与 Typert Remote 通信，符合 DSH 插件安全模型。
- **子插件顺序即依赖序**：入口 `apply` 中先注册 `A2aRegistryService`，再包装注册 `ScpHubService`（依赖 `a2aRegistry` 共享 SSO 身份），再挂 Remote controller，最后挂两个镜像子插件。这种写法充分利用了 Cordis 的 inject 机制。
- **tracing proxy 意识强**：因为 `ctx.<service>` 是代理，Service/Controller 类避免私有字段，逻辑核心放在普通类（`RegistryClientCore`、`ScpHubCore`）中，通过公有 `core` 字段暴露，避免了 brand check 报错。

### 3.2 热重建

- 三个镜像（delegation、SCP 工具、技能）都是**幂等全量重建**：收到 volatile-update 后先全部 dispose，再按当前配置重建。
- 关键点：监听器必须带 `{ global: true }`，因为 Cordis loader 派发事件时带 `Context.filter` 限定 `owner.fiber === fiber`。设计文档和代码都正确处理了这一点。
- 缺点：全量重建在 SCP 工具很多或 skill 安装大时会有短暂抖动；未来可考虑增量更新。

### 3.3 技能系统

- 采用 DSH 原生 `ctx.skills.register`，skill 只提交 name/description/content，资源文件留在磁盘，符合 DSH skill 契约。
- 内置技能与目录安装技能分两条路径：内置为 `source: 'bundled'` 且带 `resourceBase`；目录技能为 `source: 'runtime'`。
- 技能内容从 InternAgent 已验证目录移植，工具引用已映射到 DSH 现有工具面（`web_search`/`web_fetch`/`read`/`bash` + matplotlib），并优先使用挂载的 `mcp__*` 工具。

### 3.4 鉴权模型

- 单一 OpenXLab AK/SK 凭证（`a2a-registry/openxlab`）服务所有面：Registry 目录、STS 换票、SCP Hub 目录与 API key。
- AK/SK 只进不出；浏览器 Remote 方法只返回状态/投影，所有网络请求与密钥生命周期留在宿主。
- 凭证库隔离了 staging/production（`scp-hub/<environment>`），支持多环境切换。

### 3.5 主要风险点

- **无状态 MCP 假设**：SCP 工具桥假设执行面无会话、不需要 `initialize`。设计文档已说明“需要会话的 SCP 服务器暂不支持”。
- **工具列表不自动同步**：上游工具变化不会推送给客户端，需要用户手动触发勾选器重拉。
- **A2A 复杂状态处理有限**：`input-required` 在 provider 中会返回提示，但 `subagent_a2a` 工具目前只支持单轮 objective，不能优雅地要求用户补充输入。

---

## 4. 与 intern-inkstone 桌面版的差距列表

| # | 缺失能力 | intern-inkstone 来源 | 价值 | 说明 |
|---|---|---|---|---|
| 1 | Project Space / 知识库（Knowledge Base） | `docs/en/knowledgeBase/overview`, `docs/en/knowledgeBase/list` | high | 桌面版以“项目”为核心组织文件、工具、会话与产出；当前插件所有能力都是全局 profile 级别，没有 per-project 上下文。 |
| 2 | Deep Research / 领域专家路由 / 报告生成 | `docs/en/researchAssistant/deep`, `docs/en/researchAssistant/overview` | high | 桌面版有 Quick/Deep 两档思考模式，Deep 模式会路由到 Earth Science / Physics 等领域子 Agent 并生成结构化报告；插件只有单轮 `subagent_a2a` 委派。 |
| 3 | 科学计算集成（开发机 / 训练任务 / 数据集 / 云盘） | `docs/en/workbench/overview`, `docs/en/workbench/training`, `docs/en/workbench/machine`, `docs/en/scientificData/guide` | high | 桌面版提供云 GPU/NPU 开发机、Training tasks、数据集挂载、云盘 `/data`；插件没有任何计算/存储资源调度能力。 |
| 4 | Agent Registry 发布能力（本地 agent 暴露为 A2A 服务） | Agent Registry 产品概念 / `docs.phinite.ai/agent-registry/expose-your-flow` 所描述的 A2A 发布流程 | high | 插件只能消费 registry 中的 agent，不能把 DSH 本地 agent/flow 发布成 A2A Agent Card。 |
| 5 | 项目级工具绑定与推荐工具 | `docs/en/knowledgeBase/tools`, `docs/en/scpPlaza/overview` | high | 桌面版工具/技能绑定到项目，并支持“Recommended Tools”推荐；插件是全局 `scps`/`skills` 列表，每个会话都可见。 |
| 6 | 多 Agent 实验编排 / 共享实验上下文 | SCP Hub 论文与 `docs/en/scpPlaza/overview` 中描述的 workflow orchestration | high | SCP 协议包含 experiment lifecycle、multi-agent collaboration；插件目前只是逐个调用 MCP 工具，没有 workflow/experiment context。 |
| 7 | 会话产物 Workspace / 文件树持久化 | `docs/en/researchAssistant/deep`（workspace 与 preview） | medium | 桌面版会话右侧有 workspace 收集报告、代码、图表；DSH 本身有会话文件，但插件没有针对 Inkstone 场景做结构化产出归档。 |
| 8 | Agent Registry 过滤与生命周期（test/live、visibility、tags、promote） | `docs.phinite.ai/agent-registry/catalog`, `docs.phinite.ai/agent-registry/endpoints-and-lifecycle` | medium | 插件目录只展示全部可见 agent，没有按状态/可见性/标签过滤，也没有 promote/test 管理能力。 |
| 9 | 实时 MCP 会话与 `listChanged` 订阅 | SCP/MCP 协议能力（当前代码明确注释未实现） | medium | 插件只支持无状态单次请求；有状态服务器、initialize instructions、工具变更推送均未支持。 |
| 10 | Skill 发布与“我的技能”管理 | `docs/en/userCenter/skills`, `docs/en/scpPlaza/skill-guide` | medium | 插件只能安装/启用已有 skill，不能将本地 skill 打包上传到平台。 |
| 11 | @ 文件引用 / RAG 对话入口 | `docs/en/knowledgeBase/ai-chat` | medium | 桌面版 Project AI Chat 支持在输入框 `@` 引用知识库文件；插件未与 DSH 聊天附件/文件引用做专门整合。 |
| 12 | 结果保存 / Add to Project / 笔记 | `docs/en/researchAssistant/overview` | low | 桌面版每条回答可保存为 note 并加入项目；插件无此概念。 |
| 13 | 团队/组织共享与权限 | `docs/en/scientificData/create` 提到 Team Dataset / 可见性 | low | 插件目前只有个人 profile 级配置，没有团队/组织共享、visibility 控制。 |
| 14 | 计算积分/计费集成 | `docs/en/workbench/training` 中 compute credits | low | 训练任务、开发机涉及计费；插件无相关集成。 |

---

## 5. 下一步最值得做的 10 项集成建议

| 优先级 | 建议 | 目标价值 | 关键工作 |
|---|---|---|---|
| 1 | **引入 Project Space 概念** | high | 在 DSH 会话/项目模型上增加“项目”作用域，支持 per-project 的 knowledge base 文件与工具绑定；复用 DSH 现有文件/attachment 能力。 |
| 2 | **实现 Deep Research 模式** | high | 在 DSH 中增加 Quick/Deep 思考模式切换；Deep 模式下由主 Agent 做学科识别，再路由到领域专家 subagent（可用现有 A2A provider 扩展）。 |
| 3 | **集成 Scientific Computing 能力** | high | 通过 SCP Hub 或专用 API 暴露“创建开发机 / 创建训练任务 / 挂载数据集 / 云盘文件”等工具，让 Agent 能调度远程计算。 |
| 4 | **支持本地 Agent 发布到 A2A Registry** | high | 新增发布流程：将 DSH agent/flow 打包为 Agent Card，调用 registry API 注册 test/live build，并生成 endpoint URL。 |
| 5 | **项目级推荐工具与工具绑定** | high | 把当前全局 `scps`/`skills` 改为可绑定到具体项目；根据项目学科/文件内容推荐相关 SCP/Skill。 |
| 6 | **实验/工作流编排层** | high | 在 SCP 单次 tool call 之上增加 experiment context 与 multi-step workflow 抽象，支持“目标 → 任务分解 → 多 Agent 协作 → 结果归档”。 |
| 7 | **支持有状态 MCP 会话与工具变更推送** | medium | 对需要 session 的 SCP server 使用持久 MCP 连接；订阅 `notifications/tools/list_changed`，自动刷新已挂载工具 schema。 |
| 8 | **增强 Agent Registry 目录管理** | medium | 在 UI 增加 test/live、visibility、tags、input/output mode 过滤；支持 promote/delete 等生命周期操作。 |
| 9 | **Skill 发布与“我的技能”管理** | medium | 提供本地 SKILL.md + toolkit 打包、上传到 SCP Hub skill plaza、版本管理、可见性设置。 |
| 10 | **结构化 Workspace 产物归档** | medium | 在会话中收集生成的报告/图表/代码到项目 workspace；提供右侧文件树预览与下载。 |

---

## 6. 结论

`dsh-plugin-inkstone` 已经把 intern-inkstone 最核心的 **A2A Agent Registry 消费**、**SCP Hub 目录与执行面**、**Skill 安装与内置科研 skill** 三大能力高质量地移植到了 DSH 插件中，且在 Cordis 分层、凭证隔离、热重建、无状态 MCP 桥等方面有成熟设计。与桌面版相比，差距主要集中在 **项目化研究空间（Project Space + Knowledge Base）**、**Deep Research 多 Agent 编排**、**科学计算资源调度** 以及 **Agent/Skill 的双向发布能力** 上。下一步若能补齐项目上下文与 Deep Research 编排，将显著缩小与 intern-inkstone 桌面版的功能差距。
