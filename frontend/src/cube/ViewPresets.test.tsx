import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ViewPresets } from './ViewPresets'

describe('ViewPresets', () => {
  it('渲染四个预设按钮并回报点击', async () => {
    const user = userEvent.setup()
    const onRequest = vi.fn()
    render(<ViewPresets onRequest={onRequest} />)
    expect(screen.getByTestId('view-presets')).toHaveTextContent('正视')
    expect(screen.getByTestId('view-presets')).toHaveTextContent('顶视')
    expect(screen.getByTestId('view-presets')).toHaveTextContent('等轴')
    expect(screen.getByTestId('view-presets')).toHaveTextContent('重置')
    await user.click(screen.getByTestId('view-top'))
    expect(onRequest).toHaveBeenCalledWith('top')
  })
})
