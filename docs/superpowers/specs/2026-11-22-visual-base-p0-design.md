# P0 视觉底座 设计 spec

日期：2026-11-22。依据：用户以 https://arena.modeldial.com/#/leaderboard/cube 为蓝图
提出前端升级意向。本批次只做**视觉底座**（强调色 / 造型语言 / 排版层次），
不动信息架构与页面结构（卡片化、详情页叙事层等留给 P1–P3）。

## 现状盘点（2026-11-22）

- `frontend/src/index.css` `@theme`：accent = emerald-600 `#059669`（偏暗偏沉，
  深底上对比弱）；accent-dim = emerald-700；accent-soft = rgba(5,150,105,.15)。
  语义色（warning/danger/sky 等）不收敛到 accent，豁免清单见 U1。
- 全站 accent 引用约 30 处（bg-accent / text-accent / border-accent / accent-soft
  / accent-dim / outline-accent），分布在 ui/ 原语、各页面、Layout logo、
  PhaseStepper、ResultView 等。
- `ui/Button.tsx`：primary = `bg-accent text-white hover:bg-accent-dim`，
  方正圆角，焦点态 `focus-visible:outline-accent`。
- `ui/PageHeader.tsx`：`text-2xl font-semibold` 平铺 h1 + 可选 subtitle，
  无 eyebrow / 无字号层次。
- 测试：`tokens.test.ts` 以文本断言 @theme token 存在；
  `primitives.test.tsx` 断言 Button primary 含 `bg-accent` 类（不断言色值）。
- 参考站（ModelDial 魔方站）实测要点：荧光 lime 强调色只用于 eyebrow / 主 CTA /
  选中态 / 大数字 / 徽章；斜切平行四边形（clip-path）贯穿按钮与徽章；
  每页 eyebrow（大字距小字）→ 超大粗体 H1 → 描述行三段式。

## 决策记录（三条，待用户确认）

1. **accent 换 lime，替换而非并存**：`--color-accent` = lime-400 `#a3e635`，
   `--color-accent-dim` = lime-500 `#84cc16`（hover），`--color-accent-soft` =
   `rgba(163,230,53,.14)`。新增 `--color-on-accent` = lime-950 `#1a2e05`
   （primary 按钮文字 / 深底上的前景）。全站 accent 引用零改动自动换色。
   不保留 emerald 作 accent（避免双绿）；emerald 仅留在 StatusBadge 状态语义。
2. **StatusBadge 成功态同步换 lime（P0 顺手）**：`solved` / `finished` 的
   `bg-emerald-900/60 text-emerald-300` → `bg-lime-950/60 text-lime-300`。
   理由：accent 换 lime 后若成功态仍 emerald，同一屏出现两种绿显脏；
   ModelDial 全绿系统一。若用户反对则 P0 不动 StatusBadge，留到 P4。
3. **eyebrow 三段式走兼容路线**：`PageHeader` 新增可选 `eyebrow` prop，
   有 eyebrow 时 h1 升级 `text-3xl md:text-4xl font-bold tracking-tight`，
   eyebrow 行 `text-accent text-xs font-semibold uppercase tracking-eyebrow`；
   **不传 eyebrow 的页面外观不变**，各页面文案接入放 P1（避免 P0 改 9 个页面）。

## 约束

- 后端零改动；`ui/` 原语只改 Button / PageHeader 两个文件 + index.css。
- 页面文件（pages/、components/、Layout）P0 零改动（accent 换色自动生效）。
- 色板沿用 Tailwind 既有色阶（lime），不引入新色值体系。
- 动效沿用现有 duration token；斜切无动效，`prefers-reduced-motion` 不受影响。
- 测试基线：现有前端用例全绿；最终四连
  `typecheck && test:run && build && e2e`。

## §1 index.css（@theme 与工具类）

