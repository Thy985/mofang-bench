"""skill pack 的边界粗检：只做结构/关键词断言，不锁全文。"""

import re

from mofang.runner.skills import (
    LBL_PACK,
    ORTEGA_PACK,
    PACKS,
    cube_mismatch_error,
    pack_for,
)


def test_pack_lookup_and_cube_mapping() -> None:
    assert pack_for("none") is None
    assert pack_for("ortega") == ORTEGA_PACK
    assert pack_for("lbl") == LBL_PACK
    assert cube_mismatch_error("none", "2x2") is None
    assert cube_mismatch_error("ortega", "2x2") is None
    assert cube_mismatch_error("lbl", "3x3") is None
    ortega_err = cube_mismatch_error("ortega", "3x3")
    lbl_err = cube_mismatch_error("lbl", "2x2")
    assert ortega_err is not None and "2x2" in ortega_err
    assert lbl_err is not None and "3x3" in lbl_err


def test_packs_are_method_knowledge_not_solver_tables() -> None:
    for name, text in PACKS.items():
        # 不含打乱序列/整局解法
        assert "打乱" not in text, name
        assert "scramble" not in text.lower(), name
        assert "逆序" not in text, name
        # 不含状态 -> 走法 的查表形式（整份 facelet JSON / hash 映射）
        assert "faces" not in text, name
        assert "state_hash" not in text, name
        assert "JSON" not in text, name
        assert not re.search(r"则.*(整局|整体执行|走法串)", text), name


def test_ortega_pack_flags_the_known_pbl_soft_spot() -> None:
    text = ORTEGA_PACK
    assert "U 层 0 bar，D 层 1 bar" in text
    assert "共 25 步" in text
    assert "已知的步数软点" in text


def test_packs_read_injected_state_instead_of_get_state_first() -> None:
    # 平台每轮已把局面注入 user message，pack 不能再要求"先 get_state"。
    for name, text in PACKS.items():
        assert "先 get_state" not in text, name
        assert "user message" in text, name
        assert "不需要额外" in text and "get_state" in text, name


def test_ortega_oll_branches_are_checkable_and_self_narrated() -> None:
    text = ORTEGA_PACK
    # 判据要写清看哪些贴纸、怎么数
    assert "U 面矩阵的 4 个角格" in text
    assert "第 1 行" in text and "bar 数" in text
    # 每个分支要求一句话自述
    assert "我数到 X 个 U 面贴纸" in text
    assert "所以用第" in text
    # 目标色不可漂移
    assert "目标色只由第 1 步确定一次" in text
    # 防重复
    assert "禁止连续两轮在同一局面上重复同一条公式" in text
    # OLL 思考限长：只允许一句结论式陈述，禁止自由长推导与同轮反复复算
    assert "只允许一句结论式陈述" in text
    assert "禁止自由长推导" in text
    assert "反复验证同一判据" in text
    assert "视为无效动作" in text
    # probe_oll 已改为强制先用，delta 由落地回执自动给出
    assert "probe_oll" in text and "必须先调用" in text
    assert "oll_delta" in text
    # 步数口径与 max_moves=40 同步
    assert "步数上限 40" in text


def test_lbl_pack_states_the_verified_orientation() -> None:
    # 由 mofang.cube 自证：solved(3) 的 U/D 中心色固定为 white/yellow
    text = LBL_PACK
    assert "U 面中心 white" in text
    assert "D 面中心 yellow" in text
    assert "没有整体旋转" in text
