# 端砚 · Inkstone

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![A2A](https://img.shields.io/badge/A2A-1.0-6c7ae0.svg)](https://a2a-protocol.org)

[English](README.md) | **中文**

一个独立的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，把 A2A agent
registry 接进你的助手：OpenXLab AK/SK 一次登录，浏览 registry 目录，像使用原生子代理一样委派远程
A2A agent。

```
设置 ──端砚 Tab──► AK/SK 登录 ──► 广场目录 ──► 添加 agent ──┐
                                                            ▼
  模型 ──► subagent_a2a 工具 ──► 远程 provider ──► registry A2A agents
                （contextId 续接，按 agent 自动 SSO/STS 鉴权）
```

## 亮点

- **一次安装、完整集成** —— 设置里出现独立 Tab，`subagent_a2a` 工具自动注册；名单写入 profile
  用户层持久保存，改动即时热重建 provider，无需重启。
- **鉴权全覆盖** —— registry 的 `auth_scheme_type` 直接映射请求头：`http` → OpenXLab SSO 直带 ·
  `token_exchange` / `orbit_jwt` → STS 换票（按真实 TTL 缓存）· `none` → 匿名。
- **健壮的 A2A 1.0 客户端** —— 卡片探测带 HTML 壳回退、冻结端点绑定、SSE 流消费、以及针对
  「答案只在 GetTask 里」的 history 回读。
- **多轮续接** —— 对同一 agent 再次委派会续接同一远程会话（`contextId`），支持大纲确认类流程。

## 已验证 agent

| Registry agent | 鉴权 | 状态 |
| --- | --- | --- |
| a2a-test-agent | orbit_jwt | ✅ 流式 + artifacts |
| MolClaw-agent | orbit_jwt | ✅ 答案走 artifacts |
| ep-agent | token_exchange | ✅ |
| caicopilot-agent | http | ✅ |
| EarthLink | http | ✅ 连通/鉴权正常；空回复为 staging 上游配额问题的已知事项 |

## 安装

> 需要带插件缝的 DSH 运行时（`>=0.2.1-alpha.1`）。该版本发布前，DSH 需从 harness 源码启动。

```sh
dsh plugin --profile web add github:apx103/dsh-plugin-inkstone
# 或从本地目录安装
dsh plugin --profile web add file:/path/to/dsh-plugin-inkstone
```

安装后重启应用，打开 **设置 → 端砚 · A2A Agents**：

1. 填入 OpenXLab AK/SK —— 经凭据服务存储一次，令牌生命周期自动维护。
2. 目录自动加载，挑选想要的 agent。
3. 让助手委派即可：`subagent_a2a` 出现在工具列表，`agent` 枚举就是你的名单。

## 配置

设置页的名单编辑落在 profile 用户层；同样的字段也可以写进 `cordis.patch.yml`：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `registryBaseUrl` | `https://agent-registry-staging.intern-ai.org.cn` | registry 根地址 |
| `ssoBaseUrl` | OpenXLab 默认 | SSO 网关 |
| `agents` | `[]` | volatile 名单：name / endpointUrl / authScheme / description / enabled |
| `toolName` | `subagent_a2a` | 模型侧工具名（`subagent_*` 前缀走原生子代理 UI 分组） |
| `maxDepth` | `1` | 委派深度上限 |

## 包结构

| 路径 | 职责 |
| --- | --- |
| `src/a2a/` | A2A 1.0 协议客户端库（零 DSH 依赖） |
| `src/registry/` | OpenXLab SSO · STS 换票 · MCP 目录 · 宿主服务 `ctx.a2aRegistry` |
| `src/remote/` | 面向设置页的 `a2aRegistry` Remote 控制器 |
| `src/subagent/` | 委派镜像：providers + `subagent_a2a` 工具 |
| `src/client/` | 浏览器设置 Tab（自挂载 Remote 命名空间） |

## 开发

```sh
pnpm install
pnpm test     # 155 个测试
pnpm build    # tsc（两段式）+ tsdown → lib/index.js + lib/client.js
```

类型检查与测试对接本地 deepseek-harness 检出 —— 把 `vitest.config.ts` 里的 `HARNESS`（以及
`tsconfig.json` 的 `paths`）指向你的目录即可。`lib/` 下的构建产物随仓库提交：GitHub 分发的安装
不执行构建脚本。

## 许可

[MIT](LICENSE)
