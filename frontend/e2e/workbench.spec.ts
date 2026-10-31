import { expect, test } from '@playwright/test'

test('provider → benchmark → live run → result → replay', async ({
  page,
}) => {
  await page.goto('/providers')
  await page.getByLabel('名称').fill('mock')
  await page.getByLabel('模型').fill('mock-model')
  await page
    .getByLabel('base_url')
    .fill('http://127.0.0.1:20129/v1')
  await page
    .getByLabel('API key（可选，保存后不回显）')
    .fill('test')
  await page.getByRole('button', { name: '保存 provider' }).click()
  await expect(page.getByTestId('provider-card')).toContainText('mock')
  await expect(page.getByTestId('key-configured')).toContainText(
    'key 已保存',
  )
  await page.getByRole('button', { name: '探测' }).click()
  await expect(page.getByText('支持 tool calling')).toBeVisible()

  await page.goto('/benchmarks')
  await page.getByLabel('名称').fill('e2e')
  await page.getByLabel('深度 1', { exact: true }).check()
  await page.getByLabel('每档题数').fill('1')
  await page.getByLabel('seed').fill('3')
  await page.getByRole('button', { name: '生成基准集' }).click()
  await expect(page).toHaveURL(/\/benchmarks\/e2e-2x2-3$/)
  await expect(page.getByTestId('benchmark-task-row')).toHaveCount(1)

  await page
    .getByRole('link', { name: '用此题集新建 run' })
    .click()
  await expect(page).toHaveURL(
    /\/runs\/new\?benchmark=e2e-2x2-3/,
  )
  await page.getByRole('button', { name: '启动 run' }).click()
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]+$/)
  await expect(page.getByTestId('cube-canvas')).toBeVisible()
  await expect(page.getByTestId('thinking-panel')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('log-thinking').first()).toBeVisible()

  // thinking 跟随滚动：仅在面板实际溢出且仍在流式时断言（条件断言防 flake）
  // 面板现跨 turn 常驻（spec §1），空态时 pre 不渲染，须先确认 pre 存在
  const thinkPanel = page.getByTestId('thinking-panel')
  const thinkPre = thinkPanel.locator('pre')
  if (
    (await thinkPre.count()) > 0 &&
    (await thinkPanel.isVisible()) &&
    (await thinkPre.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    ))
  ) {
    await thinkPre.evaluate((el) => {
      el.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })
    const follow = page.getByTestId('thinking-follow')
    await expect(follow).toBeVisible()
    await follow.click()
    await expect
      .poll(() =>
        thinkPre.evaluate((el) => el.scrollTop + el.clientHeight),
      )
      .toBeGreaterThanOrEqual(
        await thinkPre.evaluate((el) => el.scrollHeight - 8),
      )
  }

  await expect(page.getByTestId('run-status')).toContainText('已完成', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('run-result')).toContainText('1 / 1')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv').click(),
  ])
  expect(download.suggestedFilename()).toContain('.csv')

  await page.getByTestId('episode-replay-link').first().click()
  await expect(page.getByTestId('cube-canvas')).toBeVisible()
  // scramble 是 R'，mock 固定回 R'：R' 的四次方为单位元，要 3 步才解出，
  // 因此重放里有 3 个 apply_moves 步骤（不是 1 个）。
  await expect(
    page.getByTestId('step-row').filter({ hasText: 'apply_moves' }),
  ).toHaveCount(3)

  await page
    .getByTestId('step-row')
    .filter({ hasText: 'model_message' })
    .first()
    .click()
  const stepThinking = page.getByTestId('step-thinking')
  if (await stepThinking.count()) {
    await stepThinking.first().locator('summary').click()
    await expect(stepThinking.first()).toContainText(/./)
  }

  // —— 回放播放器：scrubber 双向联动 + 键盘步进/播放暂停 ——
  // 前面的 step-row 点击已把播放器带到 #0，先点回初始局面再断言
  await page.getByRole('button', { name: '初始局面' }).click()
  const scrubber = page.getByTestId('playback-scrubber')
  await expect(scrubber).toBeVisible()
  await expect(page.getByTestId('playback-position')).toContainText(
    '初始局面',
  )
  await scrubber.fill('1')
  await expect(page.getByTestId('playback-position')).not.toContainText(
    '初始局面',
  )
  // 拖动后焦点在 range 上，先点到中性的位置指示上再走键盘（input 聚焦被屏蔽）
  await page.getByTestId('playback-position').click()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('playback-position')).toContainText('#2')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('playback-position')).toContainText('#1')
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()
  await page.keyboard.press(' ')
  await expect(page.getByRole('button', { name: '播放' })).toBeVisible()
})
