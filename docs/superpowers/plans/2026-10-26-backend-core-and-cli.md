# 魔方模型能力测试台 — 后端核心与 CLI 实施计划（M0–M1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出一个可独立运行的 Python CLI：生成 2x2/3x3 魔方基准题、让模型（脚本假 provider 或 OpenAI-compatible API）通过工具逐步还原、自动判定并输出可复现的 JSON 报告。

**Architecture:** 纯 Python 核心（`src/mofang`）分为 cube（状态/走法/求解器）、tasks（题集生成）、models（provider 协议）、runner（工具循环/预算/上下文）、eval（评分聚合）、cli 六层。服务端状态为唯一真相源，模型只能通过工具改变状态。3x3 求解器 `RubikTwoPhase`（GPLv3+）放在独立子进程 worker 中，主进程不 import，避免 GPL 传染；2x2 用 BFS 精确距离表。本计划不包含 Web API 与前端，它们属于 Plan 2。

**Tech Stack:** Python 3.12.13、uv 0.12.7、pydantic 2.x、httpx、pytest、pytest-asyncio、hypothesis、respx；可选 `RubikTwoPhase>=1.1.1`（仅 3x3 求解 worker 使用）。

**Spec:** `docs/superpowers/specs/2026-10-26-rubiks-cube-model-bench-design.md`

## Global Constraints

- Python `>=3.12`，包管理只用 `uv`；项目内依赖装进 `.venv`，不装全局。
- 只支持 2x2 与 3x3；状态对外用 JSON 六面矩阵，颜色用全名（white/yellow/green/blue/red/orange），面序 U/R/F/D/L/B。
- 模型只看到当前局面与走法历史，**绝不**看到打乱序列、参照解、距离。
- 2x2 参照长度用精确最优；3x3 用 RubikTwoPhase 近优解，报告中标注 `near_optimal`。
- 主进程不得 `import twophase`；GPL 代码只在 `solver_worker.py` 子进程中运行。
- 密钥只从环境变量读取；不写日志、不进报告、不落库。
- 默认预算：2x2 30 步/5 分钟/50 次工具调用/300k tokens；3x3 100 步/15 分钟/150 次工具调用/1M tokens；单轮超时 120s。
- 所有随机题集必须种子化、可复现；同一基准集内不得有重复状态。
- MVP 只支持原生 tool calling；不支持工具的模型明确报错，不做文本协议回退。
- 项目文档与注释用中文；代码标识符用英文。
- 每个任务结束必须本地 commit；不 push。

---

### Task 0: 项目脚手架、Project Passport 与冒烟测试

**Files:**
- Create: `pyproject.toml`
- Create: `.gitignore`
- Create: `README.md`
- Create: `PROJECT-PASSPORT.md`
- Create: `src/mofang/__init__.py`
- Test: `tests/test_smoke.py`

**Interfaces:**
- Consumes: 无
- Produces: `mofang.__version__ == "0.1.0"`；可运行的 `uv run pytest`；本地 git 仓库。

- [ ] **Step 1: 写 `pyproject.toml`**

```toml
[project]
name = "mofang"
version = "0.1.0"
description = "Rubik's cube model capability test bench"
requires-python = ">=3.12"
dependencies = [
  "httpx>=0.27,<1",
  "pydantic>=2.9,<3",
]

[project.optional-dependencies]
dev = [
  "hypothesis>=6.112",
  "pytest>=8.3",
  "pytest-asyncio>=0.24",
  "respx>=0.21",
]
solver = [
  "RubikTwoPhase>=1.1.1",
]

[project.scripts]
mofang = "mofang.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/mofang"]

[tool.pytest.ini_options]
pythonpath = ["src"]
asyncio_mode = "auto"
markers = [
  "slow: requires generated solver tables or live network",
]
```

- [ ] **Step 2: 写 `.gitignore`、`README.md`、`PROJECT-PASSPORT.md`**

`.gitignore`：

```gitignore
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.env
data/cache/
dist/
build/
*.egg-info/
```

`README.md` 至少包含：

```markdown
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
```

`PROJECT-PASSPORT.md` 必须记录：Python/uv/Node/Git 版本、项目依赖、启动命令、数据目录 `data/cache/` 与 `data/benchmarks/`、3x3 表构建方式、GPL 隔离边界、端口（本计划无服务端口；Plan 2 使用 8000/5173）。内容用中文。

- [ ] **Step 3: 写失败测试 `tests/test_smoke.py`**

```python
import mofang


def test_version() -> None:
    assert mofang.__version__ == "0.1.0"
```

- [ ] **Step 4: 运行测试确认失败**

Run: `uv sync --extra dev && uv run pytest tests/test_smoke.py -v`

Expected: FAIL，`ModuleNotFoundError: No module named 'mofang'` 或 `ImportError`。

- [ ] **Step 5: 写最小实现 `src/mofang/__init__.py`**

```python
__version__ = "0.1.0"
```

- [ ] **Step 6: 运行测试确认通过**

Run: `uv run pytest tests/test_smoke.py -v`

Expected: PASS。

- [ ] **Step 7: 初始化 git 并提交**

```bash
git init
git add pyproject.toml .gitignore README.md PROJECT-PASSPORT.md src/mofang/__init__.py tests/test_smoke.py
git commit -m "chore: 初始化项目骨架与护照"
```

---

### Task 1: 颜色、状态 JSON、解出判定

**Files:**
- Create: `src/mofang/cube/__init__.py`（空文件）
- Create: `src/mofang/cube/colors.py`
- Create: `src/mofang/cube/state.py`
- Test: `tests/cube/test_state.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `Color`（StrEnum，值 `white/yellow/green/blue/red/orange`）
  - `FACE_ORDER = ("U","R","F","D","L","B")`
  - `CubeState(size: int, faces: tuple[Grid, ...])`
  - `CubeState.solved(size) -> CubeState`
  - `CubeState.face(name) -> Grid`
  - `CubeState.is_solved() -> bool`
  - `CubeState.key() -> str`
  - `CubeState.to_json() -> dict`
  - `CubeState.from_json(data) -> CubeState`

- [ ] **Step 1: 写失败测试 `tests/cube/test_state.py`**

```python
import pytest

from mofang.cube.colors import Color
from mofang.cube.state import CubeState


@pytest.mark.parametrize("size", [2, 3])
def test_solved_state(size: int) -> None:
    state = CubeState.solved(size)
    assert state.is_solved()
    assert len(state.key()) == 6 * size * size


def test_json_round_trip() -> None:
    state = CubeState.solved(3)
    assert CubeState.from_json(state.to_json()) == state


def test_json_has_color_names() -> None:
    data = CubeState.solved(2).to_json()
    assert data["cube"] == "2x2"
    assert data["faces"]["U"][0][0] == "white"


def test_wrong_color_count_is_rejected() -> None:
    data = CubeState.solved(2).to_json()
    data["faces"]["U"][0][0] = "yellow"
    with pytest.raises(ValueError):
        CubeState.from_json(data)


def test_wrong_face_set_is_rejected() -> None:
    data = CubeState.solved(2).to_json()
    del data["faces"]["B"]
    with pytest.raises(ValueError):
        CubeState.from_json(data)


def test_is_solved_requires_face_colors() -> None:
    state = CubeState.solved(2)
    assert state.face("U") == ((Color.WHITE, Color.WHITE), (Color.WHITE, Color.WHITE))
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/cube/test_state.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `colors.py`**

```python
from enum import StrEnum


class Color(StrEnum):
    WHITE = "white"
    YELLOW = "yellow"
    GREEN = "green"
    BLUE = "blue"
    RED = "red"
    ORANGE = "orange"


FACE_ORDER: tuple[str, ...] = ("U", "R", "F", "D", "L", "B")

FACE_COLOR: dict[str, Color] = {
    "U": Color.WHITE,
    "R": Color.RED,
    "F": Color.GREEN,
    "D": Color.YELLOW,
    "L": Color.ORANGE,
    "B": Color.BLUE,
}

_COLOR_INITIAL = {
    Color.WHITE: "W",
    Color.YELLOW: "Y",
    Color.GREEN: "G",
    Color.BLUE: "B",
    Color.RED: "R",
    Color.ORANGE: "O",
}
```

- [ ] **Step 4: 实现 `state.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .colors import _COLOR_INITIAL, FACE_COLOR, FACE_ORDER, Color

Grid = tuple[tuple[Color, ...], ...]


@dataclass(frozen=True)
class CubeState:
    size: int
    faces: tuple[Grid, ...]

    def __post_init__(self) -> None:
        if self.size not in (2, 3):
            raise ValueError("size must be 2 or 3")
        if len(self.faces) != 6:
            raise ValueError("expected exactly 6 faces")
        for grid in self.faces:
            if len(grid) != self.size or any(len(row) != self.size for row in grid):
                raise ValueError("each face must be size x size")
            if any(not isinstance(color, Color) for row in grid for color in row):
                raise ValueError("face cells must be Color")
        counts = {color: 0 for color in Color}
        for grid in self.faces:
            for row in grid:
                for color in row:
                    counts[color] += 1
        expected = self.size * self.size
        for color, count in counts.items():
            if count != expected:
                raise ValueError(
                    f"color {color.value} appears {count} times, expected {expected}"
                )

    @classmethod
    def solved(cls, size: int) -> "CubeState":
        faces = tuple(
            tuple(
                tuple(FACE_COLOR[name] for _ in range(size))
                for _ in range(size)
            )
            for name in FACE_ORDER
        )
        return cls(size=size, faces=faces)

    def face(self, name: str) -> Grid:
        return self.faces[FACE_ORDER.index(name)]

    def is_solved(self) -> bool:
        for name, grid in zip(FACE_ORDER, self.faces):
            expected = FACE_COLOR[name]
            if any(color != expected for row in grid for color in row):
                return False
        return True

    def key(self) -> str:
        return "".join(
            _COLOR_INITIAL[color] for grid in self.faces for row in grid for color in row
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "cube": f"{self.size}x{self.size}",
            "faces": {
                name: [[color.value for color in row] for row in grid]
                for name, grid in zip(FACE_ORDER, self.faces)
            },
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "CubeState":
        cube = data.get("cube")
        if cube not in ("2x2", "3x3"):
            raise ValueError("cube must be '2x2' or '3x3'")
        size = int(cube[0])
        faces_data = data.get("faces")
        if not isinstance(faces_data, dict) or set(faces_data) != set(FACE_ORDER):
            raise ValueError("faces must contain exactly U,R,F,D,L,B")
        faces: list[Grid] = []
        for name in FACE_ORDER:
            grid_data = faces_data[name]
            if not isinstance(grid_data, list) or len(grid_data) != size:
                raise ValueError(f"face {name} must have {size} rows")
            grid: list[tuple[Color, ...]] = []
            for row in grid_data:
                if not isinstance(row, list) or len(row) != size:
                    raise ValueError(f"face {name} rows must have {size} cells")
                grid.append(tuple(Color(cell) for cell in row))
            faces.append(tuple(grid))
        return cls(size=size, faces=tuple(faces))
```

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/cube/test_state.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/mofang/cube tests/cube/test_state.py
git commit -m "feat: 魔方颜色与状态 JSON"
```

---

### Task 2: 面转几何引擎、走法解析与逆操作

**Files:**
- Create: `src/mofang/cube/geometry.py`
- Create: `src/mofang/cube/moves.py`
- Test: `tests/cube/test_moves.py`

**Interfaces:**
- Consumes: `CubeState`, `FACE_ORDER`
- Produces:
  - `move_permutation(size, face, amount) -> tuple[int, ...]`
  - `sticker_geometry(face, row, col, size) -> (pos, normal)`
  - `position_to_sticker(pos, normal, size) -> (face, row, col)`
  - `turn(state, face, amount) -> CubeState`
  - `parse_move(move) -> (face, amount)`
  - `apply_moves(state, moves) -> CubeState`
  - `invert_moves(moves) -> list[str]`
  - `format_move(face, amount) -> str`
  - `InvalidMove`

- [ ] **Step 1: 写失败测试 `tests/cube/test_moves.py`**

```python
import pytest
from hypothesis import given, strategies as st

