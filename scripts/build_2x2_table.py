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
