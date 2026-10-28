import { describe, expect, it } from 'vitest'
import { layerSlots, parseMove, rotateSlot } from './moves'

describe('moves', () => {
  it('parses R variants', () => {
    expect(parseMove('R', 2)).toEqual({
      face: 'R',
      amount: 1,
      axis: 0,
      sign: 1,
      layer: 1,
      turns: 3,
    })
    expect(parseMove("R'", 2).turns).toBe(1)
    expect(parseMove('R2', 2).turns).toBe(2)
  })

  it('rejects malformed moves', () => {
    expect(() => parseMove('X', 2)).toThrow('invalid move')
    expect(() => parseMove('R3', 2)).toThrow('invalid move')
  })

  it('rotates slots like the backend', () => {
    expect(rotateSlot([1, 1, 1], parseMove('R', 2))).toEqual([1, 1, -1])
    expect(rotateSlot([1, 1, 1], parseMove('U', 2))).toEqual([-1, 1, 1])
    expect(rotateSlot([-1, 1, 1], parseMove('F', 2))).toEqual([1, 1, 1])
  })

  it('selects the layer for a move', () => {
    const slots: [number, number, number][] = [
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, 1],
      [-1, 1, -1],
    ]
    expect(layerSlots(slots, parseMove('R', 2))).toEqual([
      [1, 1, 1],
      [1, 1, -1],
    ])
  })

  it('parses negative-normal faces', () => {
    expect(parseMove('L', 2)).toEqual({
      face: 'L',
      amount: 1,
      axis: 0,
      sign: -1,
      layer: -1,
      turns: 1,
    })
    expect(rotateSlot([-1, 1, 1], parseMove('L', 2))).toEqual([-1, -1, 1])
  })
})
