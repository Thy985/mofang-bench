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
