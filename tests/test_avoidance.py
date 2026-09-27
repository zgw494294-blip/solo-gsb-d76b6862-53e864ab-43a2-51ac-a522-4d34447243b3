"""双面点阵避让引擎测试。

包含坐标公式、择优优先级、冲突端点标注、参数校验，以及与朴素 O(点²×位移²)
暴力实现的随机对照。
"""

import math
import random
import string

import pytest

from app.avoidance import (
    EVALUATED,
    SHIFT_LEVELS,
    SHIFT_MAX,
    SHIFT_MIN,
    Dot,
    ValidationError,
    avoid,
    count_shifts,
    dot_xy,
    extract_points,
    solve_avoidance,
)
from app.braille import typeset

# ---------------------------------------------------------------------------
# 坐标公式（单位 0.1 毫米）
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("r,c,dot,expect", [
    (0, 0, 1, (0, 0)),
    (0, 0, 2, (25, 25)),
    (0, 0, 3, (50, 50)),
    (0, 0, 4, (25, 0)),
    (0, 0, 5, (50, 25)),
    (0, 0, 6, (75, 50)),
    (2, 3, 1, (180, 200)),
    (2, 3, 4, (205, 200)),
    (2, 3, 6, (255, 250)),
])
def test_dot_coordinates(r, c, dot, expect):
    assert dot_xy(r, c, dot) == expect


def test_extract_points_only_raised_dots():
    # a = 点 1；空格无凸点
    r = typeset("a ", 10)
    pts = extract_points(r)
    assert len(pts) == 1
    assert pts[0] == Dot(0, 0, 1, 0, 0)


def test_extract_points_blank_line_kept_for_vertical_alignment():
    r = typeset("a\n\nb", 10)
    pts = extract_points(r)
    # 空段占一行（r=1 无点），b（点 1、2）在 r=2
    assert [(p.r, p.c, p.dot) for p in pts] == [
        (0, 0, 1), (2, 0, 1), (2, 0, 2),
    ]


# ---------------------------------------------------------------------------
# 择优与冲突
# ---------------------------------------------------------------------------

def test_zero_conflict_feasible_and_zero_shift_when_possible():
    # "ac" 宽度 10：正面 c 在格 1，反面 c 在格 0，镜像到格 8 附近，天然不冲突
    r = avoid("ac", "c", 10, 1.0)
    assert r["feasible"] is True
    assert r["conflict_count"] == 0
    assert r["shift"] == {"dx": 0.0, "dy": 0.0}
    assert r["conflicts"] == []
    assert r["evaluated"] == EVALUATED == 3721


def test_prefers_smaller_squared_shift():
    # 正面 10 个 a 占满一行 + c（格 9，点 1、4）；反面单个 c（格 0，点 1、4），
    # 宽 10 镜像常量 m=565：反面点 1/4 的镜像 x=565/540，恰与正面 c 的
    # 点 4/1（x=565/540）交叉重合，位移 0 时共 2 对冲突。
    # 阈值 1.0mm（严格）：dx=±10（±1.0mm）才把这两对同时错开（已实测），
    # dx²+dy² 相同再取 dx 更小 => dx = -1.0。
    r = avoid("aaaaaaaaac", "c", 10, 1.0)
    assert r["feasible"] is True
    assert r["conflict_count"] == 0
    assert r["shift"] == {"dx": -1.0, "dy": 0.0}


def test_conflict_endpoints_carry_side_row_col_dot():
    # 满行 q（5 点，几乎铺满）两面相同，3.0mm 阈值下任何位移都无法全避。
    r = avoid("q" * 10, "q" * 10, 10, 3.0)
    assert r["feasible"] is False
    assert r["conflict_count"] == len(r["conflicts"]) == 46
    assert r["shift"] == {"dx": -0.5, "dy": -3.0}
    seen = set()
    for cf in r["conflicts"]:
        assert set(cf["front"]) == {"side", "row", "col", "dot", "x", "y"}
        assert set(cf["back"]) == {"side", "row", "col", "dot", "x", "y"}
        assert cf["front"]["side"] == "front"
        assert cf["back"]["side"] == "back"
        d = math.hypot(cf["front"]["x"] - cf["back"]["x"],
                       cf["front"]["y"] - cf["back"]["y"])
        assert d < 3.0
        assert cf["distance_mm"] == round(d, 2)
        key = (cf["front"]["row"], cf["front"]["col"], cf["front"]["dot"],
               cf["back"]["row"], cf["back"]["col"], cf["back"]["dot"])
        assert key not in seen  # 端点对不重复
        seen.add(key)
    # 冲突按正面 (行,格,点)、再按反面 (行,格,点) 排序，首对确定
    cf = r["conflicts"][0]
    assert (cf["front"]["row"], cf["front"]["col"], cf["front"]["dot"]) == (0, 0, 1)
    assert (cf["back"]["row"], cf["back"]["col"], cf["back"]["dot"]) == (0, 9, 2)


def test_strict_less_than_threshold():
    # 宽 10、m=565：反面格 9 左列点（本面 x=540）镜像后 x=25，
    # 与正面格 0 左列点（x=0）在位移 0 时恰距 2.5mm。
    #   tenths=25（阈值恰 2.5mm）须严格小于才冲突 => 不冲突；
    #   tenths=26（2.6mm）=> 冲突 1 对。
    fp = [Dot(0, 0, 1, 0, 0)]
    bp = [Dot(0, 9, 1, 540, 0)]
    center = SHIFT_LEVELS // 2  # a=0、b=0 所在行列
    assert count_shifts(fp, bp, 10, 25)[center][center] == 0
    assert count_shifts(fp, bp, 10, 26)[center][center] == 1