from mofang.cube.geometry import move_permutation, position_to_sticker, sticker_geometry
from mofang.cube.moves import (
    InvalidMove,
    apply_moves,
    format_move,
    invert_moves,
    parse_move,
    turn,
)
from mofang.cube.state import CubeState

FACES = ["U", "R", "F", "D", "L", "B"]


@pytest.mark.parametrize("size", [2, 3])
@pytest.mark.parametrize("face", FACES)
def test_face_turn_order_four(size: int, face: str) -> None:
    state = CubeState.solved(size)
    for _ in range(4):
        state = turn(state, face, 1)
    assert state.is_solved()


@pytest.mark.parametrize("size", [2, 3])
@pytest.mark.parametrize("face", FACES)
@pytest.mark.parametrize("amount", [1, 2, 3])
def test_permutation_is_bijection(size: int, face: str, amount: int) -> None:
    perm = move_permutation(size, face, amount)
    assert sorted(perm) == list(range(6 * size * size))


@pytest.mark.parametrize("size", [2, 3])
def test_geometry_round_trip(size: int) -> None:
    for face in FACES:
        for row in range(size):
            for col in range(size):
                pos, normal = sticker_geometry(face, row, col, size)
                assert position_to_sticker(pos, normal, size) == (face, row, col)


def test_turn_and_inverse() -> None:
    moves = ["R", "U", "F'", "D2"]
    state = apply_moves(CubeState.solved(3), moves)
    assert apply_moves(state, invert_moves(moves)).is_solved()


def test_apply_moves_does_not_mutate() -> None:
    state = CubeState.solved(3)
    apply_moves(state, ["R"])
    assert state.is_solved()


def test_invalid_move() -> None:
    with pytest.raises(InvalidMove):
        apply_moves(CubeState.solved(3), ["M"])


def test_parse_move_variants() -> None:
    assert parse_move("R") == ("R", 1)
    assert parse_move("R'") == ("R", 3)
    assert parse_move("R\u2019") == ("R", 3)
    assert parse_move("R2") == ("R", 2)
    assert format_move("R", 3) == "R'"


@pytest.mark.parametrize("size,expected", [(2, 8), (3, 12)])
def test_turn_changes_expected_sticker_count(size: int, expected: int) -> None:
    before = CubeState.solved(size)
    after = turn(before, "R", 1)
    changed = sum(
        a != b
        for ga, gb in zip(before.faces, after.faces)
        for ra, rb in zip(ga, gb)
        for a, b in zip(ra, rb)
    )
    assert changed == expected


@given(st.lists(st.sampled_from(["U", "R", "F", "D", "L", "B", "U'", "R2"]), min_size=1, max_size=8))
def test_random_sequence_inverse(moves: list[str]) -> None:
    state = apply_moves(CubeState.solved(3), moves)
    assert apply_moves(state, invert_moves(moves)).is_solved()
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/cube/test_moves.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `geometry.py`**

```python
from __future__ import annotations

from functools import lru_cache

from .colors import FACE_ORDER

Vec = tuple[int, int, int]

FACE_FRAME: dict[str, tuple[Vec, Vec, Vec]] = {
    "U": ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    "R": ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    "F": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    "D": ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    "L": ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    "B": ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
}


def coord(index: int, size: int) -> int:
    return 2 * index - (size - 1)


def coord_index(value: int, size: int) -> int:
    return (value + (size - 1)) // 2


def dot(a: Vec, b: Vec) -> int:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def sticker_geometry(face: str, row: int, col: int, size: int) -> tuple[Vec, Vec]:
    normal, right, up = FACE_FRAME[face]
    pos = (
        normal[0] * (size - 1) + right[0] * coord(col, size) + up[0] * coord(row, size),
        normal[1] * (size - 1) + right[1] * coord(col, size) + up[1] * coord(row, size),
        normal[2] * (size - 1) + right[2] * coord(col, size) + up[2] * coord(row, size),
    )
    return pos, normal


def rotate(v: Vec, axis: int, quarter_turns: int) -> Vec:
    x, y, z = v
    for _ in range(quarter_turns % 4):
        if axis == 0:
            y, z = -z, y
        elif axis == 1:
            x, z = z, -x
        else:
            x, y = -y, x
    return (x, y, z)


def normal_to_face(normal: Vec) -> str:
    for face, (candidate, _, _) in FACE_FRAME.items():
        if candidate == normal:
            return face
    raise ValueError(f"invalid normal: {normal}")


def position_to_sticker(pos: Vec, normal: Vec, size: int) -> tuple[str, int, int]:
    face = normal_to_face(normal)
    _, right, up = FACE_FRAME[face]
    col = coord_index(dot(pos, right), size)
    row = coord_index(dot(pos, up), size)
    if not (0 <= row < size and 0 <= col < size):
        raise ValueError(f"sticker out of range: {pos} {normal}")
    return face, row, col


def sticker_index(face: str, row: int, col: int, size: int) -> int:
    return FACE_ORDER.index(face) * size * size + row * size + col


@lru_cache(maxsize=None)
def move_permutation(size: int, face: str, amount: int) -> tuple[int, ...]:
    if face not in FACE_FRAME:
        raise ValueError(f"invalid face: {face}")
    if amount not in (1, 2, 3):
        raise ValueError(f"invalid amount: {amount}")
    normal, _, _ = FACE_FRAME[face]
    axis = next(i for i, value in enumerate(normal) if value != 0)
    sign = normal[axis]
    turns = (-sign * amount) % 4
    total = 6 * size * size
    perm = [-1] * total
    for source_face in FACE_ORDER:
        for row in range(size):
            for col in range(size):
                pos, n = sticker_geometry(source_face, row, col, size)
                if pos[axis] == sign * (size - 1):
                    new_pos, new_n = rotate(pos, axis, turns), rotate(n, axis, turns)
                else:
                    new_pos, new_n = pos, n
                target_face, target_row, target_col = position_to_sticker(new_pos, new_n, size)
                target = sticker_index(target_face, target_row, target_col, size)
                source = sticker_index(source_face, row, col, size)
                perm[target] = source
    if any(value < 0 for value in perm) or len(set(perm)) != total:
        raise RuntimeError(f"invalid permutation for {size} {face} {amount}")
    return tuple(perm)
```

- [ ] **Step 4: 实现 `moves.py`**

```python
from __future__ import annotations

import re

from .colors import FACE_ORDER
from .geometry import move_permutation
from .state import CubeState


class InvalidMove(ValueError):
    pass


_MOVE_RE = re.compile(r"^([URFDLB])([2']?)$")
_TRANSLATE = str.maketrans({"\u2019": "'", "\u2032": "'"})
_AMOUNT_SUFFIX = {1: "", 2: "2", 3: "'"}


def format_move(face: str, amount: int) -> str:
    if face not in FACE_ORDER or amount not in (1, 2, 3):
        raise InvalidMove(f"invalid move: {face} {amount}")
    return f"{face}{_AMOUNT_SUFFIX[amount]}"


def parse_move(move: str) -> tuple[str, int]:
    text = move.strip().translate(_TRANSLATE)
    match = _MOVE_RE.fullmatch(text)
    if not match:
        raise InvalidMove(f"invalid move: {move!r}")
    face, suffix = match.groups()
    amount = 2 if suffix == "2" else 3 if suffix == "'" else 1
    return face, amount


def turn(state: CubeState, face: str, amount: int) -> CubeState:
    if face not in FACE_ORDER:
        raise InvalidMove(f"invalid face: {face!r}")
    if amount not in (1, 2, 3):
        raise InvalidMove(f"invalid amount: {amount!r}")
    perm = move_permutation(state.size, face, amount)
    flat = [color for grid in state.faces for row in grid for color in row]
    new_flat: list = [None] * len(flat)
    for target, source in enumerate(perm):
        new_flat[target] = flat[source]
    size = state.size
    faces = []
    cursor = 0
    for _ in range(6):
        grid = []
        for _ in range(size):
            grid.append(tuple(new_flat[cursor : cursor + size]))
            cursor += size
        faces.append(tuple(grid))
    return CubeState(size=size, faces=tuple(faces))


def apply_moves(state: CubeState, moves: list[str]) -> CubeState:
    current = state
    for move in moves:
        face, amount = parse_move(move)
        current = turn(current, face, amount)
    return current


def invert_moves(moves: list[str]) -> list[str]:
    result: list[str] = []
    for move in reversed(moves):
        face, amount = parse_move(move)
        inverse = {1: 3, 2: 2, 3: 1}[amount]
        result.append(format_move(face, inverse))
    return result
```

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/cube/test_moves.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/mofang/cube/geometry.py src/mofang/cube/moves.py tests/cube/test_moves.py
git commit -m "feat: 面转几何引擎与走法协议"
```

---

### Task 3: 种子化打乱

**Files:**
- Create: `src/mofang/cube/scramble.py`
- Test: `tests/cube/test_scramble.py`

**Interfaces:**
- Consumes: `FACE_ORDER`
- Produces: `generate_scramble(size, depth, rng) -> list[str]`

- [ ] **Step 1: 写失败测试 `tests/cube/test_scramble.py`**

```python
import random

import pytest

from mofang.cube.moves import apply_moves, invert_moves
from mofang.cube.scramble import generate_scramble
from mofang.cube.state import CubeState


@pytest.mark.parametrize("size", [2, 3])
def test_scramble_length_and_faces(size: int) -> None:
    moves = generate_scramble(size, 10, random.Random(42))
    assert len(moves) == 10
    for previous, current in zip(moves, moves[1:]):
        assert previous[0] != current[0]


def test_scramble_is_deterministic() -> None:
    a = generate_scramble(3, 8, random.Random(7))
    b = generate_scramble(3, 8, random.Random(7))
    assert a == b


