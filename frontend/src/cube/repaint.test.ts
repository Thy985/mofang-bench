import { describe, expect, it } from 'vitest'
import type { CubeState } from '../api/types'
import {
  materialIndex,
  paintForSlot,
  paintPlan,
} from './repaint'

function solved2x2(): CubeState {
  return {
    cube: '2x2',
    faces: {
      U: [['white', 'white'], ['white', 'white']],
      R: [['red', 'red'], ['red', 'red']],
      F: [['green', 'green'], ['green', 'green']],
      D: [['yellow', 'yellow'], ['yellow', 'yellow']],
      L: [['orange', 'orange'], ['orange', 'orange']],
      B: [['blue', 'blue'], ['blue', 'blue']],
    },
  }
}

const afterR: CubeState = {
  cube: '2x2',
  faces: {
    U: [['white', 'green'], ['white', 'green']],
    R: [['red', 'red'], ['red', 'red']],
    F: [['green', 'yellow'], ['green', 'yellow']],
    D: [['yellow', 'blue'], ['yellow', 'blue']],
    L: [['orange', 'orange'], ['orange', 'orange']],
    B: [['white', 'blue'], ['white', 'blue']],
  },
}

describe('repaint', () => {
  it('paints solved 2x2 corner colors', () => {
    const paints = paintPlan(solved2x2())
    expect(paints).toHaveLength(24)
    const colors = paintForSlot(paints, '1,1,1')
    expect(colors.get(materialIndex([1, 0, 0]))).toBe('red')
    expect(colors.get(materialIndex([0, 1, 0]))).toBe('white')
    expect(colors.get(materialIndex([0, 0, 1]))).toBe('green')
  })

  it('paints the state after R', () => {
    const colors = paintForSlot(paintPlan(afterR), '1,1,1')
    expect(colors.get(materialIndex([1, 0, 0]))).toBe('red')
    expect(colors.get(materialIndex([0, 1, 0]))).toBe('green')
    expect(colors.get(materialIndex([0, 0, 1]))).toBe('yellow')
  })

  it('maps all six material normals', () => {
    expect(materialIndex([1, 0, 0])).toBe(0)
    expect(materialIndex([-1, 0, 0])).toBe(1)
    expect(materialIndex([0, 1, 0])).toBe(2)
    expect(materialIndex([0, -1, 0])).toBe(3)
    expect(materialIndex([0, 0, 1])).toBe(4)
    expect(materialIndex([0, 0, -1])).toBe(5)
  })
})
