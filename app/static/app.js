/* 六点盲文排版台 — 前端逻辑（原生 JS，无外部依赖，可离线） */
"use strict";

const $ = (sel) => document.querySelector(sel);

/* ---------------- 视图切换 ---------------- */

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    document.querySelectorAll(".view").forEach((v) => {
      v.hidden = v.id !== "view-" + view;
    });
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

/* ---------------- 双面点阵避让视图 ---------------- */

const av = {
  front: $("#avFrontInput"),
  back: $("#avBackInput"),
  frontCount: $("#avFrontCount"),
  backCount: $("#avBackCount"),
  width: $("#avWidthInput"),
  dist: $("#avDistInput"),
  btn: $("#btnAvoid"),
  btnSample: $("#btnAvSample"),
  btnClear: $("#btnAvClear"),
  errors: $("#avErrorBox"),
  panel: $("#avResultPanel"),
  verdict: $("#avVerdict"),
  stats: $("#avStatsBar"),
  overlayWrap: $("#avOverlayWrap"),
  conflictWrap: $("#avConflictWrap"),
  frontLines: $("#avFrontLines"),
  backLines: $("#avBackLines"),
};

let lastAvoid = null;

function updateAvCount(which) {
  const n = which.input.value.length;
  which.countEl.textContent = String(n);
  which.countEl.parentElement.classList.toggle("over", n > 500);
}
av.front.addEventListener("input", () =>
  updateAvCount({ input: av.front, countEl: av.frontCount }));
av.back.addEventListener("input", () =>
  updateAvCount({ input: av.back, countEl: av.backCount }));

function showAvoidErrors(errors) {
  av.panel.hidden = true;
  av.errors.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = `发现 ${errors.length} 处问题，请修正后重试：`;
  av.errors.appendChild(h);
  const ul = document.createElement("ul");
  for (const err of errors) {
    const li = document.createElement("li");
    li.textContent = err.message;
    if (typeof err.pos === "number") {
      const input = err.side === "back" ? av.back : av.front;
      li.title = `点击定位到${err.side === "back" ? "反面" : "正面"}输入位置`;
      li.addEventListener("click", () => {
        input.focus();
        input.setSelectionRange(err.pos, err.pos + (err.length || 1));
      });
    }
    ul.appendChild(li);
  }
  av.errors.appendChild(ul);
  av.errors.hidden = false;
}

async function doAvoid() {
  const front = av.front.value;
  const back = av.back.value;
  const width = Number(av.width.value);
  const dist = Number(av.dist.value);

  const local = [];
  for (const [name, text] of [["正面", front], ["反面", back]]) {
    if (!/^[\x20\nA-Za-z0-9]*$/.test(text)) {
      local.push(`${name}含非法字符：仅允许 ASCII 字母、数字、空格与换行。`);
    }
    if (!/[A-Za-z0-9]/.test(text)) local.push(`${name}至少需要包含一个字母或数字。`);
  }
  if (!Number.isInteger(width) || width < 10 || width > 40) {
    local.push("共同行宽须为 10～40 的整数。");
  }
  if (!Number.isFinite(dist) || dist < 0.1 || dist > 3.0 ||
      Math.abs(Math.round(dist * 10) - dist * 10) > 1e-6) {
    local.push("最小点距须为 0.1～3.0 之间且只有一位小数（毫米）。");
  }
  if (local.length) {
    showAvoidErrors([{ message: local.join("\n") }]);
    return;
  }

  av.btn.disabled = true;
  try {
    const resp = await fetch("/api/avoid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front, back, width, min_distance: dist }),
    });
    const data = await resp.json();
    if (!resp.ok || data.ok === false) {
      showAvoidErrors(data.errors || [{ message: "计算失败。" }]);
      return;
    }
    av.errors.hidden = true;
    renderAvoid(data);
  } catch (e) {
    showAvoidErrors([{ message: "请求失败：" + e }]);
  } finally {
    av.btn.disabled = false;
  }
}

