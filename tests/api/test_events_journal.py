import json
import subprocess
import sys
from pathlib import Path

from mofang.api.events import EventJournal, RunEventBus

ROOT = Path(__file__).resolve().parents[2]


def test_event_journal_flushes_before_hard_exit(tmp_path: Path) -> None:
    script = """
import os
import sys
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from mofang.api.events import EventJournal, RunEventBus

journal = EventJournal(Path(sys.argv[2]))
bus = RunEventBus(journal)
for index in range(3):
    bus.publish("r1", "probe", {"index": index})
os._exit(9)
"""
    proc = subprocess.run(
        [sys.executable, "-c", script, str(ROOT / "src"), str(tmp_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 9, proc.stderr
    path = tmp_path / "events-r1.jsonl"
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert len(lines) == 3
    assert text.endswith("\n")
    assert [json.loads(line)["data"]["index"] for line in lines] == [0, 1, 2]
