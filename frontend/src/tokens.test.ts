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
    '--color-line-soft',
    '--color-accent-soft',
    '--color-on-accent',
    '--color-text-faint',
    '--color-ok',
    '--color-info',
    '--font-sans',
    '--font-mono',
    '--duration-fast',
    '--duration-med',
    '--ease-standard',
    '--tracking-eyebrow',
  ])('defines %s', (token) => {
    expect(css).toContain(`${token}:`)
  })

  it('accent 为荧光 lime（深底高对比，P0）', () => {
    expect(css).toContain('--color-accent: #b8f24d')
  })

  it('语义色独立于 accent（ok / warn / bad / info）', () => {
    expect(css).toContain('--color-ok:')
    expect(css).toContain('--color-warning:')
    expect(css).toContain('--color-danger:')
    expect(css).toContain('--color-info:')
  })
})
