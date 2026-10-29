# mofang Web 工作台

mofang 的 M3 前端：用 React + Vite 展示 Provider、题集、实时 3D 运行与
Episode 回放，数据来自本地 FastAPI。

## 开发

日常开发建议在仓库根用一条命令同时启动 API 与 Vite：

```bash
uv run mofang dev
```

也可以在本目录单独启动前端（API 需在 8000 运行）：

```bash
npm install
npm run dev
```

Vite 在 `http://127.0.0.1:5173` 启动，`/api` 代理到 `http://127.0.0.1:8000`
（可用 `MOFANG_API_PORT` 覆盖）。

## 构建与验证

```bash
npm run build
npm run typecheck
npm run test:run
npx playwright install chromium   # 首次运行 E2E 前
npm run e2e
```

E2E 会拉起三个进程：mock OpenAI（20129）、API（8000）、Vite（5173），
需先确保这些端口空闲。完整项目文档见 [`../README.md`](../README.md)。