```css
@theme {
  --color-accent: #a3e635;          /* lime-400 */
  --color-accent-dim: #84cc16;      /* lime-500，hover/按下 */
  --color-accent-soft: rgba(163, 230, 53, 0.14);
  --color-on-accent: #1a2e05;       /* lime-950，accent 底上的前景 */
  --tracking-eyebrow: 0.18em;
  /* 其余既有 token 不动 */
}

/* 斜切造型工具类（em 相对单位，随字号缩放） */
.clip-slant-r {
  clip-path: polygon(0 0, 100% 0, calc(100% - 0.55em) 100%, 0 100%);
}
.clip-slant-l {
  clip-path: polygon(0.55em 0, 100% 0, 100% 100%, 0 100%);
}
```

- 色值以 hex 直写（与现有 emerald/slate 直写风格一致），不引用 Tailwind
  lime 色板变量。

## §2 Button primary 斜切（ui/Button.tsx）

- primary variant：`bg-accent text-on-accent hover:bg-accent-dim clip-slant-r`
  （文字由 white 改 on-accent 深绿黑；圆角保留，clip 会盖住圆角，无碍）。
- 焦点态：clip-path 会裁掉 outline，primary 的焦点环改用 inset 阴影
  `focus-visible:shadow-[inset_0_0_0_2px_var(--color-canvas)]`
  （lime 底上深色内环，可见且不被裁）。其余 variant 焦点态不动。
- 决策项：斜切仅应用于 primary。secondary/ghost/danger/warning 保持方正
  （ModelDial 中次要按钮也为斜切，但工作台高频操作多，克制使用斜切可保持
  操作区秩序；如需全站斜切留 P1 复议）。

## §3 PageHeader 三段式（ui/PageHeader.tsx）

- 新 prop `eyebrow?: string`，渲染顺序：eyebrow 行 → h1 → subtitle → actions
  （保持现有 actions ml-auto / back 行为）。
- 有 eyebrow 时：eyebrow 行 `text-accent text-xs font-semibold uppercase tracking-eyebrow`
  （中文 eyebrow 时 uppercase 无副作用）；h1 `text-3xl md:text-4xl font-bold tracking-tight`。
- 无 eyebrow 时：维持现状（`text-2xl font-semibold`），保证 P0 零页面改动。

## §4 测试与验收

- **tokens.test.ts**：追加断言 `--color-on-accent`、`--tracking-eyebrow`、
  `.clip-slant-r`、`.clip-slant-l` 存在于 index.css。
- **primitives.test.tsx**：primary 断言追加 `clip-slant-r` 与 `text-on-accent`；
  现有 `bg-accent` 断言保留（token 换值不断言色值，天然兼容）。
- **PageHeader.test.tsx**：新增 eyebrow 用例（传入时 eyebrow 文本可见、h1 含
  `text-4xl`；不传时保持 `text-2xl`）。
- **StatusBadge**：若决策 2 通过，更新/新增 solved 用例断言 `text-lime-300`。
- **E2E**：现有 workbench.spec 不断言颜色，无需改；四连全绿即可。
- **视觉验收**：`uv run mofang dev` 打开 /runs，确认 accent 全站变 lime、
  primary 按钮斜切深字、焦点环可见；与参考站截图对比强调色观感。

## 验收口径

1. 全站 accent（含 Layout logo、进度条、选中态）变为荧光 lime，深底对比明显。
2. primary 按钮为斜切平行四边形、深绿黑文字，Tab 焦点环可见不被裁。
3. PageHeader 支持 eyebrow 三段式（示范页可选跑通；全面接入在 P1）。
4. 后端与页面文件零改动；新增用例全绿；四连全绿。

## 不在本批次（留 P1–P4）

- P1：各页面 eyebrow 接入 + Runs 卡片化；P2：Run 详情页叙事层（面包屑/成绩卡/
  大数字 display 档）；P3：表单页视觉统一；P4：skill/solver/计划模式徽章体系。
- 响应式/亮色主题：P0 不涉及。
