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
                target_face, target_row, target_col = position_to_sticker(
                    new_pos, new_n, size
                )
                target = sticker_index(target_face, target_row, target_col, size)
                source = sticker_index(source_face, row, col, size)
                perm[target] = source
    if any(value < 0 for value in perm) or len(set(perm)) != total:
        raise RuntimeError(f"invalid permutation for {size} {face} {amount}")
    return tuple(perm)


@lru_cache(maxsize=None)
def whole_rotation_permutation(
    size: int, axis: int, quarter_turns: int = 1
) -> tuple[int, ...]:
    total = 6 * size * size
    perm = [-1] * total
    for face in FACE_ORDER:
        for row in range(size):
            for col in range(size):
                pos, normal = sticker_geometry(face, row, col, size)
                new_pos = rotate(pos, axis, quarter_turns)
                new_normal = rotate(normal, axis, quarter_turns)
                target_face, target_row, target_col = position_to_sticker(
                    new_pos, new_normal, size
                )
                target = sticker_index(target_face, target_row, target_col, size)
                source = sticker_index(face, row, col, size)
                perm[target] = source
    if any(value < 0 for value in perm) or len(set(perm)) != total:
        raise RuntimeError(f"invalid whole rotation for {size} axis {axis}")
    return tuple(perm)


@lru_cache(maxsize=None)
def whole_rotations(size: int) -> tuple[tuple[int, ...], ...]:
    identity = tuple(range(6 * size * size))
    bases = [whole_rotation_permutation(size, axis, 1) for axis in (0, 1, 2)]
    seen = {identity}
    frontier = [identity]
    while frontier:
        new_frontier = []
        for perm in frontier:
            for base in bases:
                composed = tuple(
                    perm[base[target]] for target in range(len(perm))
                )
                if composed not in seen:
                    seen.add(composed)
                    new_frontier.append(composed)
        frontier = new_frontier
    return tuple(sorted(seen))
