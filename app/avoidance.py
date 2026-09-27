"""双面点阵避让引擎。

输入正面、反面两篇 ASCII 原文与共同行宽 w，复用 braille.validate 的校验与
braille.typeset 的排版，把排好的盲文格上的**凸点**放入零基行格 (r, c)
（r 为行号、c 为格号，均 0 基），并在毫米坐标系下计算两面凸点的冲突：

- 点 1～3（k = 点号 - 1 = 0～2）：(x, y) = (6c + 2.5k, 10r + 2.5k)
- 点 4～6（k = 点号 - 4 = 0～2）：(x, y) = (6c + 2.5 + 2.5k, 10r + 2.5k)
- 反面点映射到正面坐标：(6(w-1) + 2.5 - x + dx, y + dy)

所有坐标与位移放大 10 倍用整数（0.1 毫米）保存，距离比较用整数平方，
避免浮点误差。dx、dy 各取 -30～30（即 -3～3 毫米、步长 0.1），共 61×61
个位移；两面点距（严格）小于最小点距即记一对冲突。遍历全部位移后按
（冲突对数, dx²+dy², dx, dy）依次最小择优。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .braille import ValidationError, typeset, validate

# 位移范围（单位：0.1 毫米）
SHIFT_MIN = -30
SHIFT_MAX = 30
SHIFT_LEVELS = SHIFT_MAX - SHIFT_MIN + 1  # 61
EVALUATED = SHIFT_LEVELS * SHIFT_LEVELS  # 3721

# 最小点距范围（单位：0.1 毫米）
MIN_DIST_MIN = 1   # 0.1 mm
MIN_DIST_MAX = 30  # 3.0 mm

# 点距阈值最大为 30、位移最大为 30，故只有基础坐标差绝对值 <= 59 的点对
# 才可能在某个位移下冲突（|d + a| < T <= 30 且 |a| <= 30）。
PAIR_BOUND = MIN_DIST_MAX + SHIFT_MAX - 1  # 59

_SIDE_LABEL = {"front": "【正面】", "back": "【反面】"}


@dataclass(frozen=True)
class Dot:
    """一个凸点：零基 (行, 格, 点号) 与本面坐标（0.1 毫米，整数）。"""

    r: int
    c: int
    dot: int
    x: int
    y: int


def dot_xy(r: int, c: int, dot: int) -> tuple[int, int]:
    """零基 (r,c,点号) -> 本面 (x, y)，单位 0.1 毫米。"""
    if 1 <= dot <= 3:
        k = dot - 1
        return 60 * c + 25 * k, 100 * r + 25 * k
    k = dot - 4
    return 60 * c + 25 + 25 * k, 100 * r + 25 * k


def extract_points(ts: dict) -> list[Dot]:
    """从 typeset 结果按 (行, 格, 点号) 顺序取出全部凸点；空白格无凸点。"""
    pts: list[Dot] = []
    for r, line in enumerate(ts["lines"]):
        for c, cell in enumerate(line["cells"]):
            for dot in cell["dots"]:  # 已排序；只含凸点
                x, y = dot_xy(r, c, dot)
                pts.append(Dot(r, c, dot, x, y))
    return pts


def _validate_inputs(front: str, back: str, width, tenths) -> None:
    """校验两篇原文 / 共同行宽 / 最小点距，错误合并为一次 ValidationError。"""
    errors: list[dict] = []

    if not isinstance(tenths, int) or isinstance(tenths, bool):
        errors.append({
            "code": "bad_min_distance",
            "message": "最小点距必须为数字。",
        })
    elif not MIN_DIST_MIN <= tenths <= MIN_DIST_MAX:
        errors.append({
            "code": "bad_min_distance",
            "message": f"最小点距须在 {MIN_DIST_MIN / 10:.1f}～"
                       f"{MIN_DIST_MAX / 10:.1f} 毫米之间，且限一位小数。",
        })

    seen: set[str] = set()
    for side, text in (("front", front), ("back", back)):
        try:
            validate(text, width)
        except ValidationError as exc:
            for err in exc.errors:
                # 行宽为两面共用，只保留一份且不打面别。
                if err.get("code") == "bad_width":
                    if "bad_width" in seen:
                        continue
                    seen.add("bad_width")
                    errors.append(err)
                    continue
                err = dict(err)
                err["side"] = side
                err["message"] = _SIDE_LABEL[side] + err["message"]
                errors.append(err)

    if errors:
        raise ValidationError(errors)


def _iter_candidate_pairs(front_pts: list[Dot], bx: list[int], by: list[int],
                          back_pts: list[Dot]):
    """front_pts 与已镜像的反面点 (bx[i], by[i]) 间，基础坐标差
    绝对值均 <= PAIR_BOUND 的候选点对。

    产出 (front Dot, back Dot, back 下标, dx0, dy0)。反面点 y 坐标只有
    100r、100r+25、100r+50 三种，与某个正面点 y 差绝对值 <= 59 的反面 y
    只可能是 yf-50、yf-25、yf、yf+25、yf+50 五个桶。
    """
    buckets: dict[int, list[tuple[int, int]]] = {}
    for i, bp in enumerate(back_pts):
        buckets.setdefault(by[i], []).append((i, bx[i]))

    for fp in front_pts:
        for dy0 in (-50, -25, 0, 25, 50):
            for i, X in buckets.get(fp.y + dy0, ()):
                dx0 = X - fp.x
                if -PAIR_BOUND <= dx0 <= PAIR_BOUND:
                    yield fp, back_pts[i], i, dx0, dy0


def _mirror(back_pts: list[Dot], width: int) -> tuple[list[int], list[int]]:
    """反面本面坐标 -> 正面坐标系下的镜像坐标（不含位移），单位 0.1 mm。"""
    m = 60 * (width - 1) + 25
    bx = [m - p.x for p in back_pts]
    by = [p.y for p in back_pts]
    return bx, by


def count_shifts(front_pts: list[Dot], back_pts: list[Dot], width: int,
                 tenths: int) -> list[list[int]]:
    """统计 61×61 个位移各自的冲突对数（差分表实现）。

    对候选点对与每个 dy 位移 b，满足距离阈值的 dx 位移 a 是一个连续
    整数区间，用按行差分累加，避免逐个 (a, b) 做平方比较。
    """
    bx, by = _mirror(back_pts, width)
    t2 = tenths * tenths

    # 每行 61 格 +1 结束标记
    diff = [0] * (SHIFT_LEVELS * (SHIFT_LEVELS + 1))
    isqrt = math.isqrt

    for _fp, _bp, _i, dx0, dy0 in _iter_candidate_pairs(
        front_pts, bx, by, back_pts
    ):
        # |dy0+b| < tenths 才有解，只遍历与该 y 差相交的 b 区间
        blo = max(SHIFT_MIN, -tenths - dy0 + 1)
        bhi = min(SHIFT_MAX, tenths - dy0 - 1)
        for b in range(blo, bhi + 1):
            ry2 = t2 - (dy0 + b) * (dy0 + b)
            rx = isqrt(ry2 - 1)  # (dx0+a)^2 <= ry2-1 < t2-(dy0+b)^2
            lo = max(SHIFT_MIN, -dx0 - rx)
            hi = min(SHIFT_MAX, -dx0 + rx)
            if lo > hi:
                continue
            row_base = (b - SHIFT_MIN) * (SHIFT_LEVELS + 1)
            diff[row_base + lo - SHIFT_MIN] += 1
            diff[row_base + hi - SHIFT_MIN + 1] -= 1

    counts = [[0] * SHIFT_LEVELS for _ in range(SHIFT_LEVELS)]
    for bi in range(SHIFT_LEVELS):
        base = bi * (SHIFT_LEVELS + 1)
        run = 0
        for ai in range(SHIFT_LEVELS):
            run += diff[base + ai]
            counts[bi][ai] = run
    return counts


def solve_avoidance(front_pts: list[Dot], back_pts: list[Dot], width: int,
                    tenths: int) -> dict:
    """统计全部位移并择优，返回原始（0.1 mm 整数）结果。"""
    counts = count_shifts(front_pts, back_pts, width, tenths)

    best_key = None
    best_a = best_b = 0
    for bi in range(SHIFT_LEVELS):
        b = SHIFT_MIN + bi
        for ai in range(SHIFT_LEVELS):
            a = SHIFT_MIN + ai
            key = (counts[bi][ai], a * a + b * b, a, b)
            if best_key is None or key < best_key:
                best_key = key
                best_a, best_b = a, b

    # 在最佳位移下回收全部冲突点对
    t2 = tenths * tenths
    bx, by = _mirror(back_pts, width)
    conflicts: list[dict] = []
    for fp, bp, i, dx0, dy0 in _iter_candidate_pairs(front_pts, bx, by, back_pts):
        ddx = dx0 + best_a
        ddy = dy0 + best_b
        d2 = ddx * ddx + ddy * ddy
        if d2 < t2:
            conflicts.append({
                "front": fp,
                "back": bp,
                "fx": fp.x, "fy": fp.y,
                "bx": bx[i] + best_a,
                "by": by[i] + best_b,
                "d2": d2,
            })

    conflicts.sort(key=lambda c: (
        c["front"].r, c["front"].c, c["front"].dot,
        c["back"].r, c["back"].c, c["back"].dot,
    ))

    return {
        "a": best_a,
        "b": best_b,
        "count": best_key[0],
        "counts": counts,
        "conflicts": conflicts,
    }


def _to_tenths(min_distance) -> int:
    """把一位小数的毫米值换算为 0.1 毫米整数；非法抛 ValidationError。"""
    if isinstance(min_distance, bool) or not isinstance(min_distance, (int, float)):
        raise ValidationError([{
            "code": "bad_min_distance",
            "message": "最小点距必须为 0.1～3.0 之间的数字（毫米）。",
        }])
    value = float(min_distance)
    if not math.isfinite(value):
        raise ValidationError([{
            "code": "bad_min_distance",
            "message": "最小点距必须为有限数字。",
        }])
    tenths = round(value * 10)
    if abs(value * 10 - tenths) > 1e-7:
        raise ValidationError([{
            "code": "bad_min_distance",
            "message": "最小点距限一位小数（毫米）。",
        }])
    return tenths


def _point_view(p: Dot) -> dict:
    return {"row": p.r, "col": p.c, "dot": p.dot,
            "x": p.x / 10, "y": p.y / 10}


def avoid(front: str, back: str, width, min_distance=1.5) -> dict:
    """双面点阵避让主入口：校验、排版、找点、择优并组织前端结果。"""
    tenths = _to_tenths(min_distance)
    _validate_inputs(front, back, width, tenths)

    ts_front = typeset(front, width)
    ts_back = typeset(back, width)
    fp = extract_points(ts_front)
    bp = extract_points(ts_back)

    solved = solve_avoidance(fp, bp, width, tenths)
    a, b = solved["a"], solved["b"]
    m = 60 * (width - 1) + 25

    # 反面凸点在最佳位移下映射到正面坐标系的位置（毫米）
    back_view = []
    for p in bp:
        back_view.append({
            "row": p.r, "col": p.c, "dot": p.dot,
            "x": (m - p.x + a) / 10, "y": (p.y + b) / 10,
        })

    conflict_view = []
    for c in solved["conflicts"]:
        f, bk = c["front"], c["back"]
        conflict_view.append({
            "front": {
                "side": "front", "row": f.r, "col": f.c, "dot": f.dot,
                "x": f.x / 10, "y": f.y / 10,
            },
            "back": {
                "side": "back", "row": bk.r, "col": bk.c, "dot": bk.dot,
                "x": (m - bk.x + a) / 10, "y": (bk.y + b) / 10,
            },
            "distance_mm": round(math.sqrt(c["d2"]) / 10, 2),
        })

    count = solved["count"]
    return {
        "width": width,
        "min_distance": tenths / 10,
        "evaluated": EVALUATED,
        "grid": {
            "cols": width,
            "front_rows": ts_front["total_lines"],
            "back_rows": ts_back["total_lines"],
        },
        "shift": {"dx": a / 10, "dy": b / 10},
        "conflict_count": count,
        "feasible": count == 0,
        "front": {
            "typeset": ts_front,
            "point_count": len(fp),
            "points": [_point_view(p) for p in fp],
        },
        "back": {
            "typeset": ts_back,
            "point_count": len(bp),
            "points": back_view,
        },
        "conflicts": conflict_view,
    }
