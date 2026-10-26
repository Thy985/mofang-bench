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
        # 2x2 无中心块，六面同色即已还原，即使整体色向与初始朝向不同
        return all(
            all(color == grid[0][0] for row in grid for color in row)
            for grid in self.faces
        )

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
