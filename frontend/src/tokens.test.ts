/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('theme tokens', () => {
  // jsdom 环境下 import.meta.url 为 http scheme 且相对路径会指错目录，
  // 故以 vitest 的 cwd（frontend/）为基准读取。
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  it.each([
    '--color-surface-2',
    '--color-accent-soft',
    '--font-mono',
    '--duration-fast',
    '--duration-med',
    '--ease-standard',
  ])('defines %s', (token) => {
    expect(css).toContain(`${token}:`)
  })
})
