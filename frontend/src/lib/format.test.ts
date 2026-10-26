import { describe, expect, it } from 'vitest'
import {
  colorHex,
  formatDuration,
  formatPercent,
  formatTokens,
  shortId,
  statusLabel,
} from './format'

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(null)).toBe('—')
  })

  it('formats percentages and tokens', () => {
    expect(formatPercent(0.5)).toBe('50.0%')
    expect(formatPercent(null)).toBe('—')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(12_500)).toBe('12.5k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })

  it('labels statuses and ids', () => {
    expect(statusLabel('budget_exceeded')).toBe('预算耗尽')
    expect(statusLabel('unknown')).toBe('unknown')
    expect(shortId('abcdef123456')).toBe('abcdef12')
  })

  it('maps colors', () => {
    expect(colorHex('white')).toBe('#f8fafc')
    expect(colorHex('orange')).toBe('#f97316')
  })
})
