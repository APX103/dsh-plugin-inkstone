# 端砚 · Inkstone

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![A2A](https://img.shields.io/badge/A2A-1.0-6c7ae0.svg)](https://a2a-protocol.org)

**English** | [中文](README.zh.md)

A standalone plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that brings the
A2A agent registry into your assistant: sign in once with OpenXLab AK/SK, browse the registry directory,
and delegate to remote A2A agents exactly like native subagents.

```
Settings ──端砚 tab──► AK/SK sign-in ──► directory ──► add agents ──┐
                                                                      ▼
  model ──► subagent_a2a tool ──► remote provider ──► registry A2A agents
                (contextId continuation, STS/SSO per-agent auth)
```

## Highlights

- **One install, full integration** — a settings tab appears, the `subagent_a2a` tool registers, roster
  edits persist in the profile and hot-rebuild providers without a restart.
- **Full auth coverage** — registry `auth_scheme_type` maps straight onto request headers:
  `http` → OpenXLab SSO bearer · `token_exchange` / `orbit_jwt` → STS-exchanged ticket (real TTL cached) ·
  `none` → anonymous.
- **Resilient A2A 1.0 client** — card probing with HTML-shell fallthrough, frozen-endpoint binding,
  SSE turn consumption, and history recovery for agents that answer only through `GetTask`.
- **Continuation** — delegating to the same agent again continues the same remote conversation
  (`contextId`), including outline-confirm workflows.

## Verified agents

| Registry agent | Auth | Status |
| --- | --- | --- |
| a2a-test-agent | orbit_jwt | ✅ streaming + artifacts |
| MolClaw-agent | orbit_jwt | ✅ answers via artifacts |
| ep-agent | token_exchange | ✅ |
| caicopilot-agent | http | ✅ |
| EarthLink | http | ✅ connectivity/auth; empty replies are a known staging upstream quota issue |

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
2. The directory loads automatically; pick the agents you want.
3. Ask the assistant to delegate: `subagent_a2a` appears with your roster as its `agent` enum.

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

## Package layout

| Path | Role |
| --- | --- |
| `src/a2a/` | A2A 1.0 protocol client library (no DSH dependencies) |
| `src/registry/` | OpenXLab SSO · STS exchange · MCP directory · host service `ctx.a2aRegistry` |
| `src/remote/` | `a2aRegistry` Remote controller for the settings tab |
| `src/subagent/` | Delegation mirror: providers + the `subagent_a2a` tool |
| `src/client/` | Browser settings tab (self-mounts its Remote namespace) |

## Development

```sh
pnpm install
pnpm test     # 155 tests
pnpm build    # tsc (two-phase) + tsdown → lib/index.js + lib/client.js
```

Type-checking and tests run against a local deepseek-harness checkout — point `HARNESS` in
`vitest.config.ts` (and the `paths` in `tsconfig.json`) at yours. Build artifacts under `lib/` are
committed: GitHub-distributed installs must not run build scripts.

## License

[MIT](LICENSE)
