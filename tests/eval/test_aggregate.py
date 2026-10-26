from mofang.eval.aggregate import wilson_interval


def test_wilson_bounds() -> None:
    low, high = wilson_interval(0, 10)
    assert 0.0 <= low <= high < 0.35
    low, high = wilson_interval(10, 10)
    assert 0.65 < low <= high <= 1.0
    assert wilson_interval(0, 0) == (0.0, 0.0)