def test_scramble_inverse_solves() -> None:
    moves = generate_scramble(3, 12, random.Random(1))
    state = apply_moves(CubeState.solved(3), moves)
    assert not state.is_solved()
    assert apply_moves(state, invert_moves(moves)).is_solved()
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/cube/test_scramble.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `scramble.py`**

```python
from __future__ import annotations

import random

from .colors import FACE_ORDER
from .moves import format_move


def generate_scramble(size: int, depth: int, rng: random.Random | None = None) -> list[str]:
    if size not in (2, 3):
        raise ValueError("size must be 2 or 3")
    if depth < 0:
        raise ValueError("depth must be >= 0")
    generator = rng or random.Random()
    moves: list[str] = []
    previous_face: str | None = None
    for _ in range(depth):
        choices = [face for face in FACE_ORDER if face != previous_face]
        face = generator.choice(choices)
        amount = generator.choice((1, 2, 3))
        moves.append(format_move(face, amount))
        previous_face = face
    return moves
```

- [ ] **Step 4: 运行测试确认通过**

Run: `uv run pytest tests/cube/test_scramble.py -v`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/mofang/cube/scramble.py tests/cube/test_scramble.py
git commit -m "feat: 种子化打乱生成"
```

---

### Task 4: 2x2 精确距离表与最优解

**Files:**
- Create: `src/mofang/cube/table2x2.py`
- Create: `src/mofang/cube/solver.py`（先定义 Protocol 与 FakeSolver；3x3 client 在 Task 5 补）
- Create: `scripts/build_2x2_table.py`
- Test: `tests/cube/test_table2x2.py`

**Interfaces:**
- Consumes: `move_permutation`, `turn`, `CubeState`
- Produces:
  - `build_table(max_depth=11) -> dict[bytes, int]`
  - `state_key_2x2(state) -> bytes`
  - `canonical_key_from_key(key, size=2) -> bytes`
  - `Table2x2Solver(table)` with `distance(state) -> int | None`、`solve(state) -> list[str]`、`reference_kind = "exact"`
  - `ReferenceSolver` Protocol
  - `FakeSolver`

> **实测修正（2026-10-26）**：固定面色标签的 BFS 在 depth 7 已达 680 万状态，全空间是 88,179,840，与 spec 的 3,674,160 不符。实际实现改为**按整体旋转归一化**：把白红绿参考角固定到 UFR 且白色朝 U，BFS 每次转移后重新规范化。新增 `whole_rotation_permutation()` / `whole_rotations()` 与 `canonical_key_from_key()`；完整 2x2 表应恰好 3,674,160 状态、最大距离 11。下方 Step 3/4 的固定标签代码仅保留设计意图，执行以实际代码与测试为准。

- [ ] **Step 1: 写失败测试 `tests/cube/test_table2x2.py`**

```python
import pytest

from mofang.cube.moves import apply_moves, turn
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table, state_key_2x2


@pytest.fixture(scope="module")
def small_table() -> dict[bytes, int]:
    return build_table(max_depth=3)


def test_solved_distance_is_zero(small_table: dict[bytes, int]) -> None:
    solver = Table2x2Solver(small_table)
    assert solver.distance(CubeState.solved(2)) == 0


def test_one_move_distance_is_one(small_table: dict[bytes, int]) -> None:
    solver = Table2x2Solver(small_table)
    state = turn(CubeState.solved(2), "R", 1)
    assert solver.distance(state) == 1
    assert solver.solve(state) == ["R'"]


def test_solve_returns_optimal_sequence(small_table: dict[bytes, int]) -> None:
    solver = Table2x2Solver(small_table)
    state = apply_moves(CubeState.solved(2), ["R", "U", "F"])
    solution = solver.solve(state)
    assert len(solution) <= 3
    assert apply_moves(state, solution).is_solved()


def test_state_key_is_stable() -> None:
    state = CubeState.solved(2)
    assert state_key_2x2(state) == state_key_2x2(state)
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/cube/test_table2x2.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `solver.py` 的 Protocol 与 FakeSolver**

```python
from __future__ import annotations

from typing import Protocol

from .state import CubeState


class SolverError(RuntimeError):
    pass


class ReferenceSolver(Protocol):
    reference_kind: str

    def solve(self, state: CubeState) -> list[str]: ...

    def distance(self, state: CubeState) -> int | None: ...


class FakeSolver:
    reference_kind = "fake"

    def __init__(
        self,
        distances: dict[str, int] | None = None,
        solutions: dict[str, list[str]] | None = None,
    ) -> None:
        self.distances = distances or {}
        self.solutions = solutions or {}

    def distance(self, state: CubeState) -> int | None:
        return self.distances.get(state.key())

    def solve(self, state: CubeState) -> list[str]:
        try:
            return list(self.solutions[state.key()])
        except KeyError as exc:
            raise SolverError("no fake solution for state") from exc
```

- [ ] **Step 4: 实现 `table2x2.py`**

```python
from __future__ import annotations

import pickle
from pathlib import Path

from .colors import FACE_COLOR, FACE_ORDER, Color
from .geometry import move_permutation
from .moves import format_move, turn
from .state import CubeState

_COLOR_INDEX = {color: index for index, color in enumerate(Color)}
_MOVES = tuple((face, amount) for face in FACE_ORDER for amount in (1, 2, 3))


def state_key_2x2(state: CubeState) -> bytes:
    if state.size != 2:
        raise ValueError("2x2 state required")
    return bytes(
        _COLOR_INDEX[color]
        for grid in state.faces
        for row in grid
        for color in row
    )


def _solved_key() -> bytes:
    return bytes(
        _COLOR_INDEX[FACE_COLOR[face]]
        for face in FACE_ORDER
        for _ in range(4)
    )


def _apply_perm(key: bytes, perm: tuple[int, ...]) -> bytes:
    return bytes(key[source] for source in perm)


def build_table(max_depth: int = 11) -> dict[bytes, int]:
    solved = _solved_key()
    perms = [move_permutation(2, face, amount) for face, amount in _MOVES]
    distances: dict[bytes, int] = {solved: 0}
    frontier = [solved]
    depth = 0
    while frontier and depth < max_depth:
        depth += 1
        next_frontier: list[bytes] = []
        for key in frontier:
            for perm in perms:
                neighbor = _apply_perm(key, perm)
                if neighbor not in distances:
                    distances[neighbor] = depth
                    next_frontier.append(neighbor)
        frontier = next_frontier
        print(f"2x2 depth {depth}: {len(distances)} states", flush=True)
    return distances


def save_table(table: dict[bytes, int], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        pickle.dump(table, handle, protocol=pickle.HIGHEST_PROTOCOL)


def load_table(path: Path) -> dict[bytes, int]:
    with path.open("rb") as handle:
        return pickle.load(handle)


class Table2x2Solver:
    reference_kind = "exact"

    def __init__(self, table: dict[bytes, int]) -> None:
        self.table = table

    def distance(self, state: CubeState) -> int | None:
        return self.table.get(state_key_2x2(state))

    def solve(self, state: CubeState) -> list[str]:
        current = state
        remaining = self.distance(current)
        if remaining is None:
            raise ValueError("state is not in the 2x2 distance table")
        moves: list[str] = []
        while remaining > 0:
            for face in FACE_ORDER:
                for amount in (1, 2, 3):
                    neighbor = turn(current, face, amount)
                    neighbor_distance = self.distance(neighbor)
                    if neighbor_distance == remaining - 1:
                        moves.append(format_move(face, amount))
                        current = neighbor
                        remaining = neighbor_distance
                        break
                else:
                    continue
                break
            else:
                raise RuntimeError("no distance-decreasing move")
        return moves
```

- [ ] **Step 5: 实现 `scripts/build_2x2_table.py`**

```python
from __future__ import annotations

import argparse
import time
from pathlib import Path

from mofang.cube.table2x2 import build_table, save_table


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-depth", type=int, default=11)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/cache/2x2_distances.pkl"),
    )
    args = parser.parse_args()
    started = time.time()
    table = build_table(args.max_depth)
    save_table(table, args.out)
    print(
        f"wrote {len(table)} states to {args.out} "
        f"in {time.time() - started:.1f}s",
        flush=True,
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 运行测试确认通过**

Run: `uv run pytest tests/cube/test_table2x2.py -v`

Expected: PASS（`max_depth=3` 的表很小；全表构建另跑脚本）。

- [ ] **Step 7: 提交**

```bash
git add src/mofang/cube/solver.py src/mofang/cube/table2x2.py scripts/build_2x2_table.py tests/cube/test_table2x2.py
git commit -m "feat: 2x2 精确距离表与最优解"
```

---

### Task 5: 3x3 求解器子进程（GPL 隔离）

**Files:**
- Create: `src/mofang/cube/solver_worker.py`
- Modify: `src/mofang/cube/solver.py`
- Create: `scripts/build_3x3_tables.py`
- Test: `tests/cube/test_solver_3x3.py`

**Interfaces:**
- Consumes: `CubeState`, `ReferenceSolver`
- Produces:
  - `facelets_3x3(state) -> str`
  - `RubikTwoPhaseClient` with `solve(state) -> list[str]`、`distance(state) -> int | None`、`close()`
  - worker JSON line 协议：输入 `{"facelets": "..."}`，输出 `{"ok": true, "moves": [...], "length": n}`

- [ ] **Step 1: 写失败测试 `tests/cube/test_solver_3x3.py`**

```python
from mofang.cube.moves import apply_moves
from mofang.cube.solver import facelets_3x3
from mofang.cube.state import CubeState


def test_solved_facelets() -> None:
    assert facelets_3x3(CubeState.solved(3)) == (
        "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
    )


def test_facelets_after_one_move() -> None:
    state = apply_moves(CubeState.solved(3), ["R"])
    value = facelets_3x3(state)
    assert len(value) == 54
    assert value.count("U") == 9
    assert value.count("R") == 9
    assert value != facelets_3x3(CubeState.solved(3))
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/cube/test_solver_3x3.py -v`

Expected: FAIL，`ImportError`。

- [ ] **Step 3: 在 `src/mofang/cube/solver.py` 追加 `facelets_3x3` 与 `RubikTwoPhaseClient`**

```python
import json
import subprocess
import sys

from .colors import FACE_COLOR, FACE_ORDER


def facelets_3x3(state: CubeState) -> str:
    if state.size != 3:
        raise ValueError("3x3 state required")
    letter = {FACE_COLOR[face]: face for face in FACE_ORDER}
    return "".join(
        letter[color] for grid in state.faces for row in grid for color in row
    )


