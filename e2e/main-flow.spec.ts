// Playwright E2E 主链路（development-refinement.md §11.4「E2E（后续可选）」，M7 落地）
//
// ⚠️ 与 tools/smoke/ 的 CDP 脚本分工：CDP 冒烟（6 段 195+ 断言）继续承担全量通关
// 回归 —— 它是 M4 起的既役体系，覆盖每一章的完整剧本。本文件是 §11.4 口径的
// Playwright 落地，只锁**主链路**：
//
//   新玩家 intro → 菜单 → 进入 1-1 → 拼接命令（真实点击 + 真实键盘输入）→
//   过关结算 → 进度落 localStorage → 刷新后仍在。
//
// 与 CDP 脚本共享的领域知识（实测教训，勿删）：
//   - `startLevel` 是 async，进关必须等输入组件挂载（这里只走 ch1 的拼接模式，
//     就绪特征是 `[data-testid="command-preview"]`）；
//   - React 18 批处理下同一同步块里的两次点击会被吞一次 → 每次点击后等 UI 反馈；
//   - 结算页正文不含关卡 id，判据用「过关」+「时间线已锚定」通用文案；
//   - 真实键盘输入（Playwright 的 pressSequentially）才能暴露 readOnly 类缺陷 ——
//     这正是 §11.4 要 Playwright 的原因之一（jsdom 的 fireEvent.change 不受
//     readOnly 限制，会掩盖「玩家无法输入」类缺陷）。
//
// 运行：`pnpm e2e`（playwright.config.ts 自动起 vite dev server 与 Chromium）。

import { expect, test, type Page } from '@playwright/test'

