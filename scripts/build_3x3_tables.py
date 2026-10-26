from __future__ import annotations

SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"


def main() -> None:
    import twophase.solver as solver

    print("Generating RubikTwoPhase tables (about 30 minutes, ~80 MB)...")
    print(solver.solve(SOLVED, 20, 10))
    print("done")


if __name__ == "__main__":
    main()
