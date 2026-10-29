import { transformAsync } from '@babel/core'
import type { Plugin } from 'vite'
import { stylexOptions } from './stylex.config.mjs'

// React plugin 6 uses Oxc. Compile StyleX before Vite transforms TypeScript.
export function stylexCompiler(): Plugin {
  return {
    name: 'stylex-compiler',
    enforce: 'pre',
    async transform(code, id) {
      if (id.includes('/node_modules/') || !/\.[jt]sx?$/.test(id) || !code.includes('@stylexjs/stylex')) return null
      const result = await transformAsync(code, {
        filename: id,
        configFile: false,
        babelrc: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: [['@stylexjs/babel-plugin', stylexOptions]],
        sourceMaps: true,
      })
      return result?.code ? { code: result.code, map: result.map ? JSON.stringify(result.map) : null } : null
    },
  }
}
