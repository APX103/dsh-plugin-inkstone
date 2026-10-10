# 端砚 · Inkstone

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![A2A](https://img.shields.io/badge/A2A-1.0-6c7ae0.svg)](https://a2a-protocol.org)

[English](README.md) | **中文**

一个独立的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，把 A2A agent
registry 与 SCP Hub 接进你的助手：OpenXLab AK/SK 一次登录，三个子 Tab —— 委派远程 A2A agent、挂载
SCP Hub 的 MCP 服务、安装平台发布的技能。

```
设置 ──端砚 Tab──► AK/SK 登录 ──► Agent Registry ──► 添加 agent ──┐
                                                                  ▼
  模型 ──► subagent_a2a 工具 ──► 远程 provider ──► registry A2A agents
                （contextId 续接，按 agent 自动 SSO/STS 鉴权）

       ──► SCP 服务 ──► 添加 SCP ──► 勾选工具 ──► mcp__<server>__*（仅勾选项）
       ──► 技能 ──► 安装 ──► ~/.dsh/inkstone/skills ──► 运行时技能注册
```

## 亮点

- **一次安装、完整集成** —— 设置里出现独立 Tab，`subagent_a2a` 工具自动注册；名单写入 profile
  用户层持久保存，改动即时热重建 provider，无需重启。
- **Agent Registry** —— 浏览 A2A agent 目录，像原生子代理一样委派远程 agent；registry 的
  `auth_scheme_type` 直接映射鉴权（SSO 直带 / STS 换票 / 匿名）。
- **SCP Hub 服务** —— 搜索 SCP Hub 目录并添加 MCP 服务；在设置页按工具勾选，只有选中的工具以
  `mcp__<server>__*` 注册，执行面密钥自动处理。
- **技能安装** —— 目录技能（SKILL.md + toolkit zip）原子解包安装到技能根目录并注册为运行时技能，
  助手的技能目录立即可见。
- **内置端砚技能** —— 一组经过验证的科研技能随插件打包（`skills/` 目录），安装即注册；可在
  端砚技能 Tab 逐个关闭，热生效、无需重启。

设计说明与验证记录见 [doc/](doc/)。

## 安装

> 需要带插件缝的 DSH 运行时（`>=0.2.1-alpha.1`）。该版本发布前，DSH 需从 harness 源码启动。

```sh
dsh plugin --profile web add github:apx103/dsh-plugin-inkstone
# 或从本地目录安装
dsh plugin --profile web add file:/path/to/dsh-plugin-inkstone
```

安装后重启应用，打开 **设置 → 端砚 · A2A Agents**：

1. 填入 OpenXLab AK/SK —— 经凭据服务存储一次，令牌生命周期自动维护。
2. **Agent Registry**：目录自动加载，挑选想要的 agent。
3. **SCP 服务 / 技能**：搜索 SCP Hub 目录，添加服务或安装技能。新添加的 SCP 在打开「选择工具」
   勾选之前不会挂载任何工具；勾选即时生效，无需重启。
4. 让助手委派即可：`subagent_a2a` 出现在工具列表，`agent` 枚举就是你的名单；MCP 工具以
   `mcp__<server>__*` 出现，已安装技能进入技能目录。

## 配置

设置页的名单编辑落在 profile 用户层；同样的字段也可以写进 `cordis.patch.yml`：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `registryBaseUrl` | `https://agent-registry-staging.intern-ai.org.cn` | registry 根地址 |
| `ssoBaseUrl` | OpenXLab 默认 | SSO 网关 |
| `agents` | `[]` | volatile 名单：name / endpointUrl / authScheme / description / enabled |
| `toolName` | `subagent_a2a` | 模型侧工具名（`subagent_*` 前缀走原生子代理 UI 分组） |
| `maxDepth` | `1` | 委派深度上限 |
| `scpHubApiBaseUrl` | `https://discovery-staging.intern-ai.org.cn/api` | SCP Hub 平台根（目录、详情） |
| `scpHubApiKeyBaseUrl` | `https://discovery-staging.intern-ai.org.cn/api/moce/v1` | 执行面 API key 换取的 moce 根 |
| `scpHubEnvironment` | `staging` | 凭据记录选择器（`staging` / `production`） |
| `scps` | `[]` | volatile SCP 清单：id / name / description / publisher / endpoint / enabled / selectedTools / toolNames |
| `skills` | `[]` | volatile 技能清单：id / skillName / name / description / enabled |
| `disabledBuiltinSkills` | `[]` | volatile 已关闭的内置技能名（默认全部启用） |
| `skillsRoot` | `~/.dsh/inkstone/skills` | 目录技能的安装根目录 |
| `maxToolServers` | `8` | 并发挂载的 SCP 服务上限 |
| `maxSelectedTools` | `128` | 所有服务合计可注册的选中工具上限 |

## 包结构

| 路径 | 职责 |
| --- | --- |
| `src/a2a/` | A2A 1.0 协议客户端库（零 DSH 依赖） |
| `src/registry/` | OpenXLab SSO · STS 换票 · MCP 目录 · 宿主服务 `ctx.a2aRegistry` |
| `src/remote/` | 面向设置页的 `a2aRegistry` Remote 控制器 |
| `src/subagent/` | 委派镜像：providers + `subagent_a2a` 工具 |
| `src/scphub/` | SCP Hub 客户端 · API key 换取 · 宿主服务 `ctx.scpHub` · `scpHub` Remote 控制器 · mcp-client/技能镜像 |
| `src/skills/` | toolkit zip 读取（中央目录遍历 + `node:zlib` 解压）、原子安装、内置技能挂载 |
| `skills/` | 随插件分发的内置 SKILL.md 资产（数据，非构建产物） |
| `src/client/` | 浏览器设置 Tab（自挂载 Remote 命名空间） |

## 开发

```sh
pnpm install
pnpm test     # 179 个测试
pnpm build    # tsc（两段式）+ tsdown → lib/index.js + lib/client.js
```

类型检查与测试对接本地 deepseek-harness 检出 —— 把 `vitest.config.ts` 里的 `HARNESS`（以及
`tsconfig.json` 的 `paths`）指向你的目录即可。`lib/` 下的构建产物随仓库提交：GitHub 分发的安装
不执行构建脚本。

## 许可

[MIT](LICENSE)
