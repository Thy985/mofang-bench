from mofang.eval.compare import bootstrap_diff_ci


def test_bootstrap_deterministic_and_bounded() -> None:
    observed, low, high = bootstrap_diff_ci([1.0, 0.0, 1.0, 1.0], n=500, seed=7)
    assert observed == 0.75
    assert low <= observed <= high
    assert 0.0 <= low <= high <= 1.0


def test_bootstrap_empty() -> None:
    assert bootstrap_diff_ci([]) == (0.0, 0.0, 0.0)
