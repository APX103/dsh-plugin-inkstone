# 设计说明

端砚（dsh-plugin-inkstone）把 OpenXLab 生态的三个能力接进 DeepSeek Harness（DSH）：A2A agent
registry（委派远程 agent）、SCP Hub（挂载托管 MCP 服务）、SCP Hub 技能目录（安装发布的技能）。
本文记录分层、认证链、挂载机制与安全边界背后的设计决策。

## 1. 分层

插件按运行面分为三层，层间只通过 cordis 服务与 typert Remote 通信：

```
浏览器面  src/client/            设置 Tab（SSO 卡 + 三子 Tab），自挂载 a2aRegistry/scpHub 两个 Remote 命名空间
Remote 面 src/remote/ src/scphub/remote.ts   浏览器可调的 RPC 面：目录/搜索/增删，凭据只进不出
宿主面    src/registry/ src/scphub/ src/subagent/ src/skills/   服务、镜像挂载、协议客户端
```

- **宿主面**持有全部网络与凭据。浏览器永远拿不到 AK/SK、SSO JWT、SCP-HUB-API-KEY——Remote 方法
  的返回值是投影（view），签名 URL、执行面密钥等不出宿主。
- **Remote 面**是显式白名单：每个方法手写 zod 参数/返回 schema（`src/client/typert.*.remote-client.js`
  镜像生成器产物格式，方法面变化时按注释提示重新生成或同步手改）。
- **浏览器面**不依赖任何宿主模块；两个 Remote 命名空间随插件自挂载，设置页通过
  `ctx.inject(['remote.a2aRegistry', 'remote.scpHub'])` 的子上下文消费（命名空间由本插件自己提供，
  写进自身 inject 会自等待死锁）。

## 2. 挂载拓扑

入口 `apply` 的子插件顺序（顺序即依赖序）：

```
inkstone（入口，inject: credentials）
├─ A2aRegistryService            ctx.a2aRegistry   （SSO/STS/目录）
├─ inkstone-scp-hub-service      包装子插件 inject: [credentials, a2aRegistry]
│    └─ new ScpHubService        ctx.scpHub        （目录客户端 + API key 换取）
├─ A2aRegistryController         Remote ns a2aRegistry
├─ ScpHubController              Remote ns scpHub
├─ inkstone-delegation           委派镜像 inject: [a2aRegistry, subagents, tools]
└─ inkstone-scp-hub              SCP/技能镜像 inject: [scpHub, skills]
```

要点：

- Service 构造器即在所属 fiber 注册服务名，因此兄弟 fiber 通过 `inject` 声明即可看到——不需要
  显式 provide。包装子插件的存在只是为了让 `scpHub` 能声明对 `a2aRegistry`（共享 SSO 身份）的依赖。
- **cordis 上下文是 tracing proxy**：经 `ctx.<name>` 或 `ctx.get()` 拿到的服务在代理上调用方法时，
  接收者是代理，类的私有 `#` 字段全部不可访问（brand check 报错）。因此：
  - `ScpHubService` 是薄壳，真实逻辑在普通类 `ScpHubCore`（公有 `core` 字段暴露）；
  - `ScpHubController` 的选项字段必须公有（`options` 而非 `#options`）——只有触碰私有字段的方法会
    炸，其余方法正常，这种"部分方法可用"极具误导性，新代码直接遵守"Service/Controller 无私有字段"。

## 3. 认证链

一份凭据（OpenXLab AK/SK，存于 DSH 凭据库 record `a2a-registry/openxlab`）服务所有面：

```
AK/SK ──OpenXLabSso──► SSO JWT（内存，自动刷新，状态在设置页展示）
         │
         ├─► registry 目录 / SCP Hub 目录        Authorization: Bearer <JWT>
         ├─► STS 换票（token_exchange/orbit_jwt）  按 agent 缓存、按真实 TTL 失效
         └─► SCP Hub 执行面                       SCP-HUB-API-KEY 头
```

SCP-HUB-API-KEY 的换取（`src/scphub/credential.ts`）：

- `GET {moce}/apikey/list` 找本客户端当日命名（`dsh-inkstone-client-YYMMDD`，上海时区）且
  `status=active`、未过期的 key；没有则 `POST {moce}/apikey/create` 后再 list。
- 分页 **0 起始**，跟随响应的 `pages` 字段翻页——moce 全线分页都是 0 起始，`page=1` 静默返回空表，
  这是接入时踩过的真实坑。
- key 连同 `expiresAtMs` 写入凭据库（record `scp-hub/<environment>`），过期前 60s 内的调用触发
  重新换取；同一时刻的并发换取合并为单次（in-flight promise 复用）。

### 两个 base URL

SCP Hub 有两个不重合的 API 根，配置里是两个独立字段：