class RubikTwoPhaseClient:
    reference_kind = "near_optimal"

    def __init__(self, python: str | None = None) -> None:
        self._process = subprocess.Popen(
            [python or sys.executable, "-m", "mofang.cube.solver_worker"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def _request(self, payload: dict) -> dict:
        if self._process.stdin is None or self._process.stdout is None:
            raise SolverError("solver worker is not running")
        self._process.stdin.write(json.dumps(payload) + "\n")
        self._process.stdin.flush()
        line = self._process.stdout.readline()
        if not line:
            stderr = self._process.stderr.read() if self._process.stderr else ""
            raise SolverError(f"solver worker exited: {stderr}")
        return json.loads(line)

    def solve(self, state: CubeState) -> list[str]:
        response = self._request({"facelets": facelets_3x3(state)})
        if not response.get("ok"):
            raise SolverError(str(response.get("error", "solver error")))
        return list(response["moves"])

    def distance(self, state: CubeState) -> int | None:
        try:
            return len(self.solve(state))
        except SolverError:
            return None

    def close(self) -> None:
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()

    def __enter__(self) -> "RubikTwoPhaseClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
```

- [ ] **Step 4: 实现 `solver_worker.py`（GPL 边界文件）**

```python
"""GPL boundary: imports RubikTwoPhase (GPLv3+).

The main backend talks to this process over JSON lines and never imports
twophase itself. Keep this file free of project imports.
"""
from __future__ import annotations

import json
import sys


def parse_result(result: str) -> tuple[list[str], int]:
    text = result.strip()
    if not text:
        return [], 0
    tokens = text.split()
    if tokens[0].startswith("Error"):
        raise RuntimeError(text)
    if tokens[-1].startswith("("):
        tokens = tokens[:-1]
    return tokens, len(tokens)


def main() -> None:
    import twophase.solver as solver

    for line in sys.stdin:
        try:
            request = json.loads(line)
            result = solver.solve(request["facelets"], 20, 10)
            moves, length = parse_result(result)
            print(
                json.dumps({"ok": True, "moves": moves, "length": length}),
                flush=True,
            )
        except Exception as exc:  # worker must stay alive for the next request
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: 实现 `scripts/build_3x3_tables.py`**

```python
from __future__ import annotations

SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"


def main() -> None:
    import twophase.solver as solver

    print("Generating RubikTwoPhase tables (about 30 minutes, ~80 MB)...")
    print(solver.solve(SOLVED, 20, 10))
    print("done")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 运行非 slow 测试确认通过**

Run: `uv run pytest tests/cube/test_solver_3x3.py -v`

Expected: PASS（仅测 facelets，不启动 worker）。

- [ ] **Step 7: 加 slow 集成测试并手动验证 3x3 worker**

在 `tests/cube/test_solver_3x3.py` 追加：

```python
import pytest

from mofang.cube.solver import RubikTwoPhaseClient


@pytest.mark.slow
def test_rubik_two_phase_solves() -> None:
    client = RubikTwoPhaseClient()
    try:
        state = apply_moves(CubeState.solved(3), ["R", "U", "F'"])
        solution = client.solve(state)
        assert apply_moves(state, solution).is_solved()
    finally:
        client.close()
```

手动执行（首次会生成表，约 30 分钟）：

```bash
uv sync --extra dev --extra solver
uv run python scripts/build_3x3_tables.py
uv run pytest tests/cube/test_solver_3x3.py::test_rubik_two_phase_solves -v -m slow
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/mofang/cube/solver.py src/mofang/cube/solver_worker.py scripts/build_3x3_tables.py tests/cube/test_solver_3x3.py
git commit -m "feat: 3x3 求解器子进程与 GPL 边界"
```

---

### Task 6: 题目与基准集模型、生成器

**Files:**
- Create: `src/mofang/tasks/__init__.py`（空文件）
- Create: `src/mofang/tasks/models.py`
- Create: `src/mofang/tasks/generator.py`
- Test: `tests/tasks/test_generator.py`

**Interfaces:**
- Consumes: `ReferenceSolver`, `generate_scramble`, `apply_moves`, `CubeState`
- Produces:
  - `Task`（Pydantic）
  - `Benchmark` with `compute_hash()`、`save(path)`、`load(path)`
  - `bin_for_length(length) -> str`
  - `generate_benchmark(name, cube, depths, per_depth, seed, solver) -> Benchmark`

- [ ] **Step 1: 写失败测试 `tests/tasks/test_generator.py`**

```python
import pytest

from mofang.cube.solver import FakeSolver
from mofang.tasks.generator import bin_for_length, generate_benchmark
from mofang.tasks.models import Benchmark


def test_bin_for_length() -> None:
    assert bin_for_length(1) == "1"
    assert bin_for_length(4) == "4-5"
    assert bin_for_length(7) == "6-10"
    assert bin_for_length(18) == "11-20"


def test_generate_is_reproducible() -> None:
    solver = FakeSolver()
    solver.distance = lambda state: 3  # type: ignore[method-assign]
    first = generate_benchmark(
        name="demo", cube="2x2", depths=[1, 2], per_depth=2, seed=42, solver=solver
    )
    second = generate_benchmark(
        name="demo", cube="2x2", depths=[1, 2], per_depth=2, seed=42, solver=solver
    )
    assert [task.state for task in first.tasks] == [task.state for task in second.tasks]
    assert len(first.tasks) == 4


def test_generate_has_no_duplicate_states() -> None:
    solver = FakeSolver()
    solver.distance = lambda state: 2  # type: ignore[method-assign]
    benchmark = generate_benchmark(
        name="demo", cube="2x2", depths=[1, 2, 3], per_depth=3, seed=7, solver=solver
    )
    keys = [str(task.state) for task in benchmark.tasks]
    assert len(keys) == len(set(keys))


def test_benchmark_hash_and_round_trip(tmp_path) -> None:
    solver = FakeSolver()
    solver.distance = lambda state: 1  # type: ignore[method-assign]
    benchmark = generate_benchmark(
        name="demo", cube="2x2", depths=[1], per_depth=1, seed=1, solver=solver
    )
    path = tmp_path / "bench.json"
    benchmark.save(path)
    loaded = Benchmark.load(path)
    assert loaded.content_hash == benchmark.content_hash
    assert loaded.tasks == benchmark.tasks
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/tasks/test_generator.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `models.py`**

```python
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


class Task(BaseModel):
    id: str
    cube: Literal["2x2", "3x3"]
    scramble: list[str]
    scramble_depth: int
    state: dict[str, Any]
    reference_length: int
    reference_kind: Literal["exact", "near_optimal", "fake"]
    bin: str


class Benchmark(BaseModel):
    id: str
    name: str
    version: str = "v1"
    cube: Literal["2x2", "3x3"]
    kind: Literal["frozen", "random"] = "frozen"
    tasks: list[Task]
    content_hash: str = ""
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def compute_hash(self) -> str:
        payload = self.model_dump(exclude={"content_hash", "created_at"})
        raw = json.dumps(
            payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def save(self, path: Path) -> None:
        self.content_hash = self.compute_hash()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: Path) -> "Benchmark":
        return cls.model_validate_json(path.read_text(encoding="utf-8"))
```

- [ ] **Step 4: 实现 `generator.py`**

```python
from __future__ import annotations

import random

from ..cube.moves import apply_moves
from ..cube.scramble import generate_scramble
from ..cube.solver import ReferenceSolver
from ..cube.state import CubeState
from .models import Benchmark, Task


def bin_for_length(length: int) -> str:
    if length <= 3:
        return str(length)
    if length <= 5:
        return "4-5"
    if length <= 10:
        return "6-10"
    return "11-20"


def generate_benchmark(
    *,
    name: str,
    cube: str,
    depths: list[int],
    per_depth: int,
    seed: int,
    solver: ReferenceSolver,
) -> Benchmark:
    if cube not in ("2x2", "3x3"):
        raise ValueError("cube must be 2x2 or 3x3")
    size = 2 if cube == "2x2" else 3
    rng = random.Random(seed)
    tasks: list[Task] = []
    seen: set[str] = set()
    for depth in depths:
        created = 0
        attempts = 0
        while created < per_depth and attempts < per_depth * 200:
            attempts += 1
            scramble = generate_scramble(size, depth, rng)
            state = apply_moves(CubeState.solved(size), scramble)
            if state.is_solved():
                continue
            key = state.key()
            if key in seen:
                continue
            length = solver.distance(state)
            if length is None:
                continue
            seen.add(key)
            created += 1
            tasks.append(
                Task(
                    id=f"{cube}-{depth}-{created}",
                    cube=cube,
                    scramble=scramble,
                    scramble_depth=depth,
                    state=state.to_json(),
                    reference_length=length,
                    reference_kind=solver.reference_kind,
                    bin=bin_for_length(length),
                )
            )
        if created < per_depth:
            raise RuntimeError(
                f"could not generate {per_depth} unique tasks at depth {depth}"
            )
    return Benchmark(
        id=f"{name}-{cube}-{seed}",
        name=name,
        cube=cube,
        tasks=tasks,
    )
```

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/tasks/test_generator.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/mofang/tasks tests/tasks/test_generator.py
git commit -m "feat: 基准题模型与生成器"
```

---

### Task 7: 工具协议与执行器

**Files:**
- Create: `src/mofang/runner/__init__.py`（空文件）
- Create: `src/mofang/runner/budget.py`
- Create: `src/mofang/runner/tools.py`
- Test: `tests/runner/test_tools.py`

**Interfaces:**
- Consumes: `CubeState`, `turn`, `apply_moves`, `parse_move`, `format_move`
- Produces:
  - `Budget`（dataclass）
  - `TOOLS`（OpenAI function schema 列表）
  - `ToolOutcome`
  - `ToolExecutor(state, max_moves, max_tool_calls)` with `execute(name, arguments)`、`state`、`moves_used`、`tool_calls`、`invalid_calls`、`protocol_errors`

- [ ] **Step 1: 写失败测试 `tests/runner/test_tools.py`**

```python
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.runner.tools import ToolExecutor


def test_turn_applies_and_reports_state() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("turn", {"face": "R", "amount": 1})
    assert outcome.ok
    assert outcome.payload["moves_used"] == 1
    assert outcome.payload["state"]["cube"] == "2x2"
    assert not outcome.payload["solved"]


def test_turn_inverse_solves() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    executor.execute("turn", {"face": "R", "amount": 1})
    outcome = executor.execute("turn", {"face": "R", "amount": 3})
    assert outcome.ok
    assert outcome.payload["solved"] is True


def test_apply_moves_is_atomic() -> None:
    executor = ToolExecutor(CubeState.solved(3), max_moves=100, max_tool_calls=150)
    before = executor.state
    outcome = executor.execute("apply_moves", {"moves": ["R", "M"]})
    assert not outcome.ok
    assert outcome.payload["error"] == "invalid_move"
    assert executor.state == before
    assert executor.protocol_errors == 1


def test_apply_moves_sequence() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("apply_moves", {"moves": ["R", "U'"]})
    assert outcome.ok
    assert outcome.payload["moves_used"] == 2


def test_get_state_and_check_solved() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    assert executor.execute("get_state", {}).payload["moves_used"] == 0
    assert executor.execute("check_solved", {}).payload["solved"] is True


def test_invalid_arguments_are_protocol_errors() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("turn", {"face": "X", "amount": 1})
    assert not outcome.ok
    assert outcome.payload["error"] == "invalid_face"
    assert executor.protocol_errors == 1


def test_move_budget() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=1, max_tool_calls=50)
    assert executor.execute("turn", {"face": "R", "amount": 1}).ok
    outcome = executor.execute("turn", {"face": "U", "amount": 1})
    assert not outcome.ok
    assert outcome.payload["error"] == "budget_exceeded"


def test_unknown_tool() -> None:
    executor = ToolExecutor(CubeState.solved(2), max_moves=30, max_tool_calls=50)
    outcome = executor.execute("solve_it", {})
    assert not outcome.ok
    assert outcome.payload["error"] == "unknown_tool"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/runner/test_tools.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `budget.py`**

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Budget:
    max_moves: int = 100
    max_tool_calls: int = 150
    max_tokens: int = 1_000_000
    max_seconds: float = 900.0
    turn_timeout: float = 120.0
    max_usd: float | None = None
```

- [ ] **Step 4: 实现 `tools.py`**

```python
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from ..cube.colors import FACE_ORDER
from ..cube.moves import InvalidMove, apply_moves, format_move, parse_move, turn
from ..cube.state import CubeState

MAX_BATCH_MOVES = 30

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "turn",
            "description": (
                "Rotate one face. amount 1 = clockwise 90 degrees, "
                "2 = 180 degrees, 3 = counterclockwise 90 degrees "
                "(viewed from outside that face). Returns the new state."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "face": {"type": "string", "enum": list(FACE_ORDER)},
                    "amount": {"type": "integer", "enum": [1, 2, 3]},
                },
                "required": ["face", "amount"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_moves",
            "description": (
                "Apply a batch of standard cube moves atomically, e.g. "
                "['R', \"U'\", 'F2']. If any move is invalid, none are applied. "
                f"Maximum {MAX_BATCH_MOVES} moves per call."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "moves": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": MAX_BATCH_MOVES,
                    }
                },
                "required": ["moves"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_state",
            "description": "Return the current cube state, solved flag, moves used and remaining budget.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_solved",
            "description": "Return whether the cube is currently solved.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
]

_PROTOCOL_ERRORS = {
    "invalid_face",
    "invalid_amount",
    "invalid_move",
    "invalid_arguments",
    "unknown_tool",
    "too_many_moves",
}


@dataclass
class ToolOutcome:
    ok: bool
    payload: dict[str, Any]
    protocol_error: bool = False
    budget_exhausted: bool = False
    applied: list[str] = field(default_factory=list)


class ToolExecutor:
    def __init__(self, state: CubeState, max_moves: int = 100, max_tool_calls: int = 150) -> None:
        self.state = state
        self.max_moves = max_moves
        self.max_tool_calls = max_tool_calls
        self.moves_used = 0
        self.tool_calls = 0
        self.invalid_calls = 0
        self.protocol_errors = 0

    def execute(self, name: str, arguments: dict[str, Any] | None) -> ToolOutcome:
        self.tool_calls += 1
        if self.tool_calls > self.max_tool_calls:
            return self._error("budget_exceeded", "tool call budget exhausted", budget=True)
        if arguments is None:
            return self._error("invalid_arguments", "could not parse tool arguments")
        if name == "turn":
            return self._turn(arguments)
        if name == "apply_moves":
            return self._apply_moves(arguments)
        if name == "get_state":
            return self._get_state()
        if name == "check_solved":
            return self._check_solved()
        return self._error("unknown_tool", f"unknown tool: {name}")

    def _turn(self, arguments: dict[str, Any]) -> ToolOutcome:
        face = arguments.get("face")
        amount = arguments.get("amount")
        if face not in FACE_ORDER:
            return self._error("invalid_face", f"invalid face: {face!r}")
        if amount not in (1, 2, 3):
            return self._error("invalid_amount", f"invalid amount: {amount!r}")
        if self.moves_used + 1 > self.max_moves:
            return self._error("budget_exceeded", "move budget exhausted", budget=True)
        self.state = turn(self.state, face, amount)
        self.moves_used += 1
        move = format_move(face, amount)
        return self._ok({"applied": [move]}, applied=[move])

    def _apply_moves(self, arguments: dict[str, Any]) -> ToolOutcome:
        moves = arguments.get("moves")
        if not isinstance(moves, list) or any(not isinstance(move, str) for move in moves):
            return self._error("invalid_arguments", "moves must be a list of strings")
        if len(moves) > MAX_BATCH_MOVES:
            return self._error("too_many_moves", f"at most {MAX_BATCH_MOVES} moves per call")
        try:
            for move in moves:
                parse_move(move)
        except InvalidMove as exc:
            return self._error("invalid_move", str(exc))
        if self.moves_used + len(moves) > self.max_moves:
            return self._error("budget_exceeded", "move budget exhausted", budget=True)
        self.state = apply_moves(self.state, moves)
        self.moves_used += len(moves)
        return self._ok({"applied": list(moves)}, applied=list(moves))

    def _get_state(self) -> ToolOutcome:
        return self._ok({})

    def _check_solved(self) -> ToolOutcome:
        return ToolOutcome(
            ok=True,
            payload={
                "ok": True,
                "solved": self.state.is_solved(),
                "moves_used": self.moves_used,
                "moves_remaining": self.max_moves - self.moves_used,
            },
        )

    def _ok(self, extra: dict[str, Any], applied: list[str] | None = None) -> ToolOutcome:
        payload = {
            "ok": True,
            "state": self.state.to_json(),
            "solved": self.state.is_solved(),
            "moves_used": self.moves_used,
            "moves_remaining": self.max_moves - self.moves_used,
        }
        payload.update(extra)
        return ToolOutcome(ok=True, payload=payload, applied=applied or [])

    def _error(self, code: str, detail: str, budget: bool = False) -> ToolOutcome:
        protocol = code in _PROTOCOL_ERRORS
        if protocol:
            self.invalid_calls += 1
            self.protocol_errors += 1
        return ToolOutcome(
            ok=False,
            payload={
                "ok": False,
                "error": code,
                "detail": detail,
                "state": self.state.to_json(),
                "moves_used": self.moves_used,
                "moves_remaining": self.max_moves - self.moves_used,
            },
            protocol_error=protocol,
            budget_exhausted=budget,
        )


def serialize_tool_result(outcome: ToolOutcome) -> str:
    return json.dumps(outcome.payload, ensure_ascii=False)
```

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/runner/test_tools.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/mofang/runner tests/runner/test_tools.py
git commit -m "feat: 魔方工具协议与执行器"
```

---

### Task 8: Provider 协议、假 provider 与上下文构建

**Files:**
- Create: `src/mofang/models/__init__.py`（空文件）
- Create: `src/mofang/models/provider.py`
- Create: `src/mofang/runner/context.py`
- Test: `tests/runner/test_context.py`

**Interfaces:**
- Consumes: `Task`, `TOOLS`
- Produces:
  - `ToolCall`、`ModelTurn`、`Usage`、`ModelParams`、`ProviderError`、`ProviderAdapter`、`FakeProvider`
  - `ContextBuilder(system, task_message, keep_turns=6)` with `build(state_json, move_history, records, nudge=None)`
  - `TurnRecord(assistant, tool_results)`
  - `system_prompt()`、`task_message(budget)`

- [ ] **Step 1: 写失败测试 `tests/runner/test_context.py`**

```python
from mofang.runner.context import ContextBuilder, TurnRecord, task_message


def test_first_message_is_bounded() -> None:
    builder = ContextBuilder(system="SYS", task=task_message(100))
    messages = builder.build(
        state_json={"cube": "2x2", "faces": {}},
        move_history=[],
        records=[],
    )
    assert messages[0] == {"role": "system", "content": "SYS"}
    assert messages[1]["role"] == "user"
    assert messages[-1]["role"] == "user"
    assert "当前局面" in messages[-1]["content"]


def test_keeps_only_recent_turns() -> None:
    builder = ContextBuilder(system="SYS", task=task_message(100), keep_turns=2)
    records = [
        TurnRecord(
            assistant={"role": "assistant", "content": f"a{i}", "tool_calls": []},
            tool_results=[{"role": "tool", "tool_call_id": f"t{i}", "content": "{}"}],
        )
        for i in range(5)
    ]
    messages = builder.build(
        state_json={"cube": "2x2", "faces": {}},
        move_history=["R", "U"],
        records=records,
    )
    contents = [message.get("content") for message in messages]
    assert "a3" in contents
    assert "a4" in contents
    assert "a0" not in contents


def test_move_history_in_state_message() -> None:
    builder = ContextBuilder(system="SYS", task=task_message(100))
    messages = builder.build(
        state_json={"cube": "2x2", "faces": {}},
        move_history=["R", "U'"],
        records=[],
    )
    assert "R U'" in messages[-1]["content"]
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/runner/test_context.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `provider.py`**

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] | None
    raw_arguments: str = ""


@dataclass
class ModelTurn:
    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    raw: dict[str, Any] = field(default_factory=dict)
    finish_reason: str | None = None


@dataclass
class ModelParams:
    temperature: float = 0.0
    max_tokens: int = 4096
    extra: dict[str, Any] = field(default_factory=dict)


class ProviderError(RuntimeError):
    def __init__(self, kind: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable


class ProviderAdapter(Protocol):
    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        params: ModelParams,
    ) -> ModelTurn: ...

    async def probe_tools(self) -> bool: ...


class FakeProvider:
    def __init__(self, turns: Sequence[ModelTurn]) -> None:
        self._turns = list(turns)
        self.calls: list[list[dict[str, Any]]] = []

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        params: ModelParams,
    ) -> ModelTurn:
        self.calls.append(list(messages))
        if not self._turns:
            raise ProviderError("fake_exhausted", "fake provider has no more turns")
        return self._turns.pop(0)

    async def probe_tools(self) -> bool:
        return True
```

- [ ] **Step 4: 实现 `context.py`**

```python
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TurnRecord:
    assistant: dict[str, Any]
    tool_results: list[dict[str, Any]] = field(default_factory=list)


def system_prompt() -> str:
    return (
        "你是被评测的魔方操作者。目标是把当前魔方还原到六面同色。"
        "你只能通过提供的工具操作魔方；每次操作后工具会返回最新状态。"
        "不要猜，不要使用外部求解器。按需调用 get_state 或 check_solved。"
        "当魔方已解出时停止调用工具。"
    )


def task_message(max_moves: int) -> str:
    return (
        f"任务：用不超过 {max_moves} 步还原魔方。"
        "标准记法：U/R/F/D/L/B，后缀 ' 表示逆时针 90°，2 表示 180°。"
        "只使用工具；不要输出无法执行的计划。"
    )


class ContextBuilder:
    def __init__(self, system: str, task: str, keep_turns: int = 6) -> None:
        self.system = system
        self.task = task
        self.keep_turns = keep_turns

    def build(
        self,
        state_json: dict[str, Any],
        move_history: list[str],
        records: list[TurnRecord],
        nudge: str | None = None,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system},
            {"role": "user", "content": self.task},
        ]
        for record in records[-self.keep_turns :]:
            messages.append(record.assistant)
            messages.extend(record.tool_results)
        state_text = (
            "当前局面（JSON）：\n"
            + json.dumps(state_json, ensure_ascii=False, separators=(",", ":"))
            + "\n已完成走法："
            + (" ".join(move_history) if move_history else "无")
        )
        messages.append({"role": "user", "content": state_text})
        if nudge:
            messages.append({"role": "user", "content": nudge})
        return messages
```

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/runner/test_context.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/mofang/models src/mofang/runner/context.py tests/runner/test_context.py
git commit -m "feat: provider 协议与上下文构建"
```

---

### Task 9: Episode Runner 与评分

**Files:**
- Create: `src/mofang/eval/__init__.py`（空文件）
- Create: `src/mofang/eval/scorer.py`
- Create: `src/mofang/runner/episode.py`
- Test: `tests/runner/test_episode.py`

**Interfaces:**
- Consumes: `Task`、`ProviderAdapter`、`ReferenceSolver`、`Budget`、`ToolExecutor`、`ContextBuilder`
- Produces:
  - `EpisodeStatus`
  - `StepRecord`
  - `EpisodeResult`
  - `EpisodeRunner.run(task, emit=None) -> EpisodeResult`
  - `score_progress(start_length, final_length, solved) -> float`

- [ ] **Step 1: 写失败测试 `tests/runner/test_episode.py`**

```python
import asyncio

import pytest

from mofang.cube.moves import apply_moves, invert_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table, state_key_2x2
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall
from mofang.runner.budget import Budget
from mofang.runner.episode import EpisodeRunner, EpisodeStatus
from mofang.tasks.models import Task


@pytest.fixture(scope="module")
def table_solver() -> Table2x2Solver:
    return Table2x2Solver(build_table(max_depth=3))


def make_task(solver: Table2x2Solver, moves: list[str]) -> Task:
    state = apply_moves(CubeState.solved(2), moves)
    return Task(
        id="t1",
        cube="2x2",
        scramble=moves,
        scramble_depth=len(moves),
        state=state.to_json(),
        reference_length=solver.distance(state) or 999,
        reference_kind="exact",
        bin="test",
    )


def test_solves_one_move_task(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    solution = invert_moves(task.scramble)
    provider = FakeProvider(
        [
            ModelTurn(tool_calls=[ToolCall(id="c1", name="apply_moves", arguments={"moves": solution})]),
            ModelTurn(content="done"),
        ]
    )
    result = asyncio.run(
        EpisodeRunner(provider=provider, solver=table_solver, budget=Budget(max_moves=10)).run(task)
    )
    assert result.status == EpisodeStatus.SOLVED
    assert result.solved
    assert result.moves_used == 1


def test_stops_when_model_gives_up(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    provider = FakeProvider([ModelTurn(content="I cannot solve it") for _ in range(3)])
    result = asyncio.run(
        EpisodeRunner(provider=provider, solver=table_solver, budget=Budget(max_moves=10)).run(task)
    )
    assert result.status == EpisodeStatus.STOPPED_UNSOLVED


def test_budget_exceeded(table_solver: Table2x2Solver) -> None:
    task = make_task(table_solver, ["R"])
    turns = [
        ModelTurn(tool_calls=[ToolCall(id=f"c{i}", name="turn", arguments={"face": "U", "amount": 1})])
        for i in range(5)
    ]
    result = asyncio.run(
        EpisodeRunner(provider=FakeProvider(turns), solver=table_solver, budget=Budget(max_moves=2)).run(task)
    )
    assert result.status == EpisodeStatus.BUDGET_EXCEEDED
    assert result.moves_used == 2
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/runner/test_episode.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `eval/scorer.py`**

```python
from __future__ import annotations

from math import sqrt


def score_progress(start_length: int, final_length: int | None, solved: bool) -> float:
    if solved:
        return 1.0
    if start_length <= 0:
        return 0.0
    if final_length is None:
        return 0.0
    value = (start_length - final_length) / start_length
    return max(0.0, min(1.0, value))


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    if total == 0:
        return (0.0, 0.0)
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return (max(0.0, center - margin), min(1.0, center + margin))
```

- [ ] **Step 4: 实现 `runner/episode.py`**

```python
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable

from ..cube.solver import ReferenceSolver
from ..cube.state import CubeState
from ..eval.scorer import score_progress
from ..models.provider import ModelParams, ProviderAdapter, ProviderError, ToolCall
from ..tasks.models import Task
from .budget import Budget
from .context import ContextBuilder, TurnRecord, system_prompt, task_message
from .tools import TOOLS, ToolExecutor, serialize_tool_result


class EpisodeStatus(StrEnum):
    SOLVED = "solved"
    STOPPED_UNSOLVED = "stopped_unsolved"
    BUDGET_EXCEEDED = "budget_exceeded"
    TIMEOUT = "timeout"
    PROTOCOL_ERROR = "protocol_error"
    PROVIDER_ERROR = "provider_error"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


@dataclass
class StepRecord:
    seq: int
    kind: str
    tool_name: str | None = None
    arguments: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    state: dict[str, Any] | None = None
    reference_length_after: int | None = None


@dataclass
class EpisodeResult:
    status: EpisodeStatus
    solved: bool
    moves_used: int
    reference_length: int
    efficiency: float | None
    progress_ratio: float
    invalid_calls: int
    protocol_errors: int
    tokens_in: int
    tokens_out: int
    latency_ms: int
    final_state: dict[str, Any]
    failure_code: str | None
    steps: list[StepRecord] = field(default_factory=list)


class EpisodeRunner:
    MAX_PROTOCOL_ERRORS = 5
    MAX_TOOL_CALLS_PER_TURN = 5
    MAX_NUDGES = 2

    def __init__(
        self,
        provider: ProviderAdapter,
        solver: ReferenceSolver,
        budget: Budget,
        params: ModelParams | None = None,
    ) -> None:
        self.provider = provider
        self.solver = solver
        self.budget = budget
        self.params = params or ModelParams()

    async def run(
        self,
        task: Task,
        emit: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> EpisodeResult:
        started = time.monotonic()
        initial = CubeState.from_json(task.state)
        executor = ToolExecutor(initial, self.budget.max_moves, self.budget.max_tool_calls)
        builder = ContextBuilder(system_prompt(), task_message(self.budget.max_moves))
        records: list[TurnRecord] = []
        move_history: list[str] = []
        steps: list[StepRecord] = []
        tokens_in = tokens_out = 0
        nudges = 0
        status = EpisodeStatus.STOPPED_UNSOLVED
        start_length = self.solver.distance(initial) or task.reference_length
        final_state = initial
        nudge: str | None = None

        def notify(kind: str, payload: dict[str, Any]) -> None:
            if emit is not None:
                emit(kind, payload)

        while True:
            if time.monotonic() - started > self.budget.max_seconds:
                status = EpisodeStatus.TIMEOUT
                break
            messages = builder.build(
                executor.state.to_json(), move_history, records, nudge=nudge
            )
            nudge = None
            notify("model.turn.started", {"moves_used": executor.moves_used})
            try:
                turn = await asyncio.wait_for(
                    self.provider.chat(messages, TOOLS, self.params),
                    timeout=self.budget.turn_timeout,
                )
            except asyncio.TimeoutError:
                status = EpisodeStatus.TIMEOUT
                break
            except ProviderError:
                status = EpisodeStatus.PROVIDER_ERROR
                break
            tokens_in += turn.usage.prompt_tokens
            tokens_out += turn.usage.completion_tokens
            if tokens_in + tokens_out > self.budget.max_tokens:
                status = EpisodeStatus.BUDGET_EXCEEDED
                break
            notify("model.message", {"content": turn.content, "tool_calls": len(turn.tool_calls)})
            assistant: dict[str, Any] = {"role": "assistant", "content": turn.content or ""}
            if turn.tool_calls:
                assistant["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": call.raw_arguments or json.dumps(call.arguments or {}),
                        },
                    }
                    for call in turn.tool_calls
                ]
                record = TurnRecord(assistant=assistant)
                records.append(record)
                calls = turn.tool_calls[: self.MAX_TOOL_CALLS_PER_TURN]
                overflow = turn.tool_calls[self.MAX_TOOL_CALLS_PER_TURN :]
                for call in calls:
                    outcome = executor.execute(call.name, call.arguments)
                    record.tool_results.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": serialize_tool_result(outcome),
                        }
                    )
                    if outcome.applied:
                        move_history.extend(outcome.applied)
                    length_after = self.solver.distance(executor.state)
                    steps.append(
                        StepRecord(
                            seq=len(steps),
                            kind="tool",
                            tool_name=call.name,
                            arguments=call.arguments,
                            result=outcome.payload,
                            state=executor.state.to_json(),
                            reference_length_after=length_after,
                        )
                    )
                    notify("move.applied", {"payload": outcome.payload})
                    if executor.state.is_solved():
                        status = EpisodeStatus.SOLVED
                        break
                    if outcome.budget_exhausted or executor.moves_used >= self.budget.max_moves:
                        status = EpisodeStatus.BUDGET_EXCEEDED
                        break
                    if executor.protocol_errors >= self.MAX_PROTOCOL_ERRORS:
                        status = EpisodeStatus.PROTOCOL_ERROR
                        break
                if overflow:
                    executor.protocol_errors += len(overflow)
                if status in (EpisodeStatus.SOLVED, EpisodeStatus.BUDGET_EXCEEDED, EpisodeStatus.PROTOCOL_ERROR):
                    break
                if executor.state.is_solved():
                    status = EpisodeStatus.SOLVED
                    break
                if executor.protocol_errors >= self.MAX_PROTOCOL_ERRORS:
                    status = EpisodeStatus.PROTOCOL_ERROR
                    break
            else:
                records.append(TurnRecord(assistant=assistant))
                if executor.state.is_solved():
                    status = EpisodeStatus.SOLVED
                    break
                nudges += 1
                if nudges > self.MAX_NUDGES:
                    status = EpisodeStatus.STOPPED_UNSOLVED
                    break
                nudge = (
                    "你还没有解出魔方。请继续调用工具；如果确实无法继续，请明确说明。"
                )
            final_state = executor.state

        final_state = executor.state
        final_length = self.solver.distance(final_state)
        reference_length = start_length
        efficiency = (
            executor.moves_used / reference_length
            if reference_length and reference_length > 0
            else None
        )
        progress = score_progress(
            reference_length,
            final_length,
            final_state.is_solved(),
        )
        failure_code = None if status == EpisodeStatus.SOLVED else status.value
        result = EpisodeResult(
            status=status,
            solved=final_state.is_solved(),
            moves_used=executor.moves_used,
            reference_length=reference_length,
            efficiency=efficiency,
            progress_ratio=progress,
            invalid_calls=executor.invalid_calls,
            protocol_errors=executor.protocol_errors,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=int((time.monotonic() - started) * 1000),
            final_state=final_state.to_json(),
            failure_code=failure_code,
            steps=steps,
        )
        notify("episode.finished", {"status": status.value, "solved": result.solved})
        return result
```

> 注意：上面的 `from ..cube.solver import ProviderError as _Unused` 是笔误，不要保留；`ProviderError` 从 `..models.provider` 导入。实现时删掉这一行。

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/runner/test_episode.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/mofang/eval src/mofang/runner/episode.py tests/runner/test_episode.py
git commit -m "feat: episode 状态机与评分"
```

---

### Task 10: CLI、聚合报告与端到端假 provider

**Files:**
- Create: `src/mofang/eval/aggregate.py`
- Create: `src/mofang/cli.py`
- Test: `tests/test_cli.py`
- Test: `tests/eval/test_aggregate.py`

**Interfaces:**
- Consumes: `Benchmark`、`EpisodeRunner`、`FakeProvider`、`Table2x2Solver`
- Produces:
  - `aggregate_report(benchmark, results) -> dict`
  - `main(argv=None) -> int`
  - CLI 子命令 `run`、`benchmark`、`report`

- [ ] **Step 1: 写失败测试 `tests/eval/test_aggregate.py`**

```python
from mofang.eval.aggregate import wilson_interval


def test_wilson_bounds() -> None:
    low, high = wilson_interval(0, 10)
    assert 0.0 <= low <= high < 0.35
    low, high = wilson_interval(10, 10)
    assert 0.65 < low <= high <= 1.0
    assert wilson_interval(0, 0) == (0.0, 0.0)
```

- [ ] **Step 2: 写失败测试 `tests/test_cli.py`**

```python
import asyncio
from pathlib import Path

from mofang.cli import main
from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table, save_table
from mofang.tasks.generator import generate_benchmark


def test_fake_run_end_to_end(tmp_path: Path) -> None:
    solver = Table2x2Solver(build_table(max_depth=2))
    benchmark = generate_benchmark(
        name="demo",
        cube="2x2",
        depths=[1, 2],
        per_depth=1,
        seed=3,
        solver=solver,
    )
    bench_path = tmp_path / "bench.json"
    table_path = tmp_path / "table.pkl"
    report_path = tmp_path / "report.json"
    benchmark.save(bench_path)
    save_table(solver.table, table_path)

    exit_code = main(
        [
            "run",
            "--provider",
            "fake",
            "--benchmark",
            str(bench_path),
            "--table",
            str(table_path),
            "--out",
            str(report_path),
        ]
    )
    assert exit_code == 0
    assert report_path.exists()
    text = report_path.read_text(encoding="utf-8")
    assert '"solve_rate": 1.0' in text
```

- [ ] **Step 3: 运行确认失败**

Run: `uv run pytest tests/eval/test_aggregate.py tests/test_cli.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 4: 实现 `eval/aggregate.py`**

```python
from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..runner.episode import EpisodeResult, EpisodeStatus
from ..tasks.models import Benchmark


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    from .scorer import wilson_interval as _wilson

    return _wilson(successes, total, z)


def aggregate_report(
    benchmark: Benchmark,
    results: list[EpisodeResult],
) -> dict[str, Any]:
    tasks = {task.id: task for task in benchmark.tasks}
    solved = sum(1 for result in results if result.solved)
    total = len(results)
    by_bin: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"total": 0, "solved": 0, "moves": []}
    )
    for result, task in zip(results, benchmark.tasks):
        bucket = by_bin[task.bin]
        bucket["total"] += 1
        bucket["solved"] += int(result.solved)
        bucket["moves"].append(result.moves_used)
    bins = {}
    for name, bucket in by_bin.items():
        low, high = wilson_interval(bucket["solved"], bucket["total"])
        bins[name] = {
            "total": bucket["total"],
            "solved": bucket["solved"],
            "solve_rate": bucket["solved"] / bucket["total"],
            "ci95": [low, high],
            "mean_moves": sum(bucket["moves"]) / len(bucket["moves"]),
        }
    return {
        "benchmark_id": benchmark.id,
        "benchmark_hash": benchmark.content_hash,
        "totals": {
            "tasks": total,
            "solved": solved,
            "solve_rate": solved / total if total else 0.0,
            "ci95": list(wilson_interval(solved, total)),
        },
        "by_bin": bins,
        "episodes": [
            {
                "task_id": task.id,
                "status": result.status.value,
                "solved": result.solved,
                "moves_used": result.moves_used,
                "reference_length": result.reference_length,
                "efficiency": result.efficiency,
                "progress_ratio": result.progress_ratio,
                "protocol_errors": result.protocol_errors,
                "tokens_in": result.tokens_in,
                "tokens_out": result.tokens_out,
                "latency_ms": result.latency_ms,
                "failure_code": result.failure_code,
            }
            for task, result in zip(benchmark.tasks, results)
        ],
    }
```

- [ ] **Step 5: 实现 `cli.py`**

```python
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .cube.moves import invert_moves
from .cube.table2x2 import Table2x2Solver, build_table, load_table
from .eval.aggregate import aggregate_report
from .models.provider import FakeProvider, ModelTurn, ToolCall
from .runner.budget import Budget
from .runner.episode import EpisodeRunner
from .tasks.generator import generate_benchmark
from .tasks.models import Benchmark, Task


def _fake_turns(task: Task) -> list[ModelTurn]:
    solution = invert_moves(task.scramble)
    return [
        ModelTurn(
            tool_calls=[
                ToolCall(
                    id="fake-call-1",
                    name="apply_moves",
                    arguments={"moves": solution},
                )
            ]
        ),
        ModelTurn(content="solved"),
    ]


def _load_solver(args: argparse.Namespace):
    if args.solver == "table":
        table_path = Path(args.table)
        if not table_path.exists():
            raise SystemExit(
                f"2x2 table not found: {table_path}. "
                "Run: uv run python scripts/build_2x2_table.py"
            )
        return Table2x2Solver(load_table(table_path))
    if args.solver == "rubik":
        from .cube.solver import RubikTwoPhaseClient

        return RubikTwoPhaseClient()
    raise SystemExit(f"unsupported solver: {args.solver}")


async def _run(args: argparse.Namespace) -> int:
    benchmark = Benchmark.load(Path(args.benchmark))
    tasks = benchmark.tasks[: args.limit] if args.limit else benchmark.tasks
    solver = _load_solver(args)
    budget = Budget(
        max_moves=args.max_moves,
        max_tool_calls=args.max_tool_calls,
        max_tokens=args.max_tokens,
        max_seconds=args.max_seconds,
    )
    results = []
    for task in tasks:
        if args.provider == "fake":
            provider = FakeProvider(_fake_turns(task))
        else:
            raise SystemExit("openai provider is added in Task 11")
        runner = EpisodeRunner(provider=provider, solver=solver, budget=budget)
        result = await runner.run(task)
        results.append(result)
        print(
            f"{task.id}: {result.status.value} moves={result.moves_used}",
            flush=True,
        )
    report = aggregate_report(benchmark, results)
    close = getattr(solver, "close", None)
    if close is not None:
        close()
    report["provider"] = args.provider
    report["model"] = args.model
    Path(args.out).write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"report: {args.out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mofang")
    sub = parser.add_subparsers(dest="command", required=True)

    bench = sub.add_parser("benchmark", help="generate a frozen benchmark")
    bench.add_argument("--name", default="demo")
    bench.add_argument("--cube", choices=["2x2", "3x3"], required=True)
    bench.add_argument("--depths", default="1,2,3")
    bench.add_argument("--per-depth", type=int, default=2)
    bench.add_argument("--seed", type=int, default=42)
    bench.add_argument("--out", required=True)
    bench.add_argument("--solver", choices=["table", "fake", "rubik"], default="table")
    bench.add_argument("--table", default="data/cache/2x2_distances.pkl")

    run = sub.add_parser("run", help="run a benchmark")
    run.add_argument("--provider", choices=["fake", "openai"], default="fake")
    run.add_argument("--benchmark", required=True)
    run.add_argument("--out", required=True)
    run.add_argument("--model", default="fake")
    run.add_argument("--limit", type=int, default=0)
    run.add_argument("--solver", choices=["table", "rubik"], default="table")
    run.add_argument("--table", default="data/cache/2x2_distances.pkl")
    run.add_argument("--max-moves", type=int, default=30)
    run.add_argument("--max-tool-calls", type=int, default=50)
    run.add_argument("--max-tokens", type=int, default=300_000)
    run.add_argument("--max-seconds", type=float, default=300.0)

    report = sub.add_parser("report", help="print a saved report summary")
    report.add_argument("--report", required=True)
    return parser


def _generate(args: argparse.Namespace) -> int:
    if args.solver == "table":
        table_path = Path(args.table)
        if not table_path.exists():
            raise SystemExit(
                f"2x2 table not found: {table_path}. "
                "Run: uv run python scripts/build_2x2_table.py"
            )
        solver = Table2x2Solver(load_table(table_path))
    elif args.solver == "rubik":
        from .cube.solver import RubikTwoPhaseClient

        solver = RubikTwoPhaseClient()
    else:
        from .cube.solver import FakeSolver

        solver = FakeSolver()
        solver.distance = lambda state: 1  # type: ignore[method-assign]
    depths = [int(value) for value in args.depths.split(",") if value.strip()]
    benchmark = generate_benchmark(
        name=args.name,
        cube=args.cube,
        depths=depths,
        per_depth=args.per_depth,
        seed=args.seed,
        solver=solver,
    )
    benchmark.save(Path(args.out))
    print(f"benchmark: {args.out} ({len(benchmark.tasks)} tasks)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "run":
        return asyncio.run(_run(args))
    if args.command == "benchmark":
        return _generate(args)
    if args.command == "report":
        report = json.loads(Path(args.report).read_text(encoding="utf-8"))
        print(json.dumps(report["totals"], ensure_ascii=False, indent=2))
        return 0
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: 运行测试确认通过**

Run: `uv run pytest tests/eval/test_aggregate.py tests/test_cli.py -v`

Expected: PASS。

- [ ] **Step 7: 手动跑一次端到端**

```bash
uv run python scripts/build_2x2_table.py --max-depth 3 --out data/cache/2x2_d3.pkl
uv run mofang benchmark --name demo --cube 2x2 --depths 1,2,3 --per-depth 2 --seed 7 --table data/cache/2x2_d3.pkl --out data/benchmarks/demo-2x2.json
uv run mofang run --provider fake --benchmark data/benchmarks/demo-2x2.json --table data/cache/2x2_d3.pkl --out data/reports/demo.json
```

Expected: 每条 episode `solved`，报告 `solve_rate: 1.0`。

- [ ] **Step 8: 提交**

```bash
git add src/mofang/eval/aggregate.py src/mofang/cli.py tests/eval/test_aggregate.py tests/test_cli.py
git commit -m "feat: CLI 与聚合报告"
```

---

### Task 11: OpenAI-compatible 适配器与真模型 CLI

**Files:**
- Create: `src/mofang/models/openai_compat.py`
- Modify: `src/mofang/cli.py`
- Test: `tests/models/test_openai_compat.py`

**Interfaces:**
- Consumes: `ProviderAdapter`、`ProviderError`、`ModelTurn`、`ToolCall`、`Usage`
- Produces: `OpenAICompatibleAdapter(base_url, api_key, model, params=None, client=None, retry_delay=1.0)`，支持 `chat()`、`probe_tools()`

- [ ] **Step 1: 写失败测试 `tests/models/test_openai_compat.py`**

```python
import httpx
import pytest
import respx

from mofang.models.openai_compat import OpenAICompatibleAdapter
from mofang.models.provider import ModelParams, ProviderError

BASE = "https://example.test/v1"


@pytest.fixture
def adapter() -> OpenAICompatibleAdapter:
    return OpenAICompatibleAdapter(
        base_url=BASE,
        api_key="secret",
        model="test-model",
        retry_delay=0,
    )


@respx.mock
async def test_parses_tool_call(adapter: OpenAICompatibleAdapter) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "type": "function",
                                    "function": {"name": "turn", "arguments": '{"face":"R","amount":1}'},
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )
    )
    turn = await adapter.chat([{"role": "user", "content": "go"}], [], ModelParams())
    assert turn.tool_calls[0].name == "turn"
    assert turn.tool_calls[0].arguments == {"face": "R", "amount": 1}
    assert turn.usage.prompt_tokens == 10


@respx.mock
async def test_malformed_arguments(adapter: OpenAICompatibleAdapter) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {"id": "c1", "type": "function", "function": {"name": "turn", "arguments": "{bad"}}
                            ]
                        }
                    }
                ]
            },
        )
    )
    turn = await adapter.chat([{"role": "user", "content": "go"}], [], ModelParams())
    assert turn.tool_calls[0].arguments is None
    assert turn.tool_calls[0].raw_arguments == "{bad"


