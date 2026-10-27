import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import type { Plugin } from 'vite'
import { convertFiles } from './convert.js'
import { banner, info, ok, warn } from './log.js'

export type ToluPluginOptions = {
  input: string | string[]
  output: string
}

async function generate(root: string, options: ToluPluginOptions, quiet = false): Promise<void> {
  const patterns = Array.isArray(options.input) ? options.input : [options.input]
  const files = await fg(patterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })

  if (files.length === 0) {
    warn(`No files matched: ${patterns.join(', ')}`)
    return
  }

  files.sort()
  const start = Date.now()
  const lua = convertFiles(files)
  const outPath = path.resolve(root, options.output)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, lua, 'utf8')

  if (quiet) {
    info(`regenerated ${options.output}`)
    return
  }

  const n = files.length
  ok(`wrote ${outPath} (${n} file${n === 1 ? '' : 's'}) in ${Date.now() - start}ms`)
}

export default function tolu(options: ToluPluginOptions): Plugin {
  let root = process.cwd()

  return {
    name: 'tolu',
    configResolved(config) {
      root = config.root
    },
    async buildStart() {
      banner('generating types...')
      await generate(root, options)
    },
    async handleHotUpdate({ file }) {
      const patterns = Array.isArray(options.input) ? options.input : [options.input]
      const watched = await fg(patterns, {
        cwd: root,
        absolute: true,
        onlyFiles: true,
      })
      const normalized = path.normalize(file)
      if (!watched.some((f) => path.normalize(f) === normalized)) return

      await generate(root, options, true)
    },
  }
}
