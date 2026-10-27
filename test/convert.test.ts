import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convertFiles, convertSource } from '../src/convert.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(dir, 'fixtures')

function readExpected(): string {
  return readFileSync(path.join(fixtures, 'expected.lua'), 'utf8').replace(/\r\n/g, '\n')
}

describe('convertSource', () => {
  it('matches the example fixture', () => {
    const input = readFileSync(path.join(fixtures, 'input.ts'), 'utf8')
    expect(convertSource(input)).toBe(readExpected())
  })
})

describe('convertFiles', () => {
  it('matches the example fixture from disk', () => {
    expect(convertFiles([path.join(fixtures, 'input.ts')])).toBe(readExpected())
  })
})