@respx.mock
async def test_retries_429(adapter: OpenAICompatibleAdapter) -> None:
    route = respx.post(f"{BASE}/chat/completions")
    route.side_effect = [
        httpx.Response(429, text="rate limited"),
        httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}),
    ]
    turn = await adapter.chat([{"role": "user", "content": "go"}], [], ModelParams())
    assert turn.content == "ok"
    assert route.call_count == 2


@respx.mock
async def test_auth_error_does_not_retry(adapter: OpenAICompatibleAdapter) -> None:
    route = respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(401, text="bad key")
    )
    with pytest.raises(ProviderError) as exc:
        await adapter.chat([{"role": "user", "content": "go"}], [], ModelParams())
    assert exc.value.kind == "auth"
    assert route.call_count == 1
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest tests/models/test_openai_compat.py -v`

Expected: FAIL，`ModuleNotFoundError`。

- [ ] **Step 3: 实现 `openai_compat.py`**

```python
from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from .provider import (
    ModelParams,
    ModelTurn,
    ProviderError,
    ToolCall,
    Usage,
)


class OpenAICompatibleAdapter:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        *,
        client: httpx.AsyncClient | None = None,
        retry_delay: float = 1.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.retry_delay = retry_delay
        self._client = client or httpx.AsyncClient()

    async def close(self) -> None:
        await self._client.aclose()

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        params: ModelParams,
    ) -> ModelTurn:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        payload.update(params.extra)
        response = await self._post(payload)
        return self._parse(response)

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: str | None = None
        for attempt in range(4):
            try:
                response = await self._client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=self._headers,
                )
            except httpx.TimeoutException as exc:
                last_error = str(exc)
                if attempt < 3:
                    await asyncio.sleep(self.retry_delay * (2**attempt))
                    continue
                raise ProviderError("timeout", last_error, retryable=True) from exc
            if response.status_code == 429 or response.status_code >= 500:
                last_error = response.text
                if attempt < 3:
                    await asyncio.sleep(self.retry_delay * (2**attempt))
                    continue
                kind = "rate_limit" if response.status_code == 429 else "server"
                raise ProviderError(kind, last_error, retryable=True)
            if response.status_code in (401, 403):
                raise ProviderError("auth", response.text)
            if response.status_code >= 400:
                raise ProviderError("bad_request", response.text)
            return response.json()
        raise ProviderError("server", last_error or "request failed", retryable=True)

    def _parse(self, data: dict[str, Any]) -> ModelTurn:
        choices = data.get("choices") or []
        if not choices:
            raise ProviderError("bad_response", "response has no choices")
        choice = choices[0]
        message = choice.get("message") or {}
        calls: list[ToolCall] = []
        for index, raw in enumerate(message.get("tool_calls") or []):
            function = raw.get("function") or {}
            raw_arguments = function.get("arguments") or ""
            try:
                arguments = json.loads(raw_arguments) if raw_arguments else {}
            except json.JSONDecodeError:
                arguments = None
            calls.append(
                ToolCall(
                    id=raw.get("id") or f"call-{index}",
                    name=function.get("name") or "",
                    arguments=arguments,
                    raw_arguments=raw_arguments,
                )
            )
        usage = data.get("usage") or {}
        return ModelTurn(
            content=message.get("content"),
            tool_calls=calls,
            usage=Usage(
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
            ),
            raw=data,
            finish_reason=choice.get("finish_reason"),
        )

    async def probe_tools(self) -> bool:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": "Reply with ok."}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "ping",
                        "description": "ping",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
            "tool_choice": "auto",
            "max_tokens": 16,
        }
        try:
            await self._post(payload)
        except ProviderError as exc:
            if exc.kind == "bad_request" and "tool" in str(exc).lower():
                return False
            raise
        return True