/* ---------- 叠加点阵 SVG（坐标单位毫米，等比放大） ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";
const SCALE = 4;  // 1 毫米 = 4 像素

function svgEl(tag, attrs, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function pointKey(p) {
  return `${p.row}-${p.col}-${p.dot}`;
}

function buildOverlay(r) {
  const w = r.width;
  const rows = Math.max(r.grid.front_rows, r.grid.back_rows);
  const frontPts = r.front.points;
  const backPts = r.back.points;
  const all = frontPts.concat(backPts);

  // 内容包围盒（毫米），含位移越界，留 2mm 边距
  let minX = Math.min(...all.map((p) => p.x)) - 2;
  let maxX = Math.max(...all.map((p) => p.x)) + 2;
  let minY = Math.min(...all.map((p) => p.y)) - 2;
  let maxY = Math.max(...all.map((p) => p.y)) + 2;
  // 网格本身的范围也纳入（正品格区 0～6w、0～10·行数）
  minX = Math.min(minX, -1); maxX = Math.max(maxX, 6 * w + 1);
  minY = Math.min(minY, -1); maxY = Math.max(maxY, 10 * rows + 1);

  const vbW = maxX - minX;
  const vbH = maxY - minY;
  const svg = svgEl("svg", {
    class: "av-svg",
    viewBox: `${minX} ${minY} ${vbW} ${vbH}`,
    width: Math.round(vbW * SCALE),
    height: Math.round(vbH * SCALE),
  });

  // 行格引导线：竖线每 6mm、横线每 10mm
  const gGrid = svgEl("g", { class: "av-grid" });
  for (let c = 0; c <= w; c++) {
    gGrid.appendChild(svgEl("line", {
      x1: 6 * c, y1: 0, x2: 6 * c, y2: 10 * rows,
    }));
  }
  for (let rr = 0; rr <= rows; rr++) {
    gGrid.appendChild(svgEl("line", {
      x1: 0, y1: 10 * rr, x2: 6 * w, y2: 10 * rr,
    }));
  }
  svg.appendChild(gGrid);

  // 冲突连线（画在点下面）
  const gLinks = svgEl("g", { class: "av-links" });
  r.conflicts.forEach((cf, i) => {
    gLinks.appendChild(svgEl("line", {
      "data-ci": i,
      x1: cf.front.x, y1: cf.front.y,
      x2: cf.back.x, y2: cf.back.y,
    }));
  });
  svg.appendChild(gLinks);

  const conflictFront = new Set(r.conflicts.map((cf) => pointKey(cf.front)));
  const conflictBack = new Set(r.conflicts.map((cf) => pointKey(cf.back)));
  const frontByKey = new Map();
  const backByKey = new Map();

  function drawDots(points, cls, keyMap, conflictKeys) {
    const g = svgEl("g", { class: "av-dots " + cls });
    for (const p of points) {
      const key = pointKey(p);
      const hit = conflictKeys.has(key);
      const c = svgEl("circle", {
        cx: p.x, cy: p.y,
        r: hit ? 1.15 : 0.8,
        class: hit ? "conflict-dot" : "",
        "data-key": key,
      });
      c.appendChild(svgEl("title", {},
        `${cls.includes("front") ? "正面" : "反面"} 行${p.row} 格${p.col} 点${p.dot}` +
        `（${p.x.toFixed(1)}, ${p.y.toFixed(1)} mm）`));
      g.appendChild(c);
      keyMap.set(key, c);
    }
    svg.appendChild(g);
  }

  drawDots(frontPts, "front-dots", frontByKey, conflictFront);
  drawDots(backPts, "back-dots", backByKey, conflictBack);

  return { svg, frontByKey, backByKey };
}

function endpointDesc(e) {
  return `${e.side === "front" ? "正面" : "反面"} 行${e.row}·格${e.col}·点${e.dot}`;
}

function renderAvoid(r) {
  lastAvoid = r;
  av.panel.hidden = false;

  const shiftText = `dx = <b>${r.shift.dx.toFixed(1)}</b> mm，dy = <b>${r.shift.dy.toFixed(1)}</b> mm`;
  if (r.feasible) {
    av.verdict.className = "av-verdict ok";
    av.verdict.innerHTML =
      `✅ <b>可行</b>：遍历全部 ${r.evaluated} 个位移后，` +
      `最佳位移（${shiftText}）下<b>零冲突</b>。`;
  } else {
    av.verdict.className = "av-verdict bad";
    av.verdict.innerHTML =
      `⚠️ <b>仍有冲突</b>：遍历全部 ${r.evaluated} 个位移后，` +
      `冲突最少的位移（${shiftText}）下仍有 <b>${r.conflict_count}</b> 对点距小于 ` +
      `<b>${r.min_distance.toFixed(1)}</b> mm；其下依次按 dx²+dy²、dx、dy 最小择优。`;
  }

  av.stats.innerHTML = [
    `共同行宽：<b>${r.width}</b> 格`,
    `最小点距：<b>${r.min_distance.toFixed(1)}</b> mm`,
    `遍历位移：<b>${r.evaluated}</b> 个`,
    `冲突对数：<b>${r.conflict_count}</b>`,
    `正面：<b>${r.front.point_count}</b> 凸点 / ${r.grid.front_rows} 行`,
    `反面：<b>${r.back.point_count}</b> 凸点 / ${r.grid.back_rows} 行`,
  ].map((s) => `<span>${s}</span>`).join("");

  // 叠加图
  av.overlayWrap.innerHTML = "";
  const { svg, frontByKey, backByKey } = buildOverlay(r);
  av.overlayWrap.appendChild(svg);

  // 冲突列表
  av.conflictWrap.innerHTML = "";
  if (r.feasible) {
    const div = document.createElement("div");
    div.className = "av-no-conflict";
    div.textContent = "无冲突点对。";
    av.conflictWrap.appendChild(div);
  } else {
    const table = document.createElement("table");
    table.className = "av-conflict-table";
    table.innerHTML =
      "<thead><tr><th>#</th><th>正面端点（面·行·格·点）</th>" +
      "<th>反面端点（面·行·格·点）</th><th>点距 mm</th></tr></thead>";
    const tbody = document.createElement("tbody");
    r.conflicts.forEach((cf, i) => {
      const tr = document.createElement("tr");
      tr.dataset.ci = i;
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td>${endpointDesc(cf.front)}</td>` +
        `<td>${endpointDesc(cf.back)}</td>` +
        `<td>${cf.distance_mm.toFixed(2)}</td>`;
      const highlight = (on) => {
        for (const [keyMap, key] of [
          [frontByKey, pointKey(cf.front)],
          [backByKey, pointKey(cf.back)],
        ]) {
          const c = keyMap.get(key);
          if (c) c.classList.toggle("hl", on);
        }
        const line = svg.querySelector(`.av-links line[data-ci="${i}"]`);
        if (line) line.classList.toggle("hl", on);
      };
      tr.addEventListener("mouseenter", () => highlight(true));
      tr.addEventListener("mouseleave", () => highlight(false));
      tr.addEventListener("click", () =>
        av.overlayWrap.scrollIntoView({ behavior: "smooth", block: "center" }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    av.conflictWrap.appendChild(table);
  }

  // 两面排版明细（复用 makeCell / renderSourceLine）
  renderMiniTypeset(av.frontLines, r.front.typeset);
  renderMiniTypeset(av.backLines, r.back.typeset);

  av.panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMiniTypeset(container, ts) {
  container.innerHTML = "";
  for (const line of ts.lines) {
    const row = document.createElement("div");
    row.className = "av-mini-row";
    if (line.blank) {
      row.appendChild(document.createTextNode(`（第 ${line.index} 行：空段）`));
    } else {
      const meta = document.createElement("div");
      meta.className = "av-mini-meta";
      meta.textContent = `第 ${line.index} 行 · 用 ${line.used}/${ts.width} 格`;
      row.appendChild(meta);
      row.appendChild(renderSourceLine(line.source));
      const cells = document.createElement("div");
      cells.className = "cells";
      for (const c of line.cells) cells.appendChild(makeCell(c));
      row.appendChild(cells);
    }
    container.appendChild(row);
  }
}

av.btn.addEventListener("click", doAvoid);

av.btnClear.addEventListener("click", () => {
  av.front.value = "";
  av.back.value = "";
  updateAvCount({ input: av.front, countEl: av.frontCount });
  updateAvCount({ input: av.back, countEl: av.backCount });
  av.errors.hidden = true;
  av.panel.hidden = true;
  av.front.focus();
});

av.btnSample.addEventListener("click", () => {
  av.front.value =
`Hello Braille
The quick brown fox
2026`;
  av.back.value =
`Braille reading
helps everyone
2026`;
  av.width.value = 16;
  av.dist.value = 1.5;
  updateAvCount({ input: av.front, countEl: av.frontCount });
  updateAvCount({ input: av.back, countEl: av.backCount });
  doAvoid();
});

for (const ta of [av.front, av.back]) {
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      doAvoid();
    }
  });
}

updateAvCount({ input: av.front, countEl: av.frontCount });
updateAvCount({ input: av.back, countEl: av.backCount });
