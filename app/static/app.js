/* 六点盲文排版台 — 前端逻辑（原生 JS，无外部依赖，可离线） */
"use strict";

const $ = (sel) => document.querySelector(sel);

/* ---------------- 视图切换 ---------------- */

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    $("#view-typeset").hidden = btn.dataset.view !== "typeset";
    $("#view-decode").hidden = btn.dataset.view !== "decode";
  });
});

/* ---------------- 共用：错误展示与复制 ---------------- */

function showErrors(box, panel, input, errors) {
  panel.hidden = true;
  box.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = `发现 ${errors.length} 处问题，请修正后重试：`;
  box.appendChild(h);
  const ul = document.createElement("ul");
  for (const err of errors) {
    const li = document.createElement("li");
    li.textContent = err.message;
    if (typeof err.pos === "number") {
      li.title = "点击定位到输入位置";
      li.addEventListener("click", () => {
        input.focus();
        input.setSelectionRange(err.pos, err.pos + (err.length || 1));
      });
    }
    ul.appendChild(li);
  }
  box.appendChild(ul);
  box.hidden = false;
}

async function copyText(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "已复制 ✓";
    setTimeout(() => (btn.textContent = old), 1500);
  } catch (e) {
    // 退化方案
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/* ---------------- 盲文排版视图 ---------------- */

const els = {
  input: $("#srcInput"),
  width: $("#widthInput"),
  count: $("#charCount"),
  btn: $("#btnTypeset"),
  btnSample: $("#btnSample"),
  btnClear: $("#btnClear"),
  errors: $("#errorBox"),
  panel: $("#resultPanel"),
  lines: $("#linesContainer"),
  stats: $("#statsBar"),
  download: $("#btnDownload"),
  copy: $("#btnCopy"),
};

let lastResult = null;

/* ---------------- 计数与校验 ---------------- */

function updateCount() {
  const n = els.input.value.length;
  els.count.textContent = String(n);
  els.count.parentElement.classList.toggle("over", n > 500);
}

els.input.addEventListener("input", updateCount);

/* ---------------- 发起排版 ---------------- */

async function doTypeset() {
  const text = els.input.value;
  const width = Number(els.width.value);

  // 前端即时校验（最终以服务端为准）
  const local = [];
  if (!/^[\x20\nA-Za-z0-9]*$/.test(text)) {
    local.push("含非法字符：仅允许 ASCII 字母、数字、空格与换行。");
  }
  if (text.length > 500) local.push("输入超过 500 个字符。");
  if (!/[A-Za-z0-9]/.test(text)) local.push("至少需要包含一个字母或数字。");
  if (!Number.isInteger(width) || width < 10 || width > 40) {
    local.push("每行格数须为 10～40 的整数。");
  }
  if (local.length) {
    showErrors(els.errors, els.panel, els.input, [{ message: local.join("\n") }]);
    return;
  }

  els.btn.disabled = true;
  try {
    const resp = await fetch("/api/typeset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, width }),
    });
    const data = await resp.json();
    if (!resp.ok || data.ok === false) {
      showErrors(els.errors, els.panel, els.input,
        data.errors || [{ message: "排版失败。" }]);
      return;
    }
    els.errors.hidden = true;
    renderResult(data);
  } catch (e) {
    showErrors(els.errors, els.panel, els.input, [{ message: "请求失败：" + e }]);
  } finally {
    els.btn.disabled = false;
  }
}

/* ---------------- 渲染盲文格 ---------------- */

// 点号 1..6 对应网格位置（左列 1/2/3，右列 4/5/6）
const DOT_ORDER = [1, 4, 2, 5, 3, 6];

function makeCell(cell) {
  const d = document.createElement("div");
  d.className = "cell " + cell.kind;

  const grid = document.createElement("div");
  grid.className = "dotgrid";
  const on = new Set(cell.dots);
  for (const dot of DOT_ORDER) {
    const s = document.createElement("span");
    s.className = "dot" + (on.has(dot) ? " on" : "");
    grid.appendChild(s);
  }
  d.appendChild(grid);

  if (cell.kind !== "space") {
    const u = document.createElement("span");
    u.className = "uni";
    u.textContent = cell.text;
    d.appendChild(u);
  }

  d.title = cell.note;
  return d;
}

function renderSourceLine(source) {
  // 原文行：空格淡化，行尾断词连字符高亮
  const div = document.createElement("div");
  div.className = "src-line";
  for (const ch of source) {
    const span = document.createElement("span");
    if (ch === " ") {
      span.className = "src-gap";
      span.textContent = "·";
    } else if (ch === "-") {
      span.className = "src-hyphen";
      span.textContent = "-";
    } else {
      span.textContent = ch;
    }
    div.appendChild(span);
  }
  return div;
}

