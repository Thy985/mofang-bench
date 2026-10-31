import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CubeState, Step } from '../api/types'
import { usePlayback } from './usePlayback'

const state: CubeState = {
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

function stepFixture(overrides: Partial<Step> & { id: string; seq: number }): Step {
  return {
    kind: 'tool_result',
    tool_name: 'apply_moves',
    arguments: {},
    result: { applied: ["R'"], state },
    state,
    reference_length_after: 0,
    ...overrides,
  }
}

// 步 0/2 为无走法的思考步，步 1/3 各有一批 R'
const steps: Step[] = [
  stepFixture({
    id: 's0',
    seq: 0,
    kind: 'model_message',
    tool_name: null,
    result: { content: '想' },
  }),
  stepFixture({ id: 's1', seq: 1 }),
  stepFixture({
    id: 's2',
    seq: 2,
    kind: 'model_message',
    tool_name: null,
    result: { content: '再想' },
  }),
  stepFixture({ id: 's3', seq: 3 }),
]

describe('usePlayback', () => {
  it('初始为初始局面位', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    expect(result.current.active).toBe(-1)
    expect(result.current.playing).toBe(false)
    expect(result.current.viewState).toBe(state)
  })

  it('select 吸附该步局面且不播放', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.select(2))
    expect(result.current.active).toBe(2)
    expect(result.current.viewState).toBe(state)
    expect(result.current.batch).toBeNull()
    expect(result.current.resetToken).toBeGreaterThan(1)
  })

  it('play 从当前选中步连播，批次完成后跳过无走法步推进，末步停', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.select(1))
    act(() => result.current.play())
    expect(result.current.playing).toBe(true)
    expect(result.current.active).toBe(1)
    expect(result.current.batch?.moves).toEqual(["R'"])
    expect(result.current.viewState).toBe(state) // 起点 = stateFor(0)
    act(() => result.current.handleBatchComplete())
    expect(result.current.active).toBe(3) // 跳过无走法的步 2
    expect(result.current.batch?.moves).toEqual(["R'"])
    act(() => result.current.handleBatchComplete())
    expect(result.current.playing).toBe(false)
    expect(result.current.batch).toBeNull()
  })

  it('pause 停止连播后批次完成不再推进', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.play())
    act(() => result.current.pause())
    expect(result.current.playing).toBe(false)
    const batch = result.current.batch
    act(() => result.current.handleBatchComplete())
    expect(result.current.batch).toBe(batch)
  })

  it('stepPrev/stepNext 步进吸附不播动画，边界收敛', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => result.current.select(1))
    act(() => result.current.stepNext())
    expect(result.current.active).toBe(2)
    expect(result.current.batch).toBeNull()
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(1)
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(0)
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(-1)
    act(() => result.current.stepPrev())
    expect(result.current.active).toBe(-1)
  })

  it('键盘 ←/→ 步进、空格播放暂停；输入类聚焦时屏蔽', () => {
    const { result } = renderHook(() => usePlayback(steps, state))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(result.current.active).toBe(0)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    })
    expect(result.current.playing).toBe(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    })
    expect(result.current.playing).toBe(false)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    // 空格 play 已把 active 推进到步 1；此处断言屏蔽生效（未再步进到 2）
    expect(result.current.active).toBe(1)
    input.remove()
  })
})
