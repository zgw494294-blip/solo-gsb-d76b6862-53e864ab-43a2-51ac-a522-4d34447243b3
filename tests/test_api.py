"""FastAPI 接口层测试。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_index_and_assets_served():
    assert client.get("/").status_code == 200
    assert client.get("/static/style.css").status_code == 200
    assert client.get("/static/app.js").status_code == 200


def test_typeset_ok():
    resp = client.post("/api/typeset", json={"text": "ab", "width": 10})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["braille_text"] == "⠁⠃"
    assert data["lines"][0]["cells"][0]["dots"] == [1]


def test_typeset_illegal_char_is_located():
    resp = client.post("/api/typeset", json={"text": "ab\tc", "width": 10})
    assert resp.status_code == 422
    data = resp.json()
    assert data["ok"] is False
    err = next(e for e in data["errors"] if e["code"] == "illegal_char")
    assert (err["line"], err["col"]) == (1, 3)


def test_typeset_mixed_word():
    resp = client.post("/api/typeset", json={"text": "ab1", "width": 10})
    assert resp.status_code == 422
    codes = {e["code"] for e in resp.json()["errors"]}
    assert "mixed_word" in codes


def test_typeset_bad_width():
    resp = client.post("/api/typeset", json={"text": "abc", "width": 41})
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["code"] == "bad_width"


def test_typeset_missing_field():
    resp = client.post("/api/typeset", json={"text": "abc"})
    assert resp.status_code == 422
    assert resp.json()["ok"] is False


def test_typeset_too_long():
    resp = client.post("/api/typeset", json={"text": "a" * 501, "width": 10})
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["code"] == "too_long"


def test_decode_ok():
    resp = client.post("/api/decode", json={"text": "⠠⠓⠑⠇⠇⠕⠀⠼⠃⠚⠃⠋"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["text"] == "Hello 2026"
    assert data["cells"] == 12


def test_decode_error_located_and_no_partial_text():
    resp = client.post("/api/decode", json={"text": "⠁⠃\n⠿"})
    assert resp.status_code == 422
    data = resp.json()
    assert data["ok"] is False
    assert "text" not in data  # 不输出部分解读文本
    err = data["errors"][0]
    assert err["code"] == "undefined_cell"
    assert (err["line"], err["col"]) == (2, 1)


def test_decode_bad_digit_continuation():
    resp = client.post("/api/decode", json={"text": "⠼⠁⠤\n⠃"})
    assert resp.status_code == 422
    codes = {e["code"] for e in resp.json()["errors"]}
    assert "bad_digit_continuation" in codes


@pytest.mark.parametrize("src,code,line,col", [
    ("⠁⠼⠃", "number_sign_in_word", 1, 2),       # 字母词内的数字标记
    ("⠤\n⠁", "hyphen_no_word", 1, 1),             # 行首断词标记前无未结束词
    ("⠁⠤\n⠼⠃", "break_kind_mismatch", 2, 1),  # 字母词断行后续数字词
])
def test_decode_illegal_word_boundary(src, code, line, col):
    resp = client.post("/api/decode", json={"text": src})
    assert resp.status_code == 422
    data = resp.json()
    assert data["ok"] is False
    assert "text" not in data  # 整体失败，不返回部分文本
    err = next(e for e in data["errors"] if e["code"] == code)
    assert (err["line"], err["col"]) == (line, col)


def test_decode_valid_break_continuation_ok():
    resp = client.post("/api/decode", json={"text": "⠁⠃⠉⠤\n⠙⠑"})
    assert resp.status_code == 200
    assert resp.json()["text"] == "abcde"


def test_decode_missing_field():
    resp = client.post("/api/decode", json={})
    assert resp.status_code == 422
    assert resp.json()["ok"] is False


def test_decode_too_long():
    resp = client.post("/api/decode", json={"text": "⠁" * 501})
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["code"] == "too_long"