def test_dense_grid_conflicts_remain_at_max_threshold():
    # 正面满格 q（5 点，几乎铺满），反面同样满格：3.0mm 阈值下无位移可全避。
    text = "q" * 20
    r = avoid(text, text, 10, 3.0)
    assert r["feasible"] is False
    assert r["conflict_count"] > 0
    assert r["conflict_count"] == len(r["conflicts"])


def test_shift_bounds_exhausted():
    counts = count_shifts([Dot(0, 0, 1, 0, 0)], [Dot(0, 0, 1, 0, 0)], 10, 1)
    assert len(counts) == SHIFT_LEVELS
    assert all(len(row) == SHIFT_LEVELS for row in counts)
    assert SHIFT_MIN == -30 and SHIFT_MAX == 30


# ---------------------------------------------------------------------------
# 参数校验
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("value", [0.0, 0.09, 3.01, 3.1, 1.23, -0.5, float("nan")])
def test_bad_min_distance(value):
    with pytest.raises(ValidationError) as ei:
        avoid("a", "a", 10, value)
    assert any(e["code"] == "bad_min_distance" for e in ei.value.errors)


@pytest.mark.parametrize("value,expected", [
    (0.1, 0.1), (1.5, 1.5), (3.0, 3.0), (1, 1.0), (2, 2.0),
])  # 整数与一位小数均合法
def test_ok_min_distance(value, expected):
    r = avoid("ac", "c", 10, value)
    assert r["min_distance"] == expected


def test_front_back_errors_both_reported_and_tagged():
    with pytest.raises(ValidationError) as ei:
        avoid("a!", "b@", 10, 1.0)
    sides = {e.get("side") for e in ei.value.errors}
    assert sides == {"front", "back"}
    assert all("【正面】" in e["message"] for e in ei.value.errors if e["side"] == "front")
    assert all("【反面】" in e["message"] for e in ei.value.errors if e["side"] == "back")


def test_bad_width_reported_once():
    with pytest.raises(ValidationError) as ei:
        avoid("a", "b", 41, 1.0)
    bad = [e for e in ei.value.errors if e["code"] == "bad_width"]
    assert len(bad) == 1
    assert "side" not in bad[0]


def test_mixed_word_located_via_existing_validation():
    with pytest.raises(ValidationError) as ei:
        avoid("ab1", "ok", 10, 1.0)
    err = next(e for e in ei.value.errors if e["code"] == "mixed_word")
    assert err["side"] == "front"
    assert (err["line"], err["col"]) == (1, 1)


# ---------------------------------------------------------------------------
# 与暴力实现的随机对照
# ---------------------------------------------------------------------------

def _brute(front_text, back_text, w, tenths):
    fp = extract_points(typeset(front_text, w))
    bp = extract_points(typeset(back_text, w))
    m = 60 * (w - 1) + 25
    t2 = tenths * tenths
    best = None
    best_pairs = 0
    for a in range(-30, 31):
        for b in range(-30, 31):
            n = 0
            for f in fp:
                for p in bp:
                    dx = (m - p.x + a) - f.x
                    dy = (p.y + b) - f.y
                    if dx * dx + dy * dy < t2:
                        n += 1
            key = (n, a * a + b * b, a, b)
            if best is None or key < best:
                best = key
                best_pairs = n
    return best, best_pairs


def _rand_text(rng, n):
    parts, used = [], 0
    while used < n:
        wl = rng.randint(1, 6)
        if rng.random() < 0.15:
            w = "".join(rng.choice("1234567890") for _ in range(wl))
        else:
            w = "".join(rng.choice(string.ascii_lowercase) for _ in range(wl))
        parts.append(w)
        used += wl + 1
    return " ".join(parts)[:n]


def test_against_brute_force_random():
    rng = random.Random(20260927)
    fixed = [
        ("a", "a", 10, 1),
        ("aaaaaaaaac", "c", 10, 10),
        ("ab cd", "dc ba", 10, 30),
        ("Hello", "Braille", 12, 15),
        ("q" * 20, "q" * 20, 10, 30),
        ("a\n\nb", "b\n\na", 11, 20),
    ]
    cases = list(fixed)
    for _ in range(18):
        n = rng.randint(5, 90)
        cases.append((_rand_text(rng, n), _rand_text(rng, n),
                      rng.randint(10, 15), rng.randint(1, 30)))

    for fr, ba, w, t in cases:
        fp = extract_points(typeset(fr, w))
        bp = extract_points(typeset(ba, w))
        s = solve_avoidance(fp, bp, w, t)
        best, best_pairs = _brute(fr, ba, w, t)
        got = (s["count"], s["a"] ** 2 + s["b"] ** 2, s["a"], s["b"])
        assert got == best, (fr[:20], ba[:20], w, t, got, best)
        assert len(s["conflicts"]) == best_pairs
        # 回收的冲突全部满足阈值且端点对不重复
        seen = set()
        m = 60 * (w - 1) + 25
        for c in s["conflicts"]:
            f, p = c["front"], c["back"]
            dx = m - p.x + s["a"] - f.x
            dy = p.y + s["b"] - f.y
            assert dx * dx + dy * dy < t * t
            assert math.isclose(
                c["d2"], dx * dx + dy * dy, abs_tol=0)
            k = (f.r, f.c, f.dot, p.r, p.c, p.dot)
            assert k not in seen
            seen.add(k)
