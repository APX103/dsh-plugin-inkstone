# 端砚 · Inkstone

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![A2A](https://img.shields.io/badge/A2A-1.0-6c7ae0.svg)](https://a2a-protocol.org)

**English** | [中文](README.zh.md)

A standalone plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that brings the
A2A agent registry and the SCP Hub into your assistant: sign in once with OpenXLab AK/SK, then browse three
tabs — delegate to remote A2A agents, mount SCP Hub MCP services, and install published skills.

```
Settings ──端砚 tab──► AK/SK sign-in ──► Agent Registry ──► add agents ──┐
                                                                        ▼
  model ──► subagent_a2a tool ──► remote provider ──► registry A2A agents
                (contextId continuation, STS/SSO per-agent auth)

            ──► SCP Services ──► add SCP ──► pick tools ──► mcp__<server>__* (selected only)
            ──► Skills ──► install ──► ~/.dsh/inkstone/skills ──► runtime skill registry
```

## Highlights

- **One install, full integration** — a settings tab appears, the `subagent_a2a` tool registers, roster
  edits persist in the profile and hot-rebuild providers without a restart.
- **Agent Registry** — browse the A2A agent directory, delegate to remote agents like native subagents;
  registry `auth_scheme_type` maps straight onto request headers (SSO bearer / STS ticket / anonymous).
- **SCP Hub services** — search the SCP Hub catalog and add MCP servers; pick the individual tools you
  want in the settings page and only those register, as `mcp__<server>__*`, with the execution key
  handled automatically.
- **Skills** — install catalog skills (SKILL.md + toolkit zip) atomically under the skills root and
  register them as runtime skills; the agent sees them in their skill catalog immediately.
- **Bundled Inkstone skills** — a set of verified scientific skills ships inside the plugin (`skills/`
  directory) and registers on install; switch individual ones off in the Inkstone Skills tab, hot
  without a restart.

Design notes and verification records live in [doc/](doc/).

## Install

> Requires a DSH runtime with the plugin seams (`>=0.2.1-alpha.1`). Until that version is published,
> run DSH from the harness source checkout.

```sh
dsh plugin --profile web add github:apx103/dsh-plugin-inkstone
# or from a local checkout
dsh plugin --profile web add file:/path/to/dsh-plugin-inkstone
```

Restart the app after installing. Open **Settings → 端砚 · A2A Agents**:

1. Enter your OpenXLab AK/SK — stored once via the credentials service, token lifecycle is automatic.
2. **Agent Registry**: the directory loads automatically; pick the agents you want.
3. **SCP Services / Skills**: search the SCP Hub catalog, add servers or install skills. A newly
   added SCP mounts nothing until you open **Tools** and tick the ones you want; selections apply
   without a restart.
4. Ask the assistant to delegate: `subagent_a2a` appears with your roster as its `agent` enum, MCP
   tools arrive as `mcp__<server>__*`, installed skills join the skill catalog.

## Configuration

Roster edits from the settings tab land in the profile's user layer; the same fields can be set in
`cordis.patch.yml`:

| Field | Default | Meaning |
| --- | --- | --- |
| `registryBaseUrl` | `https://agent-registry-staging.intern-ai.org.cn` | Registry root |
| `ssoBaseUrl` | OpenXLab default | SSO gateway |
| `agents` | `[]` | Volatile roster: name / endpointUrl / authScheme / description / enabled |
| `toolName` | `subagent_a2a` | Model-facing tool name (`subagent_*` gets native subagent UI grouping) |
| `maxDepth` | `1` | Delegation depth cap |
| `scpHubApiBaseUrl` | `https://discovery-staging.intern-ai.org.cn/api` | SCP Hub platform root (catalog, details) |
| `scpHubApiKeyBaseUrl` | `https://discovery-staging.intern-ai.org.cn/api/moce/v1` | moce root for the execution API-key exchange |
| `scpHubEnvironment` | `staging` | Credential-record selector (`staging` / `production`) |
| `scps` | `[]` | Volatile SCP list: id / name / description / publisher / endpoint / enabled / selectedTools / toolNames |
| `skills` | `[]` | Volatile skill list: id / skillName / name / description / enabled |
| `disabledBuiltinSkills` | `[]` | Volatile bundled-skill names switched off (all ship enabled) |
| `skillsRoot` | `~/.dsh/inkstone/skills` | Install root for catalog skills |
| `maxToolServers` | `8` | Upper bound of concurrently mounted SCP servers |
| `maxSelectedTools` | `128` | Upper bound of selected tools registered across every server |

## Package layout

| Path | Role |
| --- | --- |
| `src/a2a/` | A2A 1.0 protocol client library (no DSH dependencies) |
| `src/registry/` | OpenXLab SSO · STS exchange · MCP directory · host service `ctx.a2aRegistry` |
| `src/remote/` | `a2aRegistry` Remote controller for the settings tab |
| `src/subagent/` | Delegation mirror: providers + the `subagent_a2a` tool |
| `src/scphub/` | SCP Hub client · API-key exchange · host service `ctx.scpHub` · `scpHub` Remote controller · mcp-client/skills mirror |
| `src/skills/` | Toolkit zip reading (central-directory walk, `node:zlib` inflate), atomic install, bundled-skill mounting |
| `skills/` | Bundled SKILL.md assets shipped with the plugin (data, not build output) |
| `src/client/` | Browser settings tab (self-mounts its Remote namespaces) |

## Development

```sh
pnpm install
pnpm test     # 179 tests
pnpm build    # tsc (two-phase) + tsdown → lib/index.js + lib/client.js
```

Type-checking and tests run against a local deepseek-harness checkout — point `HARNESS` in
`vitest.config.ts` (and the `paths` in `tsconfig.json`) at yours. Build artifacts under `lib/` are
committed: GitHub-distributed installs must not run build scripts.

## License

[MIT](LICENSE)