/** 精确整文本匹配（hasText 传字符串是子串匹配，'.' 会撞 'README.md'） */
function exactText(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

/** 等待已进入关卡（拼接模式的就绪特征：命令预览 + 顶栏关卡 id） */
async function waitForLevel(page: Page, levelId: string): Promise<void> {
  await expect(page.locator('[data-testid="command-preview"]')).toBeVisible()
  await expect(page.getByText(levelId)).toBeVisible()
}

/**
 * 点一个片段按钮（复刻 cdp-client.cjs 的 clickFrag 语义）：
 *   - slot0：每组的「git」起始词 —— 组的命令由 slot1 的 data-command 决定；
 *   - slot1：子命令按钮（`data-command="git <frag>"`）；置灰时先点组内 slot0；
 *   - slot2：参数按钮（组内 `data-command="git <group>"` 且文本 === frag）。
 * ⚠️ React 18 批处理：slot0 与 slot1 不可在同一同步块点击 —— Playwright 的
 * click 自带等 stable/enabled，天然满足「等 React 提交后再点下一个」。
 */
async function clickFrag(page: Page, frag: string, group?: string): Promise<void> {
  const groupName = group ?? frag
  const slot1 = page.locator(`button[data-slot="1"][data-command="git ${frag}"]`)
  if (await slot1.count()) {
    if (await slot1.isDisabled()) {
      // 该组还没起步：先点组内 slot0（「git」），解锁 slot1
      await page.locator(`button[data-slot="0"][data-command="git ${groupName}"]`).click()
    }
    await slot1.click()
    return
  }
  // slot2（参数）依赖同组的 slot0+slot1 已就位 —— isFragmentEnabled 逐槽校验。
  // 「先拼 git add 再点 .」的次序里 slot2 的解锁要等 slot1 的提交完成，
  // Playwright 的 actionability 重试会处理；**正则精确文本匹配**（hasText 字符串
  // 是子串匹配，'.' 会撞上 'README.md'）+ 组名锚定避免点错同名参数。
  const scope = group
    ? page.locator(`button[data-slot="2"][data-command="git ${group}"]`, { hasText: exactText(frag) })
    : page.locator(`button[data-slot="2"]`, { hasText: exactText(frag) }).first()
  await scope.click()
}

/** 在后缀输入框输入文本（真实键盘事件）并执行拼好的命令 */
async function typeSuffixAndRun(page: Page, suffix: string): Promise<void> {
  const input = page.locator('[aria-label="补充命令参数，例如提交信息"]')
  if (suffix) {
    await input.click()
    // 逐键输入 —— 与 CDP Input.insertText 同级强度的真实输入
    await input.pressSequentially(suffix)
  }
  // 基线：当前命令历史段落数（waitForFunction 的增长比较用）
  const baseline = await page.evaluate(
    () => document.querySelectorAll('[data-testid="command-history"] p').length,
  )
  await page.locator('[aria-label="执行拼接的命令"]').click()
  // 命令执行完成的两种合法结局（M5b 教训）：history 增长 或 已离开关卡页（结算）。
  // ⚠️ 只等 history > 0 不够 —— 它会把第二条命令误判成「立即完成」（上一条留下
  // 的段落还在）。改为「**计数比调用前增长**」需要把基线传进来，与 cdp-client
  // 的 runCommand 同构。
  await page
    .waitForFunction(
      (baseline) =>
        !document.querySelector('[aria-label="执行拼接的命令"]') ||
        document.querySelectorAll('[data-testid="command-history"] p').length > baseline,
      baseline,
      { timeout: 15_000 },
    )
    .catch(() => {
      // 超时兜底：若命令已触发结算（面板卸载），上面第一个条件也已覆盖；
      // 仍超时说明真的卡住 —— 由后续断言给出可读的失败信息。
    })
}

test.describe('M7 主链路：intro → 1-1 通关 → 进度持久化', () => {
  test.beforeEach(async ({ page }) => {
    // 每条用例从全新存档开始（对应 CDP 段开头的 resetStorage）
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      return Promise.resolve()
    })
    await page.reload()
  })

  test('新玩家走完 intro 进菜单，1-1 拼接通关，进度落盘且刷新后仍在', async ({ page }) => {
    // ── intro：三段世界观 + 唯一出口 ──
    await expect(page.getByRole('heading', { name: 'Git 时间旅行者' })).toBeVisible()
    await expect(page.getByText('时间线管理局', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '进入时间线检修台' }).click()

    // ── 菜单：ch1 可玩，后续章锁定 ──
    await expect(page.getByTestId('progress-summary')).toBeVisible()
    await expect(page.getByTestId('hints-toggle')).toHaveAttribute('aria-pressed', 'true')
    const startCh1 = page.locator('[aria-label="直接开始 ch1-1 时间线初始化"]')
    await expect(startCh1).toBeEnabled()
    const startCh2 = page.locator('[aria-label="直接开始 ch2-1 状态感知"]')
    await expect(startCh2).toBeDisabled()

    // ── 进入 1-1（startLevel 是 async：等输入组件挂载）──
    await startCh1.click()
    await waitForLevel(page, 'ch1-1')

    // ── 拼接通关：git init → git add . → git commit -m "初始化时间线" ──
    await clickFrag(page, 'init')
    await typeSuffixAndRun(page, '')
    await expect(page.getByTestId('command-history')).toContainText('git init')

    await clickFrag(page, 'add')
    await clickFrag(page, '.', 'add')
    await typeSuffixAndRun(page, '')

    await clickFrag(page, 'commit')
    await clickFrag(page, '-m', 'commit')
    await typeSuffixAndRun(page, ' 初始化时间线')

    // ── 结算页（正文不含关卡 id —— 用通用文案判据，M2 实测教训）──
    await expect(page.getByText('时间线已锚定')).toBeVisible()
    // 得分卡（M3 结算）：final-score 文本形如「120 分」
    const finalScore = page.getByTestId('final-score')
    await expect(finalScore).toBeVisible()
    await expect(finalScore).toContainText('分')

    // ── 回菜单：1-1 记录可见 ──
    await page.getByRole('button', { name: '返回菜单' }).click()
    await expect(page.getByTestId('progress-summary')).toBeVisible()
    await expect(page.getByTestId('total-score')).not.toHaveText('0')

    // ── 进度落盘：localStorage 有关卡记录，刷新后仍在 ──
    const stored = await page.evaluate(() => localStorage.getItem('gtp:progress:v1'))
    expect(stored).not.toBeNull()
    expect(stored!).toContain('ch1-1')
    await page.reload()
    await expect(page.getByTestId('progress-summary')).toBeVisible()
    await expect(page.getByTestId('total-score')).not.toHaveText('0')
  })

  test('M7 设置开关：关闭提示后关卡内不再渲染 HintsPanel（提示扣分为 0）', async ({ page }) => {
    await page.getByRole('button', { name: '进入时间线检修台' }).click()
    await expect(page.getByTestId('hints-toggle')).toBeVisible()
    await page.getByTestId('hints-toggle').click()
    await expect(page.getByTestId('hints-toggle')).toHaveAttribute('aria-pressed', 'false')

    // 设置已落盘（gtp:settings:v1）
    const stored = await page.evaluate(() => localStorage.getItem('gtp:settings:v1'))
    expect(stored).toContain('"hintsEnabled":false')

    // 进 1-1，故意敲错命令触发失败 → 有提示可解锁的场景；面板不渲染即开关生效
    const startCh1 = page.locator('[aria-label="直接开始 ch1-1 时间线初始化"]')
    await startCh1.click()
    await waitForLevel(page, 'ch1-1')
    await clickFrag(page, 'add') // 未 init 就 add —— 会失败
    await typeSuffixAndRun(page, ' .')
    await expect(page.getByTestId('command-history')).toContainText('git add')
    // 失败次数 ≥1，但面板不存在（开关关闭）—— 提示系统被整体停用
    await expect(page.getByTestId('hints-panel')).toHaveCount(0)

    // 恢复开关（保持环境整洁）
    await page.getByRole('button', { name: '返回菜单' }).click()
    await expect(page.getByTestId('hints-toggle')).toBeVisible()
    await page.getByTestId('hints-toggle').click()
    await expect(page.getByTestId('hints-toggle')).toHaveAttribute('aria-pressed', 'true')
  })
})
