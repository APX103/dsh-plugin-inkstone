# dsh-plugin-inkstone · 端砚

[中文](README.zh.md) | English

**端砚 (Inkstone)** is a standalone [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that integrates the A2A agent registry: OpenXLab AK/SK sign-in with SSO lifecycle, registry directory browsing, and remote A2A agents delegated like native subagents.

## Install

Requires a DSH runtime with the plugin seams (`>=0.2.1-alpha.1`, currently the harness `master` source launch):

```sh
dsh plugin --profile web add github:<owner>/dsh-plugin-inkstone
```

Or from a local checkout:

```sh
dsh plugin --profile web add file:/path/to/dsh-plugin-inkstone
```

Restart the app once after installing. A **端砚 · A2A Agents** tab appears in Settings: enter the OpenXLab AK/SK (stored once, reused), the directory loads automatically, and adding an agent makes it delegatable through the `subagent_a2a` tool — roster edits persist in the profile's user layer and hot-rebuild providers without a restart.

## What is inside

- `src/a2a/` — A2A 1.0 protocol client (card probing with fallthrough, frozen-endpoint binding, SSE turn consumption, silent-turn history recovery).
- `src/registry/` — OpenXLab SSO, STS ticket exchange, MCP directory discovery, host service `ctx.a2aRegistry`.
- `src/remote/` — `a2aRegistry` Remote controller (typert) for the settings tab.
- `src/subagent/` — delegation mirror: one remote provider per enabled roster agent plus the `subagent_a2a` tool.
- `src/client/` — browser settings tab (self-mounts its Remote namespace).

## Develop

```sh
pnpm install
pnpm test     # 155 tests
pnpm build    # tsc (two-phase) + tsdown → lib/index.js + lib/client.js
```

The repo type-checks and tests against a local deepseek-harness checkout via `tsconfig.json` paths and the `vitest.config.ts` resolver — point `HARNESS` in `vitest.config.ts` at your checkout. Build artifacts under `lib/` are committed because GitHub-distributed installs must not run a build step.

## Auth modes

Registry `auth_scheme_type` maps straight onto request headers: `http` → OpenXLab SSO bearer, `token_exchange`/`orbit_jwt` → STS-exchanged ticket (real TTL honored), `none` → no credentials.