```

- [ ] **Step 4: 接入 CLI**

在 `cli.py` 的 `_run` 中，把 `raise SystemExit("openai provider is added in Task 11")` 替换为：

```python
        else:
            import os

            from .models.openai_compat import OpenAICompatibleAdapter

            api_key = os.environ.get(args.api_key_env, "")
            if not api_key:
                raise SystemExit(f"missing API key env: {args.api_key_env}")
            provider = OpenAICompatibleAdapter(
                base_url=args.base_url,
                api_key=api_key,
                model=args.model,
            )
```

并在 `run` 子命令加参数：

```python
    run.add_argument("--base-url", default="https://api.openai.com/v1")
    run.add_argument("--api-key-env", default="OPENAI_API_KEY")
```

- [ ] **Step 5: 运行测试确认通过**

Run: `uv run pytest tests/models/test_openai_compat.py -v`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/mofang/models/openai_compat.py src/mofang/cli.py tests/models/test_openai_compat.py
git commit -m "feat: OpenAI-compatible 适配器"
```

---

### Task 12: 全量回归与真实模型冒烟

**Files:**
- Modify: `README.md`（补充真实模型用法）
- Test: 全量测试

- [ ] **Step 1: 跑非 slow 全量测试**

Run: `uv run pytest -m "not slow" -v`

