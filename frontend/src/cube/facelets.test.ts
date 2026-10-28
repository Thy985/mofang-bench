import { describe, expect, it } from 'vitest'
import { cubieSlots, stickerPlacement } from './facelets'

describe('facelets', () => {
  it('maps 2x2 stickers to backend coordinates', () => {
    // 与后端 geometry.py 一致：U 面 row 0 靠后、col 0 靠左。
    expect(stickerPlacement('U', 0, 0, 2).position).toEqual([-1, 1, -1])
    expect(stickerPlacement('U', 1, 0, 2).position).toEqual([-1, 1, 1])
    expect(stickerPlacement('R', 0, 0, 2).position).toEqual([1, 1, 1])
    expect(stickerPlacement('F', 0, 0, 2).position).toEqual([-1, 1, 1])
  })

  it('maps 3x3 stickers to backend coordinates', () => {
    expect(stickerPlacement('U', 0, 0, 3).position).toEqual([-2, 2, -2])
    expect(stickerPlacement('U', 2, 2, 3).position).toEqual([2, 2, 2])
    expect(stickerPlacement('R', 0, 0, 3).position).toEqual([2, 2, 2])
    expect(stickerPlacement('F', 0, 0, 3).position).toEqual([-2, 2, 2])
    expect(stickerPlacement('D', 2, 2, 3).position).toEqual([2, -2, -2])
    expect(stickerPlacement('B', 0, 0, 3).position).toEqual([2, 2, -2])
  })

  it('builds cubie slots without the 3x3 core', () => {
    expect(cubieSlots(2)).toHaveLength(8)
    expect(cubieSlots(3)).toHaveLength(26)
    expect(cubieSlots(3)).not.toContainEqual([0, 0, 0])
  })
})
