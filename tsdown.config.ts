import { defineConfig, type UserConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { basename, resolve, dirname, join } from 'node:path'
import { transform } from 'lightningcss'

const ID = 'dsh-plugin-inkstone'

/** 浏览器模块表可回答的说明符：平台预载 + 本包 dsh.client.inject 请求的包。 */
const MODULE_TABLE_EXTERNALS = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-gateway/client',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-renderer/client',
])

const CSS_VIRTUAL_PREFIX = '\0inkstone-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** 生成运行时注入 <style> 的模块（含 CSS Modules 类名映射）。 */
function styleInjectionModule(css: string, classMap: Record<string, string>): string {
  const tagId = `${ID}/A2aCard.module.css`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/** tsc 不复制既有 .js 生成物；把产物里的说明符指回 src 的物理文件。 */
function generatedArtifactRedirect(): Parameters<UserConfig['plugins']>[0][number] {
  return {
    name: 'inkstone-generated-artifact-redirect',
    resolveId(source: string, importer: string | undefined) {
      const generated = ['typert.remote-client', 'typert.scphub.remote-client']
      if (!generated.some(name => source.endsWith(name)) || importer === undefined || !importer.includes('/lib/types/')) return null
      return join(resolve(process.cwd(), 'src', 'client'), `${source.replace(/^\.\.?\//, '')}.js`)
    },
  }
}

/** CSS Modules 内联插件：编译类名（[hash]_[local]）并把样式注入工厂执行期。 */
function cssModulesInline(): Parameters<UserConfig['plugins']>[0][number] {
  return {
    name: 'inkstone-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolve(dirname(importer), source) : source
      const physical = abs.replace('/lib/types/', '/src/')
      return CSS_VIRTUAL_PREFIX + physical + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) {
        classMap[local] = exp.name
      }
      return styleInjectionModule(code.toString(), classMap)
    },
  }
}

/** 宿主半：所有裸说明符保持外部依赖（由 dsh 运行时与安装的依赖提供）。 */
const hostConfig: UserConfig = {
  name: `${ID}/host`,
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { neverBundle: (specifier: string) => !specifier.startsWith('.') && !specifier.startsWith('/') },
  outputOptions: { entryFileNames: 'index.js' },
}

/** 浏览器半：window.__ModuleLoader__.load 工厂；模块表说明符保持 require，其余内联。 */
const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  plugins: [generatedArtifactRedirect(), cssModulesInline()],
  deps: {
    neverBundle: (specifier: string) => [...MODULE_TABLE_EXTERNALS].some(entry =>
      specifier === entry || specifier.startsWith(`${entry}/`)),
    alwaysBundle: (specifier: string) => ![...MODULE_TABLE_EXTERNALS].some(entry =>
      specifier === entry || specifier.startsWith(`${entry}/`)),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: (chunk: { isEntry: boolean, fileName: string }) =>
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default defineConfig([hostConfig, clientConfig])
void basename