function renderResult(r) {
  lastResult = r;
  els.panel.hidden = false;
  els.lines.innerHTML = "";
  els.stats.innerHTML = "";

  // 统计
  const stats = [
    `行宽：<b>${r.width}</b> 格`,
    `硬分段：<b>${r.paragraphs}</b> 段`,
    `共 <b>${r.total_lines}</b> 行`,
    `超宽词断词：<b>${r.breaks}</b> 次`,
    `数字续行重加标记：<b>${r.number_reopened}</b> 次`,
  ];
  els.stats.innerHTML = stats.map((s) => `<span>${s}</span>`).join("");

  for (const line of r.lines) {
    const row = document.createElement("div");
    row.className = "line-row";

    const no = document.createElement("div");
    no.className = "line-no";
    no.textContent = line.blank ? "" : String(line.index);

    const body = document.createElement("div");
    body.className = "line-body" + (line.blank ? " blank" : "");

    if (line.blank) {
      body.appendChild(document.createTextNode("（空段）"));
    } else {
      body.appendChild(renderSourceLine(line.source));

      const cells = document.createElement("div");
      cells.className = "cells";
      for (const c of line.cells) cells.appendChild(makeCell(c));
      body.appendChild(cells);

      const rem = document.createElement("div");
      rem.className = "remain";
      const pct = Math.round((line.used / r.width) * 100);
      rem.innerHTML =
        `用 ${line.used} 格 · 余 ${line.remain} 格` +
        `<span class="rail"><span class="fill" style="width:${pct}%"></span></span>`;
      body.appendChild(rem);
    }

    row.appendChild(no);
    row.appendChild(body);
    els.lines.appendChild(row);
  }

  els.panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- 下载与复制 ---------------- */

function downloadBraille() {
  if (!lastResult) return;
  // 加 BOM，保证 Windows 记事本等工具正确识别 UTF-8
  const blob = new Blob(["﻿" + lastResult.braille_text], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "braille.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

els.btn.addEventListener("click", doTypeset);
els.download.addEventListener("click", downloadBraille);
els.copy.addEventListener("click", () => {
  if (lastResult) copyText(els.copy, lastResult.braille_text);
});

els.btnClear.addEventListener("click", () => {
  els.input.value = "";
  updateCount();
  els.errors.hidden = true;
  els.panel.hidden = true;
  els.input.focus();
});

els.btnSample.addEventListener("click", () => {
  els.input.value =
`Hello Braille
The quick brown fox
2026 007`;
  els.width.value = 16;
  updateCount();
  doTypeset();
});

els.input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    doTypeset();
  }
});

updateCount();

/* ---------------- 盲文识读视图 ---------------- */

const dec = {
  input: $("#decInput"),
  count: $("#decCellCount"),
  btn: $("#btnDecode"),
  btnSample: $("#btnDecSample"),
  btnClear: $("#btnDecClear"),
  errors: $("#decErrorBox"),
  panel: $("#decResultPanel"),
  stats: $("#decStatsBar"),
  output: $("#decOutput"),
  copy: $("#btnDecCopy"),
};

let lastDecode = null;

// 计数只算盲文格（U+2800～U+28FF），换行不占格
const countCells = (s) => (s.match(/[\u2800-\u28FF]/g) || []).length;
function updateDecCount() {
  const n = countCells(dec.input.value);
  dec.count.textContent = String(n);
  dec.count.parentElement.classList.toggle("over", n > 500);
}

dec.input.addEventListener("input", updateDecCount);

async function doDecode() {
  const text = dec.input.value;

  // 前端即时校验（最终以服务端为准）
  const local = [];
  if (!text) local.push("请输入盲文。");
  if (countCells(text) > 500) local.push("盲文超过 500 格。");
  if (/[^\u2800-\u28FF\n\r]/.test(text)) {
    local.push("含非法字符：仅允许 Unicode 六点盲文、盲文空格（U+2800）与换行。");
  }
  if (local.length) {
    showErrors(dec.errors, dec.panel, dec.input, [{ message: local.join("\n") }]);
    return;
  }

  dec.btn.disabled = true;
  try {
    const resp = await fetch("/api/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await resp.json();
    if (!resp.ok || data.ok === false) {
      showErrors(dec.errors, dec.panel, dec.input,
        data.errors || [{ message: "识读失败。" }]);
      return;
    }
    dec.errors.hidden = true;
    renderDecode(data);
  } catch (e) {
    showErrors(dec.errors, dec.panel, dec.input, [{ message: "请求失败：" + e }]);
  } finally {
    dec.btn.disabled = false;
  }
}

function renderDecode(r) {
  lastDecode = r;
  dec.panel.hidden = false;
  dec.stats.innerHTML = [
    `盲文 <b>${r.cells}</b> 格`,
    `结果 <b>${r.chars}</b> 字符`,
    `共 <b>${r.lines}</b> 行`,
  ].map((s) => `<span>${s}</span>`).join("");
  dec.output.textContent = r.text;
  dec.panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

dec.btn.addEventListener("click", doDecode);
dec.copy.addEventListener("click", () => {
  if (lastDecode) copyText(dec.copy, lastDecode.text);
});

dec.btnClear.addEventListener("click", () => {
  dec.input.value = "";
  updateDecCount();
  dec.errors.hidden = true;
  dec.panel.hidden = true;
  dec.input.focus();
});

dec.btnSample.addEventListener("click", () => {
  dec.input.value =
`⠠⠓⠑⠇⠇⠕⠀⠠⠃⠗⠁⠊⠇⠇⠑
⠼⠃⠚⠃⠋⠀⠁⠃⠉⠙⠑⠤
⠋⠛⠓`;
  updateDecCount();
  doDecode();
});

dec.input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    doDecode();
  }
});

updateDecCount();