Expected: 全部 PASS。

- [ ] **Step 2: 跑 2x2 全表（可选，较慢）**

```bash
uv run python scripts/build_2x2_table.py --max-depth 11 --out data/cache/2x2_distances.pkl
```

Expected: 输出 `wrote 3674160 states ...`（数值以实际 BFS 为准；若状态数不同，先检查走法引擎）。

- [ ] **Step 3: 用真模型跑 2x2 一步题（需用户提供 key）**

```bash
export OPENAI_API_KEY=...
uv run mofang benchmark --name real --cube 2x2 --depths 1 --per-depth 1 --seed 1 --out data/benchmarks/real-1.json
uv run mofang run --provider openai --model gpt-4.1-mini --base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY --benchmark data/benchmarks/real-1.json --limit 1 --out data/reports/real-1.json
```

Expected: 生成报告；状态可能是 `solved` 或 `stopped_unsolved`，两者都算链路跑通；把报告与失败码记录下来。

- [ ] **Step 4: 更新 README 并提交**

在 README 增加：

```markdown
## 真实模型

```bash
export OPENAI_API_KEY=...
uv run mofang run --provider openai --model <model> --base-url <url> \
  --api-key-env OPENAI_API_KEY --benchmark <bench.json> --out <report.json>
```

报告包含逐题状态、步数、效率、协议错误、tokens 与耗时。

3x3 需要先构建求解表，并显式放宽预算：

```bash
uv run mofang run --provider openai --model <model> --solver rubik \
  --max-moves 100 --max-tool-calls 150 --max-seconds 900 --max-tokens 1000000 \
  --benchmark <bench3x3.json> --out <report.json>
