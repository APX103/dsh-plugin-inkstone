# dsh-plugin-inkstone · 端砚

中文 | [English](README.md)

**端砚** 是一个独立的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，接入 A2A agent registry：OpenXLab AK/SK 登录与 SSO 生命周期、registry 目录浏览，以及像原生子代理一样委派的远程 A2A agent。

## 安装

需要带插件缝的 DSH 运行时（`>=0.2.1-alpha.1`，当前为 harness `master` 源码启动）：

```sh
dsh plugin --profile web add github:<owner>/dsh-plugin-inkstone
```

或从本地目录安装：

```sh
dsh plugin --profile web add file:/path/to/dsh-plugin-inkstone
```

安装后重启应用。设置里会出现 **端砚 · A2A Agents** 标签页：填入 OpenXLab AK/SK（一次保存、长期复用），目录自动加载；添加 agent 后即可通过 `subagent_a2a` 工具委派——名单写入 profile 用户层持久保存，改动即时热重建 provider，无需重启。

## 内部结构

- `src/a2a/` — A2A 1.0 协议客户端（卡片探测回退、冻结端点绑定、SSE 流消费、静默回合 history 回读）。
- `src/registry/` — OpenXLab SSO、STS 换票、MCP 目录发现、宿主服务 `ctx.a2aRegistry`。
- `src/remote/` — 面向设置页的 `a2aRegistry` Remote 控制器（typert）。
- `src/subagent/` — 委派镜像：每个启用的 roster agent 一个远程 provider，外加 `subagent_a2a` 工具。
- `src/client/` — 浏览器设置页（自挂载 Remote 命名空间）。

## 开发

```sh
pnpm install
pnpm test     # 155 个测试
pnpm build    # tsc（两段式）+ tsdown → lib/index.js + lib/client.js
```

本仓库通过 `tsconfig.json` paths 与 `vitest.config.ts` 解析器对接本地 deepseek-harness 检出——把 `vitest.config.ts` 里的 `HARNESS` 指到你的目录即可。`lib/` 下的构建产物随仓库提交：GitHub 分发的安装不允许执行构建脚本。

## 鉴权模式

registry 的 `auth_scheme_type` 直接映射到请求头：`http` → OpenXLab SSO 直带；`token_exchange`/`orbit_jwt` → STS 换票（按真实 TTL 缓存）；`none` → 不带凭据。
