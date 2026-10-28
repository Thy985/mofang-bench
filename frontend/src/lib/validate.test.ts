import { describe, expect, it } from 'vitest'
import {
  readInteger,
  readNumberInRange,
  readPositiveInt,
  readPositiveNumber,
} from './validate'

describe('readPositiveInt', () => {
  it('parses positive integers', () => {
    expect(readPositiveInt('1')).toBe(1)
    expect(readPositiveInt('4096')).toBe(4096)
    expect(readPositiveInt(' 7 ')).toBe(7)
  })

  it('rejects blanks, non-integers and values below one', () => {
    expect(readPositiveInt('')).toBeNull()
    expect(readPositiveInt('   ')).toBeNull()
    expect(readPositiveInt('1.5')).toBeNull()
    expect(readPositiveInt('abc')).toBeNull()
    expect(readPositiveInt('0')).toBeNull()
    expect(readPositiveInt('-3')).toBeNull()
    expect(readPositiveInt('Infinity')).toBeNull()
  })
})

describe('readPositiveNumber', () => {
  it('parses positive numbers, decimals included', () => {
    expect(readPositiveNumber('1.5')).toBe(1.5)
    expect(readPositiveNumber('120')).toBe(120)
  })

  it('rejects blanks, non-positive and non-numeric values', () => {
    expect(readPositiveNumber('')).toBeNull()
    expect(readPositiveNumber('  ')).toBeNull()
    expect(readPositiveNumber('0')).toBeNull()
    expect(readPositiveNumber('-1')).toBeNull()
    expect(readPositiveNumber('abc')).toBeNull()
    expect(readPositiveNumber('Infinity')).toBeNull()
  })
})

describe('readNumberInRange', () => {
  it('parses numbers within the bounds, decimals included', () => {
    expect(readNumberInRange('0', 0, 2)).toBe(0)
    expect(readNumberInRange('0.7', 0, 2)).toBe(0.7)
    expect(readNumberInRange('2', 0, 2)).toBe(2)
  })

  it('rejects blanks, non-finite and out-of-range values', () => {
    expect(readNumberInRange('', 0, 2)).toBeNull()
    expect(readNumberInRange('   ', 0, 2)).toBeNull()
    expect(readNumberInRange('abc', 0, 2)).toBeNull()
    expect(readNumberInRange('Infinity', 0, 2)).toBeNull()
    expect(readNumberInRange('2.01', 0, 2)).toBeNull()
    expect(readNumberInRange('-0.1', 0, 2)).toBeNull()
  })
})

describe('readInteger', () => {
  it('parses any integer, zero and negatives included', () => {
    expect(readInteger('42')).toBe(42)
    expect(readInteger('0')).toBe(0)
    expect(readInteger('-7')).toBe(-7)
  })

  it('rejects blanks and non-integers', () => {
    expect(readInteger('')).toBeNull()
    expect(readInteger('   ')).toBeNull()
    expect(readInteger('1.5')).toBeNull()
    expect(readInteger('abc')).toBeNull()
  })
})