```
```

```bash
git add README.md
git commit -m "docs: 补充真实模型运行方式"
```

---

## Self-Review

**Spec coverage（本计划覆盖范围）**
- 状态/走法/JSON/解出判定 → Task 1、2。
- 2x2 精确距离与最优解 → Task 4。
- 3x3 近优求解与 GPL 隔离 → Task 5。
- 难度档与基准集冻结 → Task 6（生成/哈希/去重）。
- 工具协议、推送/拉取、原子批量 → Task 7。
- 上下文管理 → Task 8。
- Episode 状态机、预算、协议错误分离 → Task 9。
- 评分与 Wilson CI → Task 9、10。
- CLI、报告、假 provider 端到端 → Task 10。
- OpenAI-compatible、重试、usage → Task 11。
- 全量回归与真模型冒烟 → Task 12。
- **未覆盖（Plan 2）**：FastAPI、SQLite、SSE、React/three.js、对比页、导出、run 历史、断线重连、多模态。这是有意的子系统拆分。

**Placeholder scan**
- 本计划没有 TBD/TODO；所有代码步骤都给了可执行内容。

**Type consistency**
- `CubeState` 的 `faces` 是 6 个 grid 的 tuple；`to_json` 用 FACE_ORDER。
- `move_permutation` 返回 `perm[target] = source`；`turn` 按这个方向重建。
- `ToolExecutor.execute` 接收 `arguments: dict | None`；provider 的 `ToolCall.arguments` 允许 `None`。
- `EpisodeRunner` 使用 `ReferenceSolver.distance`；2x2/3x3 都实现。
- `Benchmark.save` 会回填 `content_hash`；测试在 save 后比较。
- CLI 的 `_load_solver` 只支持 table；3x3 CLI 运行留到 Plan 2/后续任务，因为 3x3 表构建耗时且 CLI 目前按 2x2 表加载。**这是一个已知范围限制。**

**已知范围限制**
- 本计划的 CLI `run` 只加载 2x2 表；3x3 的 solver client 在 Task 5 已实现并可单测，但 CLI 尚未接入 3x3 表选择。Plan 2 接入 API 时一并补 `--solver rubik`。
- 本计划没有持久化到 SQLite；报告写 JSON 文件。Plan 2 建库。
- 本计划没有前端；Plan 2 做 React/three.js。

---

## Execution Handoff

Plan 1 已保存。执行方式选择：

1. **Inline Execution（推荐用于本计划）** — 在当前会话按任务顺序执行，每个任务跑测试并 commit，遇到阻塞立即停下报告。
2. **Subagent-Driven** — 每个任务派一个新 subagent，任务间做两阶段 review；上下文更干净，但需要更多往返。
