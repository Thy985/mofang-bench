# mofang

用魔方还原局面测试模型能力的本地工作台（后端核心 + CLI）。

## 快速开始

```bash
uv sync --extra dev
uv run pytest -m "not slow"
uv run mofang --help
```

3x3 求解需要额外的 GPLv3+ worker：

```bash
uv sync --extra dev --extra solver
uv run python scripts/build_3x3_tables.py   # 首次约 30 分钟 / 80MB
```

求解表生成在项目根的 `twophase/`（已 gitignore）。

## 2x2 距离表

```bash
uv run python scripts/build_2x2_table.py --max-depth 11 --out data/cache/2x2_distances.pkl
```

完整表按整体旋转归一化，恰好 3,674,160 个状态、最大距离 11；未归一化会膨胀到
88,179,840。测试与演示可先用 `--max-depth 3` 的浅表。

## 运行假 provider（验证链路）

```bash
uv run mofang benchmark --name demo --cube 2x2 --depths 1,2,3 --per-depth 2 \
  --seed 7 --table data/cache/2x2_distances.pkl --out data/benchmarks/demo-2x2.json
uv run mofang run --provider fake --benchmark data/benchmarks/demo-2x2.json \
  --table data/cache/2x2_distances.pkl --out data/reports/demo.json
```

## 真实模型

```bash
export OPENAI_API_KEY=...
uv run mofang run --provider openai --model <model> --base-url <url> \
  --api-key-env OPENAI_API_KEY --benchmark <bench.json> --out <report.json>
```

报告包含逐题状态、步数、效率、协议错误、tokens 与耗时。

3x3 使用 `--solver rubik`，预算自动按 3x3 默认值（100 步 / 15 分钟 /
150 次调用 / 1M tokens），可用 `--max-*` 覆盖：

```bash
uv run mofang run --provider openai --model <model> --solver rubik \
  --benchmark <bench3x3.json> --out <report.json>
```

## GPL 边界

`RubikTwoPhase` 是 GPLv3+。主进程不 `import twophase`；只有
`src/mofang/cube/solver_worker.py` 子进程导入它，通过 JSON lines 通信。
若未来分发本项目，需重新评估该边界与主项目许可证。