| 字段 | 根 | 承载 |
| --- | --- | --- |
| `scpHubApiBaseUrl` | `…/api`（平台根） | `/scphub/v1/*`：目录搜索、SCP/技能详情、下载 |
| `scpHubApiKeyBaseUrl` | `…/api/moce/v1`（moce 根） | `/apikey/*`：执行面 key 的换取 |

两者默认值由部署决定（staging/production 常量在 `src/scphub/service.ts`），可分别覆写。

## 4. 镜像挂载（运行时热重建）

本地清单（`agents` / `scps` / `skills`）是 volatile 配置字段：设置页写 → plugin-manager 重组 →
`loader/volatile-update` 事件 → 对应镜像子插件整体重建。三个镜像同构：

| 镜像 | 挂载物 | 依赖服务 |
| --- | --- | --- |
| inkstone-delegation | `subagents.registerProvider` + `subagent_a2a` 工具 | a2aRegistry, subagents, tools |
| inkstone-scp-hub（SCP 半边） | 每个启用的 SCP 一个 `dsh-mcp-client` 子插件 | scpHub, skills |
| inkstone-scp-hub（技能半边） | 每个启用的技能一次 `ctx.skills.register` | （同上） |

重建语义：先全部拆掉（dispose 列表逆序），再按当前清单重建；失败单项告警跳过，不阻塞其余项。

### mcp-client 子插件的挂载要点

```ts
const { apply, Config, inject, name } = await import('@deepseek-ai/dsh-mcp-client')
await ctx.plugin({ name, Config, apply, inject }, { transport: 'streamable-http', … })
```

- **`inject` 必须随模块一起转发**。`ctx.plugin` 的插件对象若缺了模块自带的 `inject: ['tools']`，
  子 fiber 无法读取 tools 服务，连接在重连循环里静默失败——这是 E2E 期间定位最久的一个坑。
- `failOnStartupError: false`：staging 端点抖动时不让挂载失败阻断插件激活，交给 mcp-client 自带的
  指数退避重连。
- 服务端点来自目录详情（`endpoint` 字段），静态头带 `SCP-HUB-API-KEY`；key 轮换由镜像重建覆盖
  （volatile 重建天然重走一遍换取）。

### 工具命名

`serverNameOf` 把目录名规范成 `[A-Za-z0-9_-]{1,32}`（非法即回退 `scp-<id>`），工具名最终形如
`mcp__<serverName>__<rawName>`。注意大型 SCP（上千工具）的 schema 全量进入模型上下文，
`maxToolServers`（默认 8）就是为此设的并发上限。

## 5. 技能安装的安全边界

目录技能 = SKILL.md + 可选 toolkit zip。安装路径 `skillArchive → installLocalSkill → installSkill`：

- **zip 只走中央目录**：从 EOCD 定位中央目录逐条解析，local header 只用来定位数据起点；每条的
  实际尺寸以中央目录为准（数据描述位存在时 local 尺寸为 0）。
- **解压用 `node:zlib.inflateRawSync`**（带 `maxOutputLength` 上限）。曾手写 inflate，固定
  Huffman 表漏了 256–287 号符号导致所有 deflate 流必炸——标准库即正义。
- 拒绝 zip64 条目；条目数与解压总字节各有上限（512 / 32MB）；解压结果与中央目录声明尺寸不一致
  即失败。
- **路径逃逸防护**：跳过目录条目、反斜杠、绝对路径与 `..` 段；写入前再校验目标必须落在 staging
  目录内。
- **原子安装**：先写 `.install-<uuid>` staging 目录，全部成功后 rename 到 `scp-<id>`；旧目录先
  rename 到 `.retired-<uuid>` 再删，失败路径全部清理，磁盘上不存在半成品技能。

技能注册只提交 name / description / content（SKILL.md 正文）与 `source: 'runtime'`；资源文件留在
磁盘，由 SKILL.md 里的相对路径引用，不进模型上下文。

## 6. 客户端 bundle 契约

浏览器侧产物（`lib/client.js`）必须保持 `window.__ModuleLoader__.load({ id, factory })` 的 CJS
工厂形态：模块表说明符（平台模块 + `dsh.client.inject` 清单）保留 `require`，其余内联；CSS
Modules 经 lightningcss 以 `[hash]_[local]` 内联。因此构建是两段式——tsc 先把装饰器转译成标准 JS
到 `lib/types`，tsdown 再从那里打包（rolldown 不转译标准装饰器）；tsdown 配置里的插件把
`typert.*.remote-client` 说明符重定向回 `src/client` 的物理 `.js`。

## 7. 依赖与发布

- 对 DSH 的依赖全部走 `peerDependencies`（`>=0.2.1-alpha.1`，无上界），运行时由宿主 profile 提供；
  `lib/` 构建产物随仓库提交，GitHub 分发安装不执行构建脚本。
- 测试（vitest 4.1.8 + vite 6）与类型检查对接本地 deepseek-harness 检出，`HARNESS`（vitest.config.ts）
  与 `paths`（tsconfig）指向它即可。
