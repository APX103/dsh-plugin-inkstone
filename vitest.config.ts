import { defineConfig, type Plugin } from 'vitest/config'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HARNESS = '/Volumes/ssd/main_link/work/deepseek-harness'

// 扫描 harness workspace，建立 包名 → 包目录 索引。
const packageDirs = new Map<string, string>()
function scan(root: string, depth: number): void {
  if (depth === 0 || !existsSync(root)) return
  let entries: readonly string[]
  try { entries = readdirSync(root) } catch { return }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const dir = join(root, name)
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      try { packageDirs.set(JSON.parse(readFileSync(manifest, 'utf8')).name as string, dir) } catch { /* 跳过 */ }
    } else {
      scan(dir, depth - 1)
    }
  }
}
scan(join(HARNESS, 'vendor'), 1)
scan(join(HARNESS, 'packages'), 3)

/** 将 @deepseek-ai 说明符映射到 harness 源码入口（/client → src/client）。 */
function harnessSource(specifier: string): string | undefined {
  if (!specifier.startsWith('@deepseek-ai/')) return undefined
  const first = specifier.indexOf('/')
  const cut = specifier.startsWith('@') ? specifier.indexOf('/', first + 1) : first
  const [name, sub] = cut === -1 ? [specifier, ''] : [specifier.slice(0, cut), specifier.slice(cut + 1)]
  const dir = packageDirs.get(name)
  if (dir === undefined) return undefined
  const candidate = join(dir, 'src', sub)
  for (const file of [candidate + '.ts', join(candidate, 'index.ts')]) {
    if (existsSync(file)) return file
  }
  return undefined
}

// react 系列统一解析到 harness 副本，避免 jsdom 下双 React 实例。
// 测试库同样取 harness 副本（其内部 react 导入随之统一）。
const HARNESS_PNPM = join(HARNESS, 'node_modules', '.pnpm')
const harnessNodeModules: Record<string, string> = {
  '@testing-library/react': join(HARNESS_PNPM, '@testing-library+react@16.3.2_@testing-library+dom@10.4.2_@types+react-dom@18.3.7_@type_daff88022cc58198e4af56e91a2a62c5', 'node_modules', '@testing-library', 'react', 'dist', 'index.js'),
}

function harnessResolver(): Plugin {
  return {
    name: 'harness-workspace-resolver',
    enforce: 'pre',
    resolveId(source) {
      if (source in harnessNodeModules) return harnessNodeModules[source]
      return harnessSource(source) ?? null
    },
  }
}

const REACT = '/Volumes/ssd/main_link/work/deepseek-harness/node_modules/.pnpm/react@18.3.1/node_modules/react'
const REACT_DOM = '/Volumes/ssd/main_link/work/deepseek-harness/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom'
// 数组形式按序匹配；前缀规则下更具体的子路径必须排在包名之前。
const reactAliases = [
  { find: /^react-dom\/(.+)$/, replacement: `${REACT_DOM}/$1` },
  { find: /^react\/(.+)$/, replacement: `${REACT}/$1` },
  { find: 'react-dom', replacement: `${REACT_DOM}/index.js` },
  { find: 'react', replacement: `${REACT}/index.js` },
]

export default defineConfig({
  plugins: [harnessResolver()],
  resolve: { alias: reactAliases },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
  },
})
