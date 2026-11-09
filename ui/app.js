// TimeSeen 网页界面：今天、日总结、规矩、待办／备忘、设置。纯 JS，不用打包工具。
// 取数：Tauri 里用 window.__TAURI__.core.invoke（命令见 app/src-tauri/COMMANDS.md）；
// 浏览器里读 mock/<命令名>.json（双击 file:// 打开时改读 mock/mock.js）。
// 作息图、一天的形状、读数的画法取自 网站/static/app.js（设计系统「人生记录」）。

const $app = document.getElementById("app");
const TAURI = window.__TAURI__ && window.__TAURI__.core;
// ---------- 取数 ----------

let MOCK = null;
const mockState = {};

async function loadMock(name) {
  if (location.protocol !== "file:") {
    try {
      const r = await fetch(`mock/${name}.json`, { cache: "no-cache" });
      if (r.ok) return r.json();
    } catch (e) { /* 退回 mock.js */ }
  }
  if (!MOCK) {
    await new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "mock/mock.js"; s.onload = ok; s.onerror = () => fail(new Error("读不到 mock/mock.js，先跑 mock/make_mock.py"));
      document.head.appendChild(s);
    });
    MOCK = window.TIMESEEN_MOCK;
  }
  return JSON.parse(JSON.stringify(MOCK[name]));
}

// 耗时记录（只在测试版写 snapshots/perf.txt）：命令超过 80 毫秒、切页超过 300 毫秒就记一行，慢了好查
const PERF = { lines: [], timer: null };
function perfNote(line) {
  if (!TAURI) return;
  PERF.lines.push(`${new Date().toTimeString().slice(0, 8)} ${line}`);
  if (PERF.lines.length > 200) PERF.lines.shift();
  clearTimeout(PERF.timer);
  PERF.timer = setTimeout(() => { try { TAURI.invoke("dev_report", { name: "perf", text: PERF.lines.join("\n") }).catch(() => {}); } catch (e) {} }, 500);
}

async function call(cmd, args = {}) {
  if (TAURI) {
    const t0 = performance.now();
    try { return await TAURI.invoke(cmd, args); }
    finally { const ms = performance.now() - t0; if (ms > 80 && cmd !== "dev_report") perfNote(`call ${cmd} ${Math.round(ms)}ms`); }
  }
  // 浏览器里：写操作只改内存，读操作读样例
  if (cmd.includes("focus")) return window.TimeSeenFocusDemo.call(cmd, args);
  switch (cmd) {
    case "save_rules": mockState.rules = args.rules; return null;
    case "save_todos": mockState.todos = args.todos; return null;
    case "save_memos": mockState.memos = args.memos; return null;
    case "save_plan": mockState.plan = args.plan; return null;
    case "get_plan": return mockState.plan || { days: {}, week: null, nudges: {} };
    case "rule_history": return { dates: [], rules: [] };
    case "get_week": return { start: localDay(), end: localDay(), projects: [], rules: [], items: [] };
    case "save_settings": mockState.settings = { ...(mockState.settings || await loadMock("get_settings")), ...args.settings }; return null;
    case "set_api_key": mockState.hasKey = true; return null;
    case "list_models": return ["gpt-4.1-mini", "gpt-4.1", "deepseek-chat", "qwen-plus", "glm-4.5", "demo-unavailable"];
    case "test_models": return args.models.map((model) => ({ model, ok: model !== "demo-unavailable", ms: 320, ...(model === "demo-unavailable" ? { error: "样例：此模型暂不可用" } : {}) }));
    case "set_paused": mockState.paused = args.paused; return null;
    case "open_permission": case "open_data_dir": console.info(`样例模式：${cmd}`, args); return null;
    case "get_rules": return mockState.rules || loadMock("get_rules");
    case "get_todos": return mockState.todos || loadMock("get_todos");
    case "get_memos": return mockState.memos || loadMock("get_memos");
    case "get_settings": {
      const s = mockState.settings || await loadMock("get_settings");
      if (mockState.hasKey) s.has_api_key = true;
      return s;
    }
    case "get_status": {
      const s = await loadMock("get_status");
      if (mockState.paused !== undefined) s.paused = mockState.paused;
      return s;
    }
    case "get_day": return (await loadMock("get_day"))[args.date] || null;
    default: return loadMock(cmd);
  }
}

// ---------- 小工具 ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hh = (sec) => (sec == null ? "—" : (sec / 3600).toFixed(1));
const mins = (sec) => (sec == null ? "—" : String(Math.round(sec / 60)));
// 时间都按这台电脑的本地时区显示（以前写死了东八区）
const pad2 = (n) => String(n).padStart(2, "0");
const toDate = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd); };
const weekday = (d) => "周" + "日一二三四五六"[toDate(d).getDay()];
const short = (d) => `${d.slice(5)} ${weekday(d)}`;
const localDay = (t = new Date()) => `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
const hm = (iso) => { if (!iso) return ""; const t = new Date(iso); return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`; };
const mdhm = (iso) => { if (!iso) return ""; const t = new Date(iso); return `${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${hm(iso)}`; };
/** 带完整年月日的时刻（墨线文案：「同步至 2026-10-22 09:27」） */
const ymdhm = (iso) => { if (!iso) return ""; const t = new Date(iso); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${hm(iso)}`; };
const addDays = (d, n) => localDay(new Date(toDate(d).getTime() + 12 * 3600e3 + n * 864e5));
const mondayOf = (ymd) => { const wd = toDate(ymd).getDay(); return addDays(ymd, wd === 0 ? -6 : 1 - wd); };
const longestSec = (spans) => { let m = 0; for (const pair of spans || []) { const s = (Date.parse(pair[1]) - Date.parse(pair[0])) / 1000; if (s > m) m = s; } return Math.round(m); };
const bulletsOf = (md) => String(md || "").split("\n").map((l) => l.replace(/^[-*]\s+/, "").trim()).filter((l) => l && l !== "没有");

/** 每小时秒数（电脑）：数据包的 active_hours {"09": 秒}，或老数据包的 hours {"09": {app: 秒}} */
function hourSecs(c) {
  c = c || {};
  const h = c.active_hours || Object.fromEntries(Object.entries(c.hours || {}).map(([k, v]) => [k, typeof v === "number" ? v : Object.values(v).reduce((a, b) => a + b, 0)]));
  return Array.from({ length: 24 }, (_, i) => h[String(i).padStart(2, "0")] || 0);
}

/** 区间 [[ISO, ISO]] 落在某天 hour 点以后的秒数 */
function secsAfter(spans, date, hour) {
  const from = toDate(date).getTime() + hour * 3600e3, to = toDate(date).getTime() + 864e5;
  return spans.reduce((s, [a, b]) => s + Math.max(0, Math.min(Date.parse(b), to) - Math.max(Date.parse(a), from)) / 1000, 0);
}

/** 每小时分钟数：接受数组（分钟）或 {"09": 秒} */
function hourMinutes(h) {
  if (Array.isArray(h)) return Array.from({ length: 24 }, (_, i) => h[i] || 0);
  return Array.from({ length: 24 }, (_, i) => Math.min(60, Math.round(((h || {})[String(i).padStart(2, "0")] || 0) / 60)));
}

const ICON = {
  chevL: '<svg class="mx-ico" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  chevR: '<svg class="mx-ico" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  chevD: '<svg class="mx-ico" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>',
  check: '<svg class="mx-ico" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  close: '<svg class="mx-ico" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>',
  more: '<svg class="mx-ico" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none"/></svg>',
};

// 极简 Markdown：小标题、列表、段落，行内粗体和代码。先转义再加标记。
function md(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) { close(); continue; }
    let m;
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { close(); out.push(`<h5>${inline(m[1])}</h5>`); }
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\d+[.、]\s*(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (line.startsWith(">")) { close(); out.push(`<p class="note">${inline(line.replace(/^>\s*/, ""))}</p>`); }
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return `<div class="md">${out.join("")}</div>`;
}

/** 按 ## 切日总结：开头的引用块是口径说明 */
function splitSummary(text) {
  const parts = []; let note = []; let cur = null;
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("## ")) { cur = { title: line.slice(3).trim(), body: [] }; parts.push(cur); }
    else if (cur) cur.body.push(line);
    else if (line.startsWith(">")) note.push(line.replace(/^>\s*/, ""));
  }
  return { note: note.join(" "), parts: parts.map((p) => ({ title: p.title, body: p.body.join("\n").trim() })) };
}

// ---------- 页面骨架 ----------

function header(title, right = "") {
  return `<header class="mx-head"><div class="mx-head-row" data-tauri-drag-region><h1 class="mx-title" data-tauri-drag-region>${esc(title)}</h1><div class="mx-head-right">${right}</div></div></header>`;
}
const section = (title, body, { count, aside } = {}) =>
  `<section class="mx-sec"><div class="mx-sec-head"><h3>${esc(title)}</h3>${count != null ? `<span class="mx-count">${count}</span>` : ""}${aside ? `<span class="mx-sec-aside">${aside}</span>` : ""}</div>${body}</section>`;
const emptyInline = (text) => `<p class="mx-empty-inline">${esc(text)}</p>`;
/** 「怎么设置」链接（墨线文案：要分步骤的设置，界面一句话＋这个链接，步骤在弹层里） */
const howto = (kind, text) => `<button type="button" class="howto" data-howto="${kind}">${esc(text)}</button>`;
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-howto]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  ({ screentime: screenTimeDialog })[b.dataset.howto]?.();
}, true);

/** iCloud 屏幕使用时间怎么同步到这台 Mac：四步＋打开系统设置、现在读取 */
function screenTimeDialog() {
  // 手机版不读屏幕使用时间（电脑读），没有这两个按钮
  const desk = TAURI && !(S.status && S.status.mobile);
  openDialog({
    title: "iPhone 屏幕使用时间", cancel: "关闭", ok: desk ? "现在读取" : null, busy: "读取中…",
    body: `<ol class="steps">
      <li>iPhone：设置 → 屏幕使用时间 → 打开「跨设备共享」</li>
      <li>Mac：系统设置 → 屏幕使用时间 → 打开「跨设备共享」</li>
      <li>两台用同一个 Apple ID</li>
      <li>想快点同步：在 iPhone 和 Mac 上各打开一次「屏幕使用时间」</li></ol>
      ${desk ? `<button class="mx-btn mx-btn--secondary mx-btn--sm" style="align-self:flex-start" id="st-open">打开系统设置</button>` : ""}`,
    onOpen: (el) => { const b = el.querySelector("#st-open"); if (b) b.onclick = () => call("open_permission", { kind: "screentime" }); },
    submit: async () => {
      await call("phone_read_now");
      await new Promise((r) => setTimeout(r, 4000));
      S.status = await call("get_status").catch(() => S.status);
      route();
    },
  });
}

// ---------- 弹层（墨线 Dialog 小窗口）：新建、编辑、填几项再提交都在这里，页面上不展开编辑框 ----------
// 同一时间只开一个，挂在 body 上，页面重画不影响它。点遮罩、Esc、关闭都等于取消；提交中不关。

let DLG = null;

/** title、body（HTML）、ok（主按钮文字）、okClass（primary／danger）、busy（提交中的按钮文字）、cancel（false＝不要取消钮）、
 *  closable（false＝只能点主按钮关）、submit(el)：抛错就把错写在窗口里、不关，返回 false 也不关；onOpen(el, d) 绑窗口里的交互 */
function openDialog({ title, body, ok, okClass = "primary", busy, cancel = "取消", closable = true, submit, onOpen }) {
  closeDialog();
  const root = document.createElement("div");
  root.className = "mx-scrim dlg-root";
  root.innerHTML = `<div class="mx-dialog mx-dialog--sm" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <div class="mx-dialog-head"><h2 id="dlg-title">${esc(title)}</h2>${closable ? `<button class="mx-iconbtn" data-dlg="close" aria-label="关闭">${ICON.close}</button>` : ""}</div>
    <div class="mx-dialog-body">${body}<div class="mx-field-error" data-dlg="err" hidden></div></div>
    <div class="mx-dialog-foot">${cancel ? `<button class="mx-btn mx-btn--secondary" data-dlg="close">${esc(cancel)}</button>` : ""}${ok ? `<button class="mx-btn mx-btn--${okClass}" data-dlg="ok">${esc(ok)}</button>` : ""}</div></div>`;
  document.body.appendChild(root);
  const el = root.querySelector(".mx-dialog"), okBtn = root.querySelector('[data-dlg="ok"]'), err = root.querySelector('[data-dlg="err"]');
  const d = (DLG = { root, el, closable, busy: false, back: document.activeElement });
  d.setErr = (m) => { err.hidden = !m; err.textContent = m || ""; };
  d.setOk = (text) => { if (okBtn) okBtn.textContent = text; };
  d.go = async () => {
    if (d.busy || !okBtn || okBtn.disabled) return;
    const label = okBtn.textContent;
    d.busy = true; okBtn.disabled = true; d.setErr(null); if (busy) okBtn.textContent = busy;
    try { if ((await submit(el, d)) !== false) { d.busy = false; return closeDialog(); } }
    catch (x) { d.setErr(String(x && x.message ? x.message : x)); }
    d.busy = false; okBtn.disabled = false; okBtn.textContent = label;
  };
  const cancelable = () => closable && !d.busy;
  root.addEventListener("mousedown", (e) => { if (e.target === root && cancelable()) closeDialog(); });
  root.addEventListener("click", (e) => { const b = e.target.closest("[data-dlg]"); if (!b) return; if (b.dataset.dlg === "close" && cancelable()) closeDialog(); else if (b.dataset.dlg === "ok") d.go(); });
  root.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { if (cancelable()) closeDialog(); return; }
    // 单行输入框里回车、任何地方 ⌘↩ 都等于点主按钮；输入法选字时的回车不算
    if (e.key === "Enter" && !e.isComposing && (e.metaKey || e.target.tagName === "INPUT")) { e.preventDefault(); d.go(); return; }
    if (e.key === "Tab") {
      const fs = [...el.querySelectorAll("button:not(:disabled), input:not([hidden]):not([type='hidden']), select, textarea, [tabindex='0']")];
      if (!fs.length) return;
      const i = fs.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); fs[fs.length - 1].focus(); }
      else if (!e.shiftKey && i === fs.length - 1) { e.preventDefault(); fs[0].focus(); }
    }
  });
  if (onOpen) onOpen(el, d);
  const first = el.querySelector(".mx-dialog-body input:not([hidden]), .mx-dialog-body textarea") || okBtn || el.querySelector("[data-dlg]");
  if (first) { first.focus(); if (first.setSelectionRange && first.value && (first.tagName === "TEXTAREA" || ["text", "search", "url", "tel", "password"].includes(first.type))) first.setSelectionRange(first.value.length, first.value.length); }
  return d;
}

function closeDialog() {
  const d = DLG; if (!d) return;
  DLG = null; d.root.remove();
  if (d.back && d.back.isConnected && d.back.focus) d.back.focus();
}

/** 弹层里的一项输入 */
const dlgField = (id, label, { type = "text", ph = "", value = "", mono = false, help = "" } = {}) =>
  `<div class="mx-field"><label for="${id}">${label}</label><input class="mx-input${mono ? " mono" : ""}" id="${id}" type="${type}" autocomplete="off" placeholder="${esc(ph)}" value="${esc(value)}">${help ? `<p class="note">${help}</p>` : ""}</div>`;
const dlgVal = (el, id) => { const x = el.querySelector("#" + id); return x ? x.value.trim() : ""; };

// ---------- 人生记录：读数、一天的形状、作息图 ----------

const shade = (min, v) => (min ? `background:color-mix(in srgb, var(${v}) ${Math.round(30 + (Math.min(min, 60) / 60) * 70)}%, var(--rec-track))` : "");
const isNight = (h) => h >= 21 || h < 5;

/** 读数：标签、数值、单位、下面一行小字；tip 是悬停提示（墨线：读数不配解释文字，要解释放悬停） */
function readout(k, v, unit, caption = "", over = false, tip = "") {
  return `<div class="ro${over ? " over" : ""}"${tip ? ` title="${esc(tip)}"` : ""}><div class="label">${esc(k)}</div><div class="v">${esc(v)}${unit ? `<small>${esc(unit)}</small>` : ""}</div><div class="caption" title="${esc(caption)}">${esc(caption) || "&nbsp;"}</div></div>`;
}

/** 一天的形状。只给电脑、手机两排时照旧（上排电脑、下排手机）；给了 opt（手表说话的分钟数 hw、停留点 visits、日期 date）
 *  就按设备一排一排、行首写设备名，最上面一条地点色带 */
function dayStrip(hc, hp, clickable = false, opt = null) {
  const cells = (arr, v, name, unit = "分钟") => arr.map((m, h) => `<span style="${shade(m, v)}" title="${h}:00 ${name} ${m} ${unit}"${clickable ? ` data-h="${h}"` : ""}></span>`).join("");
  const axis = (n) => `<div class="strip-axis" aria-hidden="true">${Array.from({ length: n }, (_, h) => `<span>${h % 3 ? "" : h}</span>`).join("")}</div>`;
  if (!opt) return `<div role="img" aria-label="一天的形状：上排电脑，下排手机"><div class="strip">${cells(hc, "--rec-computer", "电脑")}${cells(hp, "--rec-phone", "手机")}</div>${axis(24)}</div>`;
  const rows = [];
  if (opt.visits && opt.visits.length) rows.push(["地点", placeBand(opt.visits, opt.date), "k-pl"]);
  rows.push(["电脑", `<div class="strip">${cells(hc, "--rec-computer", "电脑")}</div>`]);
  rows.push(["手机", `<div class="strip">${cells(hp, "--rec-phone", "手机")}</div>`]);
  // 说话：手表录的，和没戴手表时 iPhone 自己录的，合在一排
  if (opt.hw) rows.push(["说话", `<div class="strip">${cells(opt.hw, "--rec-watch", "说话")}</div>`]);
  return `<div role="img" aria-label="一天的形状：${rows.map((r) => r[0]).join("、")}各一排"><div class="strip-rows">${rows.map(([k, v, c]) => `<span class="k${c ? " " + c : ""}">${k}</span>${v}`).join("")}<span></span>${axis(24)}</div></div>`;
}

/** 两个停留点之间不超过 3 小时算「路上」，更长的和首尾算「没记到」（同 脚本/日数据包.py 的 TRANSIT_MAX） */
const TRANSIT_MAX = 3 * 3600e3;
/** 地点的显示名：起过名的用名字；没起名的不带区名，只有区域时写区域，确认了是哪家店写「区域 · 店」
 *  （手机用高德取的地名是「区 · 区域」，确认了店是「区 · 区域 · 店」；10-21 前苹果取的是「区 · 区域 · 门牌或店」） */
const placeName = (v) => {
  if (!v) return "没有地名";
  if (v.label) return v.label;
  const parts = (v.name || "").split(" · ");
  const n = (parts.length > 1 ? parts.slice(1).join(" · ") : parts[0]) || "没有地名";
  // 和家不在一个城市：前面写城市（「上海 · 静安寺」）
  return v.city_prefix ? `${String(v.city_prefix).replace(/市$/, "")} · ${n}` : n;
};
const visitEnd = (v) => (v.end ? Date.parse(v.end) : Date.now());
const pctText = (p) => `${Math.max(1, Math.round(p * 100))}%`;
/** 店名去掉括号里的分店名：「星巴克(某某广场店)」→「星巴克」（同手机） */
const shopShort = (n) => String(n || "").replace(/^(.+?)\s*[（(][^（()）]*[)）]$/, "$1").trim();
/** 还没确认是哪家店时，名字下面一行：在做什么（高德大类，置信度加总，手机算的）和最像的两家 */
function guessLine(v) {
  if (v.label || v.confirmed || !(v.guesses || []).length) return "";
  const parts = [];
  if (v.doing) parts.push(`${v.doing.kind} ${pctText(v.doing.p)}`);
  parts.push("可能是 " + v.guesses.slice(0, 2).map((g) => `${shopShort(g.name)} ${pctText(g.p)}`).join("、"));
  return parts.join(" · ");
}
/** 区域名（常去按它合计）：电脑取的分级里的区域，没有就用地名的第二层 */
const areaOf = (v) => (v.admin && v.admin.area) || ((v.place_name || v.name || "").split(" · ")[1]) || (v.place_name || v.name || "").split(" · ")[0];
/** 完整分级「中国 › 江苏省 › 南京市 › 江宁区 › 麒麟街道 › 南京江宁宝龙广场」（直辖市省市同名只写一次） */
function chainOf(v) {
  const a = v.admin || {};
  const xs = [a.country, a.province, a.city !== a.province ? a.city : null, a.district, a.township, a.area].filter(Boolean);
  return xs.join(" › ");
}
const cityShort = (c) => String(c || "").replace(/市$/, "");
/** 角标：起过名的写种类（家、工作、其他），没起名但最近 30 天去过 5 次以上的写「常去」，第一次去的不标 */
function badgeOf(v) {
  if (v.label) return PL_ICON[v.type] || "其他";
  const f = PL.stats && PL.stats.frequent;
  return f && f.some((r) => r.name === areaOf(v)) ? "常去" : "";
}
const badgeHtml = (v) => { const b = badgeOf(v); return b ? `<span class="pl-badge${b === "常去" ? " often" : ""}">${esc(b)}</span>` : ""; };

/** 地图上停留点的编号：1–9、A–Z（同高德静态地图的标注） */
const MARKS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const hmMs = (ms) => hm(new Date(ms).toISOString());
/** 停留的起止：从前一天待过来的写真实到达时刻（「昨天 22:10」），还没走的写「现在」 */
function visitSpan(v) {
  let a = hm(v.start);
  if (!v.arrive_known && v.arrive) {
    const t = new Date(v.arrive), y = new Date(Date.parse(v.start) - 864e5);
    a = (localDay(t) === localDay(y) ? "昨天 " : `${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} `) + hm(v.arrive);
  }
  return `${a}–${v.end ? hm(v.end) : "现在"}`;
}
const spanText = (sec) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} 分钟` : `${hh(sec)}h`);

/** 把一天按停留点切开：停留、两段之间的路上（≤ 3 小时）、没记到（更长的空档和首尾），按时间先后。只算到现在 */
function placeBlocks(visits, date) {
  const day0 = toDate(date).getTime(), stop = Math.min(Date.now(), day0 + 864e5);
  const vs = [...visits].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const out = [];
  let cur = day0;
  for (const v of vs) {
    const a = Date.parse(v.start), z = Math.min(visitEnd(v), stop);
    if (a > cur) out.push({ kind: cur > day0 && a - cur <= TRANSIT_MAX ? "go" : "none", a: cur, z: a });
    out.push({ kind: "stay", v, a, z });
    cur = Math.max(cur, z);
  }
  if (stop > cur) out.push({ kind: "none", a: cur, z: stop });
  return out.filter((b) => b.z > b.a);
}

/** 地点色带：底色只画到现在；每段停留按起止画在当天 0–24 点上，相邻两段交替深浅；够宽的地名写在段上，
 *  窄的写在下面一行（layoutPlaceNames 排）；两段之间的路上画一条细线；今天画一条「现在」竖线 */
function placeBand(visits, date) {
  const day0 = toDate(date).getTime(), now = Date.now(), today = now < day0 + 864e5;
  const pct = (ms) => `${(Math.max(0, Math.min(1, (ms - day0) / 864e5)) * 100).toFixed(3)}%`;
  const wid = (a, z) => `${(Math.max((z - a) / 864e5, 0.002) * 100).toFixed(3)}%`;
  const blocks = placeBlocks(visits, date);
  let html = `<span class="bg" style="width:${today ? pct(now) : "100%"}"></span>`, i = 0;
  const narrow = [];
  for (const b of blocks) {
    if (b.kind === "go") html += `<span class="go" style="left:${pct(b.a)};width:${wid(b.a, b.z)}" title="路上 ${spanText((b.z - b.a) / 1000)}"></span>`;
    if (b.kind !== "stay") continue;
    const name = placeName(b.v), wide = (b.z - b.a) / 3600e3 >= 1.2;
    html += `<span class="st${i++ % 2 ? " alt" : ""}" style="left:${pct(b.a)};width:${wid(b.a, b.z)}" title="${esc(name)} ${visitSpan(b.v)}">${wide ? esc(name) : ""}</span>`;
    if (!wide) narrow.push([((b.a - day0) / 864e5), name]);
  }
  if (today) html += `<span class="now" style="left:${pct(now)}" title="现在 ${hmMs(now)}"></span>`;
  return `<div><div class="places">${html}</div><div class="pl-names" data-names="${esc(JSON.stringify(narrow))}"></div></div>`;
}

/** 窄段的地名写在色带下面：从左往右排，和前一个挤在一起或超出右边就不写（悬停里有）。页面画好以后、窗口变宽窄时调用 */
function layoutPlaceNames(root = document) {
  for (const box of root.querySelectorAll(".pl-names[data-names]")) {
    const names = JSON.parse(box.dataset.names || "[]"), W = box.getBoundingClientRect().width;
    box.innerHTML = "";
    const m = document.createElement("span"); box.appendChild(m);
    let right = -Infinity, html = "";
    for (const [f, n] of names) {
      m.textContent = n;
      const w = m.getBoundingClientRect().width, x = f * W;
      if (x < right + 8 || x + w > W) continue;
      html += `<span style="left:${x.toFixed(1)}px">${esc(n)}</span>`; right = x + w;
    }
    box.innerHTML = html;
  }
}
let PL_RESIZE = null;
window.addEventListener("resize", () => { clearTimeout(PL_RESIZE); PL_RESIZE = setTimeout(() => layoutPlaceNames(), 120); });

/** 某段时间里待得最久的停留点 */
function placeAt(visits, a, z) {
  let best = null, most = 0;
  for (const v of visits || []) {
    const o = Math.min(z, visitEnd(v)) - Math.max(a, Date.parse(v.start));
    if (o > most) { most = o; best = v; }
  }
  return best;
}

/** 说话的时长：不到一小时写分钟 */
const talkText = (sec) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} 分钟` : `${hh(sec)}h`);
/** 说话的人：按说话时长排，本人排第一 */
function speakers(talk, self) {
  return [...talk].sort((a, b) => (b.speaker === self) - (a.speaker === self) || b.sec - a.sec).map((t) => t.speaker);
}

/** 概览里的「去了哪」（照地图类产品的「时间线」）：上面一行汇总；左边按时间的竖线时间线（停留和路上交替，停留里套着那时的对话），
 *  右边地图（停留点按先后编号，点哪一行地图上那个点变成强调色）。名字只写有把握的；还没认出是哪家店的，下面一行列最像的几家，
 *  点一下就认定；每行右边「⋯」改地点（候选、附近、搜索、直接输入、起名）。不显示百分比（悬停能看） */
function placesSection(visits, date, convs, mode = "stays") {
  if (!visits.length) return "";
  const blocks = placeBlocks(visits, date);
  let go = 0;
  for (const b of blocks) if (b.kind === "go") go += (b.z - b.a) / 1000;
  const spots = new Set(visits.map((v) => v.label || placeName(v).split(" · ")[0])).size;
  const talk = (convs || []).length;
  // 当天在哪些城市、区：一个城市写「南京 · 江宁区、栖霞区」，跨城写「南京 → 上海」
  const cities = [...new Set(visits.map((v) => v.admin && v.admin.city).filter(Boolean))];
  const where = cities.length > 1 ? cities.map(cityShort).join(" → ")
    : cities.length ? `${cityShort(cities[0])} · ${[...new Set(visits.map((v) => v.admin && v.admin.district).filter(Boolean))].join("、")}` : "";
  const sum = [where, `${spots} 个地方`, `${visits.length} 段停留`, go ? `路上 ${spanText(go)}` : "", talk ? `说话 ${talk} 段` : ""].filter(Boolean).join(" · ");
  const idx = new Map(visits.map((v, i) => [v, i]));
  let first = true;
  const rows = blocks.map((b) => {
    if (b.kind === "stay") { first = false; return stayItem(b.v, idx.get(b.v), (convs || []).filter((c) => Date.parse(c.start) >= b.a && Date.parse(c.start) < b.z)); }
    if (first) return "";  // 一天开头没记到的不画
    const dur = spanText((b.z - b.a) / 1000);
    return b.kind === "go" ? `<li class="ptl-go"><span class="ptl-t"></span><span class="ptl-dot"></span><span class="ptl-b">路上 ${dur}</span></li>`
      : `<li class="ptl-none"><span class="ptl-t"></span><span class="ptl-dot"></span><span class="ptl-b">没记到 ${dur}</span></li>`;
  }).join("");
  return `<p class="ptl-sum">${sum}</p><ol class="ptl" id="ptl">${rows}</ol>`;
}

/** 地点 · 常去：最近 30 天按地方合计。起过名的（家、公司……，可改名字、地址、种类、范围、删），常去但没起名的（去过 5 次以上，可起名），
 *  底下「添加一个地方」搜着加。不跟着翻日期，总是最近 30 天 */
function oftenView(st) {
  if (!st) return emptyInline("没取到常去的地方。");
  const md = (d) => (d ? d.slice(5) : "");
  const meta = (r) => [r.count ? `${r.count} 次` : "最近没来过", r.sec ? `共 ${spanText(r.sec)}` : "", r.last ? `最近 ${md(r.last)}` : ""].filter(Boolean).join(" · ");
  // 按「城市 › 区县」分组；起过名但最近没去过的（不知道在哪个区）放最后一组
  const groups = new Map();
  const put = (k, html, sec) => { if (!groups.has(k)) groups.set(k, { rows: [], sec: 0 }); const g = groups.get(k); g.rows.push(html); g.sec += sec; };
  for (const r of st.named) {
    const k = r.city || r.district ? [cityShort(r.city), r.district].filter(Boolean).join(" › ") : "最近没去过";
    put(k, `<li class="pf-row"><span class="pf-k">${esc(PL_ICON[r.type] || "其他")}</span>
      <span class="pf-b"><span class="pf-n">${esc(r.name)}${r.address ? `<span class="pf-a"> · ${esc(r.address)}</span>` : ""}</span><span class="pf-m">${esc(meta(r))} · 范围 ${Math.round(r.r || 150)} 米</span></span>
      <button class="mx-btn mx-btn--text mx-btn--sm" data-pl="${r.index}">改</button></li>`, r.sec || 0);
  }
  st.frequent.forEach((r, i) => put([cityShort(r.city), r.district].filter(Boolean).join(" › ") || "其他", `<li class="pf-row"><span class="pf-k often">常去</span>
      <span class="pf-b"><span class="pf-n">${esc(r.name)}</span><span class="pf-m">${esc(meta(r))} · 还没起名</span></span>
      <button class="mx-btn mx-btn--text mx-btn--sm" data-name-it="${i}">起名</button></li>`, r.sec || 0));
  const order = [...groups].sort((a, b) => (a[0] === "最近没去过") - (b[0] === "最近没去过") || b[1].sec - a[1].sec);
  return `<p class="ptl-sum">最近 ${st.days} 天 · 起过名的 ${st.named.length} 个 · 常去没起名的 ${st.frequent.length} 个</p>
    ${order.map(([k, g]) => section(k, `<ol class="pf-list">${g.rows.join("")}</ol>`)).join("") || emptyInline("还没有常去的地方")}
    <p class="note">按城市 › 区分组。没起名的列最近 ${st.days} 天去过 5 次以上的区域。</p>
    <div class="inline" style="margin-top:var(--space-4)"><button class="mx-btn mx-btn--secondary" id="pl-add">添加一个地方</button></div>`;
}

function bindOften() {
  $app.querySelectorAll(".pf-list [data-pl]").forEach((b) => (b.onclick = () => labelDialog(+b.dataset.pl)));
  $app.querySelectorAll("[data-name-it]").forEach((b) => (b.onclick = () => {
    const r = PL.stats.frequent[+b.dataset.nameIt];
    placeDialog({ lat: r.lat, lon: r.lon, name: `${r.district || ""} · ${r.name}`, label: null, type: "other" });
  }));
  const add = document.getElementById("pl-add");
  if (add) add.onclick = addPlaceDialog;
}

/** 全面页的「去了哪」：按地点合计的条形图（加上路上、没记到），明细在地点页 */
function placeTotals(visits, date) {
  if (!visits.length) return "";
  const tot = new Map();
  let go = 0, none = 0;
  for (const b of placeBlocks(visits, date)) {
    const sec = (b.z - b.a) / 1000;
    if (b.kind === "go") go += sec;
    else if (b.kind === "none") none += sec;
    else { const n = b.v.label || placeName(b.v).split(" · ")[0]; tot.set(n, (tot.get(n) || 0) + sec); }
  }
  const rows = [...tot].sort((a, b) => b[1] - a[1]).map(([n, sec]) => ({ n, sec, c: "pl" }));
  if (go) rows.push({ n: "路上", sec: go, c: "go" });
  if (none) rows.push({ n: "没记到", sec: none, c: "none" });
  const max = Math.max(...rows.map((r) => r.sec), 1), all = rows.reduce((a, r) => a + r.sec, 0) || 1;
  const pct = (sec) => { const p = (sec / all) * 100; return p < 1 ? "<1%" : Math.round(p) + "%"; };
  const bars = `<div class="bars pl-bars">${rows.map((r) => `<div class="bar-row"><span class="bar-chev"></span><span class="bar-name${r.c === "pl" ? "" : " dim"}" title="${esc(r.n)}">${esc(r.n)}</span><span class="bar"><i class="${r.c}" style="width:${Math.max(2, Math.round((r.sec / max) * 100))}%"></i></span><span class="bar-v mono">${r.sec < 3600 ? Math.round(r.sec / 60) + "m" : hh(r.sec) + "h"}</span><span class="bar-p mono">${pct(r.sec)}</span></div>`).join("")}</div>`;
  return section("去了哪", bars, { aside: `<button class="mx-btn mx-btn--text" id="to-places">看地点${ICON.chevR}</button>` });
}

/** 时间线上的一段停留 */
function stayItem(v, i, convs) {
  const dur = spanText((visitEnd(v) - Date.parse(v.start)) / 1000);
  const meta = [visitSpan(v), dur];
  if (!v.label && v.doing && v.doing.p >= 0.5 && !["picked", "phone"].includes(v.confirmed)) meta.push(v.doing.kind);
  // 自动写上的也标把握（第一名的）
  const topP = (v.guesses || [])[0] ? ` ${pctText(v.guesses[0].p)}` : "";
  if (v.confirmed === "auto") meta.push(`自动认出${topP}`);
  if (v.confirmed === "remembered") meta.push(`按上次认定${topP}`);
  const ok = v.confirmed === "picked" || v.confirmed === "phone";
  const pct = (g) => `${shopShort(g.name)}：把握 ${pctText(g.p)}，离记到的位置 ${Math.round(g.distance)} 米`;
  // 还没认定：名字后面淡色写最可能的一家和把握
  const top = !v.label && !v.confirmed && (v.guesses || [])[0];
  const likely = top ? `<span class="ptl-likely">· 可能是 ${esc(shopShort(top.name))} <span class="p">${pctText(top.p)}</span></span>` : "";
  // 候选：一段停留可以认定好几家（商场里逛了几家），点一下加上（打 ✓），再点取消。认定过的排前面，再补最像的凑满 3 个；
  // 一家没认定时问「是哪家？」，认定过的问「还去了？」。在手机上认定的不在这里列（改在 ⋯ 里）
  const shops = v.confirmed === "picked" ? (v.shops || []) : [];
  const chips = [...shops.map((n) => (v.guesses || []).find((g) => g.name === n) || { name: n }), ...(v.guesses || []).filter((g) => !shops.includes(g.name))].slice(0, Math.max(3, shops.length + 1));
  const guess = !v.label && v.confirmed !== "phone" && chips.length
    ? `<div class="ptl-guess">${shops.length ? "还去了？" : "是哪家？"}${chips.map((g) => { const on = shops.includes(g.name); return `<button class="${on ? "on" : ""}" data-chip="${i}" data-shop="${esc(g.name)}" aria-pressed="${on}" title="${esc(on ? `${shopShort(g.name)}：认定过，再点取消` : g.p != null ? pct(g) : shopShort(g.name))}">${on ? ICON.check : ""}${esc(shopShort(g.name))}${g.p != null ? `<span class="p">${pctText(g.p)}</span>` : ""}</button>`; }).join("")}<button class="other" data-edit="${i}">其他…</button></div>` : "";
  const talk = convs.length ? `<details class="ptl-talk"><summary>说话 ${convs.length} 段 · ${talkText(convs.reduce((a, c) => a + (c.talk || []).reduce((x, t) => x + t.sec, 0), 0))}</summary><div class="tl">${convs.map((c) => convRow(c, "", `<span class="t">${hm(c.start)}</span>`)).join("")}</div></details>` : "";
  return `<li class="ptl-stay${v.end ? "" : " now"}" data-sel="${i}"><span class="ptl-t mono">${v.arrive_known === false && v.arrive ? "昨天" : hm(v.start)}</span><span class="ptl-dot">${MARKS[Math.min(i, MARKS.length - 1)]}</span>
    <div class="ptl-b"><div class="ptl-name"><span title="${esc(chainOf(v))}">${esc(placeName(v))}</span>${likely}${badgeHtml(v)}${ok ? `<span class="ok" title="${v.confirmed === "phone" ? "在手机上认定的" : "你认定的"}">${ICON.check}</span>` : ""}</div>
      <div class="ptl-meta">${esc(meta.join(" · "))}</div>${guess}${talk}</div>
    <div class="ptl-act"><button class="mx-iconbtn" data-edit="${i}" aria-label="改地点" title="改地点">${ICON.more}</button></div></li>`;
}

/** 点候选：加上这家（打 ✓）；已认定的再点＝取消这家 */
async function pickChip(visits, i, name) {
  const v = visits[i];
  if (!v || !name) return;
  const g = (v.guesses || []).find((x) => x.name === name) || {};
  await call("set_place_pick", { id: v.id, shop: name, kind: g.type || null, lat: v.lat, lon: v.lon });
  renderToday();
}

/** 改地点（挂在那一行下面的小弹窗）：搜索框在最上面；下面是认定的、最像的几家（电脑算的，按把握排）和高德附近 150 米的地点（按距离），
 *  点一个就加上（再点认定过的＝取消这家）；搜不到的直接输入店名；最下面给这里起名、认定过的能退回只写区域 */
function placeEditor(v, anchor) {
  closeEditor();
  const box = document.createElement("div");
  box.className = "mx-menu ptl-edit"; box.setAttribute("role", "menu");
  const cands = new Map();
  // 认定过的打 ✓，点一下取消；没认定的点一下加上（一段停留可以认定好几家）
  const shops = v.confirmed === "picked" ? (v.shops || []) : [];
  const row = (p, key, right) => { cands.set(key, p); const on = shops.includes(p.name); return `<button role="menuitemcheckbox" aria-checked="${on}" class="${on ? "on" : ""}" data-pk="${esc(key)}"><span class="pk-n">${esc(shopShort(p.name))}<span class="pk-t">${esc(((p.type || "").split(";")[1]) || (p.type || "").split(";")[0] || "")}</span></span>${on ? `<span class="mx-check">${ICON.check}</span>` : `<span class="mx-menu-val">${right}</span>`}</button>`; };
  const extra = shops.filter((n) => !(v.guesses || []).some((g) => g.name === n)).map((n, j) => row({ name: n }, "x" + j, "")).join("");
  const guesses = (v.guesses || []).map((g, j) => row(g, "g" + j, `${Math.round(g.distance)} 米`)).join("");
  box.innerHTML = `${chainOf(v) ? `<div class="pe-chain">${esc(chainOf(v))}</div>` : ""}<input class="mx-input" id="pe-q" placeholder="输入地点名称" autocomplete="off">
    <div id="pe-found"></div>
    ${extra ? `<div class="mx-menu-group">认定的</div>${extra}` : ""}
    ${guesses ? `<div class="mx-menu-group">最像的</div>${guesses}` : ""}
    <p class="note">地点名称仅在本机保存。</p>
    <hr><button role="menuitem" data-pe="label">${v.label ? "改这里的名字…" : "给这里起名…"}</button>
    ${shops.length ? `<button role="menuitem" data-pe="clear">${shops.length > 1 ? `都不确定，${shops.length} 家全撤销` : "不确定，退回只写区域"}</button>` : ""}`;
  anchor.appendChild(box);
  EDITOR = box;
  const choose = async (key) => {
    const c = key.startsWith("t:") ? { name: key.slice(2) } : cands.get(key);
    if (!c) return;
    await call("set_place_pick", { id: v.id, shop: c.name, kind: c.type || null, lat: c.lat ?? v.lat, lon: c.lon ?? v.lon });
    closeEditor(); renderToday();
  };
  box.addEventListener("click", async (e) => {
    e.stopPropagation();
    const b = e.target.closest("[data-pk]"); if (b) return choose(b.dataset.pk);
    const a = e.target.closest("[data-pe]"); if (!a) return;
    if (a.dataset.pe === "label") { closeEditor(); placeDialog(v); }
    if (a.dataset.pe === "clear") { await call("clear_place_pick", { id: v.id }); closeEditor(); renderToday(); }
  });
  const q = box.querySelector("#pe-q"); q.focus();
  q.oninput = () => {
    const text=q.value.trim();
    box.querySelector("#pe-found").innerHTML=text?`<button role="menuitem" data-pk="t:${esc(text)}">就叫「${esc(text)}」</button>`:"";
  };
  q.onkeydown = (e) => { if (e.key === "Escape") closeEditor(); if (e.key === "Enter" && !e.isComposing && q.value.trim()) choose("t:" + q.value.trim()); };

}
let EDITOR = null;
function closeEditor() { if (EDITOR) { EDITOR.remove(); EDITOR = null; } }
document.addEventListener("click", (e) => { if (EDITOR && !EDITOR.contains(e.target) && !e.target.closest("[data-edit]")) closeEditor(); });

/** 给一个地方起名（小弹层）：名字＋种类，存进本机的地点名单；清空＝删掉这个名字 */
function placeDialog(v) {
  const TYPES = [["home", "家"], ["work", "工作"], ["other", "其他"]];
  let kind = v.type || "other";
  openDialog({
    title: v.label ? `改「${v.label}」的名字` : `给「${placeName(v)}」起名`, ok: "保存",
    body: dlgField("pl-name", "名字", { value: v.label || "", ph: "比如 家、公司、健身房", help: v.label ? "清空就删掉这个名字" : `地图上查到的地名是「${esc(v.name || "没有")}」。` })
      + `<div class="mx-field"><label>种类</label><div class="mx-seg" role="tablist" id="pl-kind">${TYPES.map(([k, t]) => `<button role="tab" aria-selected="${k === kind}" class="${k === kind ? "is-on" : ""}" data-v="${k}">${t}</button>`).join("")}</div></div>`,
    onOpen: (el) => {
      el.querySelector("#pl-name").maxLength = 20;
      el.querySelector("#pl-kind").onclick = (e) => {
        const b = e.target.closest("[data-v]"); if (!b) return;
        kind = b.dataset.v;
        el.querySelectorAll("#pl-kind button").forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-selected", x === b); });
      };
    },
    submit: async (el) => { await call("set_place_label", { lat: v.lat, lon: v.lon, label: dlgVal(el, "pl-name"), kind }); renderToday(); },
  });
}

function actogram(rows, cur) {
  let html = "";
  for (const [k, x] of rows.entries()) {
    // 行末：这一晚的分钟数＝当天 21 点以后＋次日 0–5 点（次日没有数据就只算当天）
    const nx = rows[k + 1] || x.next;
    let late = nx ? [0, 1, 2, 3, 4].reduce((a, h) => a + Math.max(nx.hc[h], nx.hp[h]), 0) : 0;
    html += x.has ? `<a class="d${x.date === cur ? " cur" : ""}" href="#/summary/${x.date}">${short(x.date)}</a>` : `<span class="d">${short(x.date)}</span>`;
    for (let h = 0; h < 24; h++) {
      const c = x.hc[h], p = x.hp[h];
      if (h >= 21) late += Math.max(c, p);
      html += `<div class="cell${isNight(h) && (c || p) ? " n" : ""}" title="${short(x.date)} ${h}:00 电脑 ${c} 分钟 · 手机 ${p} 分钟"><span style="${shade(c, "--rec-computer")}"></span><span style="${shade(p, "--rec-phone")}"></span></div>`;
    }
    html += `<span class="late">${late > 10 ? late + "m" : ""}</span>`;
  }
  const axis = Array.from({ length: 8 }, (_, i) => `<span style="grid-column:${2 + i * 3}">${i * 3}</span>`).join("");
  return `<div role="img" aria-label="最近 ${rows.length} 天作息图"><div class="acto">${html}</div><div class="acto-axis" aria-hidden="true">${axis}</div></div>
    <div class="legend"><span><i style="background:var(--rec-computer)"></i>电脑</span><span><i style="background:var(--rec-phone)"></i>手机</span><span><i style="background:var(--rec-night)"></i>熬夜分钟（21:00–5:00）</span></div>`;
}

// ---------- 状态 ----------

const S = { days: [], status: null, page: "today", rules: null, todos: null, memos: null, settings: null, draft: null, plan: null };

async function boot() {
  [S.days, S.status, S.profile] = await Promise.all([call("list_days"), call("get_status"), call("get_profile").catch(() => ({ name: "我" }))]);
  renderSide();
  await TimeSeenFocus.init({ native: !!TAURI, mobile: !!S.status.mobile, call, header, dialog: openDialog, closeDialog,
    page: () => S.page, invalidateTodos: () => { S.todos = null; },
    timeline: () => { TL.view = "timeline"; try { localStorage.setItem("today-view", "timeline"); } catch (e) {} },
    toast: (text) => { const note = document.createElement("div"); note.className = "pom-toast"; note.setAttribute("role", "status"); note.textContent = text; document.body.appendChild(note); setTimeout(() => note.remove(), 3500); },
  });
}

function renderSide() {
  // 侧栏只放导航；记录状态在「设备」页，这里只在缺权限、暂停、没在记录时给「设备」挂一个点
  const st = S.status || {};
  const perm = st.permissions || {};
  // 手机版不采集，没有权限、暂停这些
  const bad = !st.mobile && (st.paused || !perm.accessibility || !perm.input_monitoring || !st.capturing);
  const dot = document.getElementById("dev-dot");
  if (dot) { dot.hidden = !bad; dot.title = st.paused ? "已暂停" : "没在记录或缺权限"; }
  const pf = S.profile || { name: "我" };
  const av = document.getElementById("me-avatar");
  if (av) av.innerHTML = avatarHtml(pf);
  const nm = document.getElementById("me-name");
  if (nm) nm.textContent = pf.name || "我";
  const sub = document.getElementById("me-sub");
  // 正常记录时不写；暂停、缺权限、没在记录才提示
  if (sub) sub.textContent = st.mobile ? "" : st.paused ? " · 已暂停" : !perm.accessibility || !perm.input_monitoring ? " · 缺权限" : st.capturing ? "" : " · 没在记录";
  renderMeMenu();
}

/** 头像：有图片用图片，没有用名字第一个字 */
const avatarHtml = (pf) => (pf && pf.avatar ? `<img src="${esc(pf.avatar)}" alt="">` : esc(((pf && pf.name) || "我").trim().slice(0, 1).toUpperCase()));

// ---------- 左下角菜单（照 Claude） ----------

// 图标：Lucide（ISC 许可，见 app/THIRD_PARTY_NOTICES.md），24 格画布、细线
const lu = (paths) => `<svg class="mx-ico lu" viewBox="0 0 24 24">${paths}</svg>`;
const MI = {
  gear: lu('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  pause: lu('<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'),
  play: lu('<path d="M6 3l14 9-14 9z"/>'),
  devices: lu('<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>'),
  folder: lu('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  info: lu('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  update: lu('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  quit: lu('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
};

function aboutSection() {
  const st = S.status || {}, homepage = S.settings && S.settings.personal_homepage_url;
  return section("关于", setRow("时见 TimeSeen", "看见时间，看见自己。 · 人文帮出品", `<span class="note">版本 ${esc(st.version || "")}</span>`)
    + setRow("独立个人时间管理应用", "本地优先，AI 直接连接你配置的模型服务。", "")
    + setRow("个人主页", homepage ? esc(homepage) : "暂未设置", homepage ? `<a class="mx-btn mx-btn--text mx-btn--sm" href="${esc(homepage)}" target="_blank" rel="noopener noreferrer">打开</a>` : ""));
}

function renderMeMenu() {
  const menu = document.getElementById("me-menu");
  if (!menu) return;
  const st = S.status || {};
  menu.innerHTML = `<div class="mx-menu-group">${esc((st.device || "").replace(/^mac-/, "Mac · "))}</div>
    <button role="menuitem" data-me="settings">${MI.gear}设置<span class="mx-menu-val">⌘,</span></button>
    ${st.paused
      ? `<button role="menuitem" data-me="resume">${MI.play}继续记录${st.paused_until ? `<span class="mx-menu-val">${hm(st.paused_until)} 自动继续</span>` : ""}</button>`
      : `<button role="menuitem" data-me="pause">${MI.pause}暂停记录 1 小时</button>`}
    <button role="menuitem" data-me="devices">${MI.devices}设备</button>
    <button role="menuitem" data-me="data">${MI.folder}打开数据目录</button>
    <hr>
    <button role="menuitem" disabled>${MI.info}版本<span class="mx-menu-val">${esc(st.version || "")}</span></button>
    <hr>
    <button role="menuitem" data-me="quit">${MI.quit}退出时见</button>`;
}

function toggleMe(open) {
  const menu = document.getElementById("me-menu"), btn = document.getElementById("me");
  if (!menu) return;
  menu.hidden = open === undefined ? !menu.hidden : !open;
  btn.setAttribute("aria-expanded", String(!menu.hidden));
}

/** 手机（窄屏、iPhone 版）：左下角菜单变成底部页签里的「我」，点了直接进设置 */
const NARROW = window.matchMedia("(max-width: 760px)");
document.getElementById("me").onclick = (e) => { e.stopPropagation(); if (NARROW.matches) { location.hash = "#/settings"; return; } toggleMe(); };
document.getElementById("me-menu").onclick = async (e) => {
  const b = e.target.closest("[data-me]"); if (!b) return;
  toggleMe(false);
  const k = b.dataset.me;
  if (k === "settings") location.hash = "#/settings";
  else if (k === "devices") location.hash = "#/devices";
  else if (k === "data") call("open_data_dir");
  else if (k === "quit") call("quit_app");
  else { await call("set_paused", k === "pause" ? { paused: true, minutes: 60 } : { paused: false }); S.status = await call("get_status"); renderSide(); if (S.page === "settings" || S.page === "devices") route(); }
};
document.addEventListener("click", (e) => { if (!e.target.closest(".me-wrap")) toggleMe(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleMe(false);
  if (e.metaKey && e.key === ",") { e.preventDefault(); location.hash = "#/settings"; }
});

function markNav(page) {
  document.querySelectorAll("#nav a, .me").forEach((a) => a.classList.toggle("is-on", a.dataset.page === page));
}

// ---------- 今天 ----------

/** 「今天」页页签那一行右边的翻日期：一个整体「‹ 日期 ▾ ›」（点日期展开，只列有数据的日子，同总结页）；
 *  看以前的日子时左边多一个「今天」，同样高度 */
function dayPicker(date, past) {
  const now = localDay();
  const dates = [...new Set([now, ...S.days.map((x) => x.date)])].sort().reverse();
  const i = dates.indexOf(date), prev = dates[i + 1], next = i > 0 ? dates[i - 1] : null;
  return `${past ? `<button class="mx-btn mx-btn--secondary dn-today" data-day="${now}">今天</button>` : ""}
    <div class="daynav pick">
      <button class="dn-step" aria-label="前一天" title="前一天" ${prev ? `data-day="${prev}"` : "disabled"}>${ICON.chevL}</button>
      <button class="dn-date mono" id="day-pick" aria-haspopup="menu" aria-expanded="false">${short(date)}${ICON.chevD}</button>
      <button class="dn-step" aria-label="后一天" title="后一天" ${next ? `data-day="${next}"` : "disabled"}>${ICON.chevR}</button>
      <div class="mx-menu" role="menu" hidden>${dates.map((x) => `<button role="menuitemradio" aria-checked="${x === date}" data-day="${x}">${x === now ? "今天" : short(x)}${x === date ? `<span class="mx-check">${ICON.check}</span>` : ""}</button>`).join("")}</div></div>`;
}
const goDay = (x) => { location.hash = x && x !== localDay() ? `#/today/${x}` : "#/today"; };

/** 「今天」页看的是哪一天：null＝今天；地址 #/today/YYYY-MM-DD 看以前的日子（概览、时间线、分类切来切去都停在这天） */
const TD = { date: null };
const isPastDay = () => TD.date && TD.date !== localDay();

async function loadPlan() {
  try { S.todos = await call("get_todos"); } catch (e) { if (!Array.isArray(S.todos)) S.todos = []; }
  try { S.plan = await call("get_plan"); } catch (e) { if (!S.plan) S.plan = { days: {}, week: null }; }
  if (!Array.isArray(S.todos)) S.todos = [];
  if (!S.plan || typeof S.plan !== "object") S.plan = { days: {}, week: null };
  if (!S.plan.days) S.plan.days = {};
}

/** 昨天确认过的待办，放在今天页读数上面 */
function commitmentHtml(date) {
  const yday = addDays(date, -1);
  const items = (S.todos || []).filter((t) => t && t.source === "daily" && t.from_date === yday);
  const skipped = ((S.plan.days || {})[yday] || {}).status === "skipped";
  const w = S.plan.week;
  const weekLine = w && w.start && w.rule && date >= w.start && date <= addDays(w.start, 6)
    ? `<p class="weekline">这周守着「${esc(w.rule)}」${w.project ? `，推进 ${esc(w.project)}` : ""}。</p>` : "";
  if (skipped && !items.length) return weekLine + `<p class="mx-empty-inline">昨晚的「明天」你放下了。</p>`;
  if (!items.length) return weekLine;
  const open = items.filter((t) => !t.done);
  const rows = items.map((t) => `<div class="cmt${t.done ? " is-done" : ""}">
      <button type="button" class="todo-check q2" data-cmt="${esc(t.id)}" role="checkbox" aria-checked="${!!t.done}" aria-label="${t.done ? "标成未完成" : "标成完成"}">${t.done ? ICON.check : ""}</button>
      <div class="cmt-main"><div class="cmt-name">${esc(t.text)}</div><div class="cmt-meta">重要不紧急${t.due_at ? ` · ${esc(dueLabel(t.due_at))}` : ""}</div></div>
    </div>`).join("");
  const protect = date === localDay() && open.length ? `<p class="protect"><span class="mx-tag">保护</span><span>09:30–11:30 · ${esc(open[0].text)}</span></p>` : "";
  return `${weekLine}<section class="mx-sec cmt-sec"><div class="mx-sec-head"><h3>昨天留给你的</h3><span class="mx-sec-aside">${esc(yday.slice(5))} 确认</span></div>${rows}</section>${protect}`;
}

async function renderToday() {
  const today = isPastDay() ? TD.date : localDay(), past = today !== localDay();
  await loadPlan();
  // 今天总有实时数据（电脑来自自采事件，手机来自 iPhone 同步），不再等每晚的数据包；以前的日子按日期取
  const d = (await call("get_day", { date: today })) || { date: today };
  if (TimeSeenFocus.enabled()) d.focus = await TimeSeenFocus.readDay(today).catch((e) => ({ error: String(e) }));
  const pack = d.pack || {}, c = d.live || pack.computer || {}, ph = d.phone;
  const fda = ((S.status || {}).permissions || {}).full_disk_access;
  const phoneCap = ph ? (past ? (ph.pickups != null ? `拿起 ${ph.pickups} 次` : "") : `同步至 ${ymdhm(ph.synced_until)}`) : fda === false ? "未授权完全磁盘访问" : "取不到";
  const hc = hourMinutes(c.active_hours || {});
  const hp = hourMinutes(ph ? ph.hours : (pack.phone || {}).hours);
  const sp = d.speech, visits = (d.places && d.places.visits) || [];
  // 说话按分钟画，不满 1 分钟的也算 1 分钟，免得零碎的几句看不见
  const hw = sp ? Array.from({ length: 24 }, (_, i) => Math.min(60, Math.ceil(((sp.hours || {})[pad2(i)] || 0) / 60))) : null;
  const items = timelineItems(d);
  const counts = { all: items.length, computer: items.filter((x) => x.dev === "computer").length, phone: items.filter((x) => x.dev === "phone" && !x.visit).length };
  if (sp) counts.watch = items.filter((x) => x.dev === "watch").length;
  if ((d.focus && d.focus.sessions || []).length) counts.focus = items.filter((x) => x.dev === "focus").length;
  const tab = TL.tab in counts ? TL.tab : "all";
  const shown = items.filter((x) => tab === "all" || x.dev === tab);
  // 照 Claude：标题下一行，左边「概览｜时间线」纯文字页签；时间线后面接「全部／电脑／手机」切换块；右边放同步时刻
  // 三个页签：全面（面：这一天的汇总看板）、时间线（线：按小时）、地点（点：按停留，去了哪、认定是哪家）
  const view = TL.view === "timeline" ? "timeline" : ["places", "map"].includes(TL.view) ? "places" : "overview";
  const pview = TL.pview === "often" ? "often" : "stays";
  const pseg = `<div class="mx-seg" role="tablist" id="pl-tabs">${[["stays", "停留"], ["often", "常去"]].map(([k, v]) =>
    `<button role="tab" aria-selected="${k === pview}" class="${k === pview ? "is-on" : ""}" data-pv="${k}">${v}</button>`).join("")}</div>`;
  const seg = `<div class="mx-seg" role="tablist" id="tl-tabs">${[["all", "全部"], ["computer", "电脑"], ["phone", "手机"], ["watch", "手表"], ["focus", "专注"]].filter(([k]) => k in counts).map(([k, v]) =>
    `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? "is-on" : ""}" data-tab="${k}">${v}<span class="n">${counts[k]}</span></button>`).join("")}</div>`;
  const toolbar = `<div class="toolbar"><div class="toolbar-left"><div class="tabs" role="tablist" id="view-tabs">${[["overview", "全面"], ["timeline", "时间线"], ["places", "地点"]].map(([k, v]) =>
      `<button role="tab" aria-selected="${k === view}" class="${k === view ? "is-on" : ""}" data-view="${k}">${v}</button>`).join("")}</div>
      ${view === "timeline" ? `<span class="tb-sep"></span>${seg}` : ""}${view === "places" ? `<span class="tb-sep"></span>${pseg}` : ""}</div>
    <div class="toolbar-right">${ph && !past ? `<span class="note tb-note">同步至 ${ymdhm(ph.synced_until)}</span>` : ""}${view === "places" && pview === "often" ? "" : dayPicker(today, past)}</div></div>`;
  const overview = `<div class="readouts">
        ${readout("在电脑前", hh(c.active_sec), "h", c.first ? `${c.first}–${c.last}` : "还没有记录")}
        ${readout("手机", ph || fda !== false ? hh(ph ? ph.total_sec : (pack.phone || {}).total_sec) : "—", "h", phoneCap)}
        ${(() => { const sec = longestSec((c && c.spans) || []); return readout("最长一段", sec ? (sec < 3600 ? String(Math.round(sec / 60)) : hh(sec)) : "—", sec ? (sec < 3600 ? "分钟" : "h") : "", "连续在电脑前"); })()}
        ${sp ? readout("说话", sp.talk_sec < 3600 ? mins(sp.talk_sec) : hh(sp.talk_sec), sp.talk_sec < 3600 ? "分钟" : "h", sp.first ? `录音 ${hm(sp.first)}–${hm(sp.last)}` : past ? "这一天没有录音" : "今天还没有录音") : ""}
        ${readout("切换", c.switches ?? "—", "次", "应用之间切换")}
        ${d.focus && !d.focus.error && d.focus.active_sec > 0 ? readout("主动专注", String(Math.round(d.focus.active_sec / 60)), "分钟", `${d.focus.completed} 个完整番茄 · 与活动时间重叠`) : ""}
        ${visits.length ? readout("去了", new Set(visits.map((v) => v.label || placeName(v).split(" · ")[0])).size, "处", `${visits.length} 段停留`) : ""}
      </div>
      <div style="margin-top:var(--space-6)">`
    + section("一天的形状", dayStrip(hc, hp, true, { hw, visits, date: today }) + `<div class="legend"><span><i style="background:var(--rec-computer)"></i>电脑</span><span><i style="background:var(--rec-phone)"></i>手机</span>${sp ? `<span><i style="background:var(--rec-watch)"></i>说话</span>` : ""}${visits.length ? `<span><i style="background:var(--rec-place-alt)"></i>地点</span><span><i class="line"></i>路上</span>` : ""}</div>`)
    + placeTotals(visits, today)
    + workSection(d.work) + `</div>`;
  if (view === "places" && (pview === "often" || !PL.stats || Date.now() - (PL.at || 0) > 600e3)) {
    [PL.stats, PL.labels] = await Promise.all([call("place_stats", { days: 30 }).catch(() => null), call("list_place_labels").catch(() => [])]);
    PL.at = Date.now();
  }
  const placesView = pview === "often" ? oftenView(PL.stats) : visits.length ? placesSection(visits, today, sp && sp.conversations, pview)
    : emptyInline(past ? "这一天没有停留点" : "今天还没有停留点");
  const timeline = shown.length ? `<div class="tl" id="tl">${tab === "all" ? hourRows(d, items) : tab === "phone" && visits.length ? phoneByPlace(shown, visits, today) : shown.map(tlRow).join("")}</div>`
    : past ? emptyInline(tab === "phone" ? "这一天没有手机记录" : tab === "watch" ? "这一天没有对话" : "这一天没有记录")
    : tab === "phone" ? `<p class="mx-empty-inline">手机记录还没同步过来 · ${howto("screentime", "怎么设置")}</p>`
    : emptyInline(tab === "watch" ? "今天还没有对话" : "今天还没有记录");

  // 照 Claude 自定义页：标题单独一行；页签和右边的控件（同步时刻、翻日期）同一行
  $app.innerHTML = header(past ? short(today) : "今天") + toolbar
    + `<div class="reading">${TimeSeenFocus.todayHtml(today)}${commitmentHtml(today)}${view === "timeline" ? timeline + ((d.focus && d.focus.sessions || []).length ? '<p class="pom-timeline-note">专注是时间的标记，与电脑活动重叠，不重复计入使用时长。</p>' : "") : view === "places" ? placesView : overview}</div>`;
  TimeSeenFocus.bind($app);
  // 地图视图铺满窗口（不受阅读宽度限制）
  $app.classList.toggle("wide", view === "places" && pview === "map");
  $app.querySelectorAll("[data-cmt]").forEach((b) => (b.onclick = async () => {
    const x = (S.todos || []).find((t) => t.id === b.dataset.cmt);
    if (!x) return;
    x.done = !x.done;
    x.updated = new Date().toISOString();
    await call("save_todos", { todos: S.todos });
    renderToday();
  }));
  bindOften();
  const plTabs = document.getElementById("pl-tabs");
  if (plTabs) plTabs.onclick = (e) => {
    const b = e.target.closest("[data-pv]"); if (!b) return;
    TL.pview = b.dataset.pv;
    try { localStorage.setItem("place-view", TL.pview); } catch (err) {}
    renderToday();
  };
  const toPlaces = document.getElementById("to-places");
  if (toPlaces) toPlaces.onclick = () => { TL.view = "places"; try { localStorage.setItem("today-view", "places"); } catch (e) {} renderToday(); window.scrollTo(0, 0); };

  document.getElementById("view-tabs").onclick = (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    TL.view = b.dataset.view;
    try { localStorage.setItem("today-view", TL.view); } catch (err) {}
    renderToday();
  };
  const tlTabs = document.getElementById("tl-tabs");
  if (tlTabs) tlTabs.onclick = (e) => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    TL.tab = b.dataset.tab;
    try { localStorage.setItem("tl-tab", TL.tab); } catch (err) {}
    renderToday();
  };
  layoutPlaceNames($app);
  bindPick(document.getElementById("day-pick"));
  $app.querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => goDay(b.dataset.day)));
  $app.querySelectorAll("[data-chip]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); pickChip(visits, +b.dataset.chip, b.dataset.shop); }));
  $app.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const li = b.closest("li"); EDITOR && EDITOR.parentNode === li ? closeEditor() : placeEditor(visits[+b.dataset.edit], li); }));
  // 点一天的形状里的某个小时：切到时间线，滚到那个小时
  $app.querySelectorAll(".strip [data-h]").forEach((cell) => (cell.onclick = () => {
    TL.view = "timeline"; TL.jump = +cell.dataset.h;
    renderToday();
  }));
  if (view === "timeline" && TL.jump != null) {
    const h = TL.jump; TL.jump = null;
    const rows = [...$app.querySelectorAll("#tl > [data-h]")];
    const hit = rows.filter((r) => +r.dataset.h === h).pop() || rows.find((r) => +r.dataset.h < h);
    if (hit) {
      hit.scrollIntoView({ block: "center" });
      hit.classList.remove("flash"); void hit.offsetWidth; hit.classList.add("flash");
    }
  }
  loadIcons();
}

// ---------- 时间花在哪：按项目、按类型（10 分钟摘要里模型给的标签 × 在电脑前的秒数） ----------

/** 展开着的一级（「domains:工作」这样的键），记在本机，每分钟自动刷新后保持 */
const WORK_OPEN = new Set((() => { try { return JSON.parse(localStorage.getItem("work-open") || "[]"); } catch (e) { return []; } })());

function workSection(w) {
  if (!w || !((w.domains || []).length || (w.activities || []).length)) return "";
  const dur = (sec) => (sec < 3600 ? Math.round(sec / 60) + "m" : hh(sec) + "h");
  // 两级：一级一行，有二级的点开才列；条长按这一列最长的一级比，百分比按这一列合计算
  const tree = (kind, rows) => {
    const max = Math.max(...rows.map((r) => r.sec), 1), total = rows.reduce((a, r) => a + r.sec, 0) || 1;
    const pct = (sec) => { const p = (sec / total) * 100; return p < 1 ? "<1%" : Math.round(p) + "%"; };
    const cells = (r) => `<span class="bar-name" title="${esc(r.name)}">${esc(r.name)}</span><span class="bar"><i style="width:${Math.max(2, Math.round((r.sec / max) * 100))}%"></i></span><span class="bar-v mono">${dur(r.sec)}</span><span class="bar-p mono">${pct(r.sec)}</span>`;
    return `<div class="bars">${rows.map((r) => {
      const kids = r.children.length > 1 || (r.children[0] && r.children[0].name !== r.name) ? r.children.slice(0, 6) : [];
      if (!kids.length) return `<div class="bar-row"><span class="bar-chev"></span>${cells(r)}</div>`;
      const k = `${kind}:${r.name}`, open = WORK_OPEN.has(k);
      return `<div class="bar-grp"><button class="bar-row top" data-work="${esc(k)}" aria-expanded="${open}"><span class="bar-chev">${ICON.chevR}</span>${cells(r)}</button>
        <div class="bar-kids"${open ? "" : " hidden"}>${kids.map((c) => `<div class="bar-row kid"><span class="bar-chev"></span>${cells(c)}</div>`).join("")}</div></div>`;
    }).join("")}</div>`;
  };
  return section("时间花在哪", `<div class="work"><div><h4>为了什么（领域 · 项目）</h4>${tree("domains", w.domains || [])}</div><div><h4>在做什么（类型）</h4>${tree("activities", w.activities || [])}</div></div>`);
}

// 展开／收起一级：直接改这一块，不重画整页
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-work]"); if (!b) return;
  const k = b.dataset.work, open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", open);
  b.nextElementSibling.hidden = !open;
  open ? WORK_OPEN.add(k) : WORK_OPEN.delete(k);
  try { localStorage.setItem("work-open", JSON.stringify([...WORK_OPEN])); } catch (x) {}
});

// ---------- 时间线：电脑的 10 分钟摘要和手机的每次拿起，按设备分页签，新的在上 ----------

/** 「全部」页签按小时：每小时一行（小时摘要＋项目＋电脑和手机用过的 app 图标＋手机用了多久），点开看这一小时的 10 分钟明细和每次拿起；
 *  连着的「不在电脑前、也没碰手机」的小时合成一行灰字 */
function hourRows(d, items) {
  const hourOf = (iso) => { const t = new Date(iso); t.setMinutes(0, 0, 0); return t.getTime(); };
  const roll = Object.fromEntries((d.hours || []).map((h) => [hourOf(h.start), h]));
  const buckets = new Map();
  const put = (k, x) => { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(x); };
  for (const x of items) {
    if (x.dev === "computer" && x.seg.kind === "idle") continue; // 合并过的空段按小时摘要算
    if (x.visit) continue; // 停留点写在每小时行首
    if (x.conv) {
      // 对话按小时切开：每个小时只放这一小时里说的句子
      const by = new Map();
      for (const l of x.conv.lines || []) { const k = hourOf(l.start); if (!by.has(k)) by.set(k, []); by.get(k).push(l); }
      for (const [k, lines] of by) {
        const talk = {};
        for (const l of lines) talk[l.speaker] = (talk[l.speaker] || 0) + (Date.parse(l.end) - Date.parse(l.start)) / 1000;
        put(k, { dev: x.dev, start: lines[0].start, end: lines[lines.length - 1].end, conv: { lines, talk: Object.entries(talk).map(([speaker, sec]) => ({ speaker, sec: Math.round(sec) })) } });
      }
      continue;
    }
    put(hourOf(x.start), x);
  }
  const visits = (d.places && d.places.visits) || [];
  const talkH = (d.speech && d.speech.hours) || {};
  for (const k of Object.keys(roll)) if (!buckets.has(+k)) buckets.set(+k, []);
  const keys = [...buckets.keys()].sort((a, b) => b - a);
  const now = Date.now();
  const out = [];
  let idleRun = null; // 连着的空小时 [最早, 最晚]
  const flushIdle = () => { if (idleRun) { out.push(`<div class="tl-row computer idle" data-h="${new Date(idleRun[0]).getHours()}"><span class="t">${hm(new Date(idleRun[0]).toISOString())}–${hm(new Date(idleRun[1] + 3600e3).toISOString())}</span><span>不在电脑前</span></div>`); idleRun = null; } };
  for (const k of keys) {
    const xs = buckets.get(k), r = roll[k];
    const comp = xs.filter((x) => x.dev === "computer"), ph = xs.filter((x) => x.dev === "phone" && x.ses), wt = xs.filter((x) => x.conv);
    const focuses = xs.filter((x) => x.focus);
    const idle = !comp.length && !focuses.length && (!r || r.title === "不在电脑前") && k + 3600e3 <= now;
    if (idle && !ph.length && !wt.length) { idleRun = idleRun ? [k, idleRun[1]] : [k, k]; continue; }
    flushIdle();
    const phSec = ph.reduce((a, x) => a + x.ses.sec, 0);
    const phApps = {};
    for (const x of ph) for (const a of x.ses.apps) phApps[a.name] = (phApps[a.name] || 0) + a.sec;
    const topPh = Object.entries(phApps).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join("、");
    const latest = comp.find((x) => !x.seg.open)?.seg || (comp[0] && comp[0].seg);
    const title = r && r.title !== "不在电脑前" ? r.title : latest ? latest.title : focuses.length ? `主动专注 · ${focuses[0].focus.task.title}` : "不在电脑前";
    const desc = r && r.title !== "不在电脑前" ? r.description : latest ? latest.description : "";
    // 项目：小时摘要里按秒累计好的，没有（进行中）就用这几段的
    const pj = {};
    for (const p of (r && r.parts) || []) if (p.project) pj[p.project] = (pj[p.project] || 0) + p.sec;
    if (!r) for (const x of comp) for (const p of x.seg.parts || []) if (p.project) pj[p.project] = (pj[p.project] || 0) + (x.seg.active_sec || 0) * p.share;
    const chips = Object.entries(pj).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `<span class="mx-tag">${esc(n)} ${Math.round(v / 60)}m</span>`).join("");
    // 地点只在和上一个小时不一样时写（到了新地方），免得每小时都重复「公司」
    const here = placeAt(visits, k, k + 3600e3), before = placeAt(visits, k - 3600e3, k);
    const where = here && (!before || placeName(before) !== placeName(here)) ? placeName(here) : null;
    const talkSec = talkH[pad2(new Date(k).getHours())] || 0;
    const talkWho = {};
    for (const x of wt) for (const t of x.conv.talk) talkWho[t.speaker] = (talkWho[t.speaker] || 0) + t.sec;
    const who = speakers(Object.entries(talkWho).map(([speaker, sec]) => ({ speaker, sec })), SELF);
    const inner = xs.sort((a, b) => (a.start < b.start ? 1 : -1)).map(tlRow).join("");
    // 这一小时电脑、手机用过的 app 图标（按时间先后，各最多 10 个）
    const cApps = [...new Set([...comp].reverse().flatMap((x) => x.seg.apps || []))];
    const pNames = Object.fromEntries(ph.flatMap((x) => x.ses.apps.map((a) => [a.bundle_id, a.name])));
    const pApps = [...new Set([...ph].reverse().flatMap((x) => x.ses.apps.map((a) => a.bundle_id)))];
    const cIco = icons(cApps, false), pIco = icons(pApps, true, pNames);
    const appsLine = cIco || pIco ? `<div class="hour-apps">${cIco ? `<span class="lbl">电脑</span>${cIco}` : ""}${pIco ? `<span class="lbl">手机</span>${pIco}` : ""}</div>` : "";
    out.push(`<details class="tl-row hour" data-h="${new Date(k).getHours()}"><summary><span class="t">${hm(new Date(k).toISOString())}–${hm(new Date(k + 3600e3).toISOString())}${where ? `<div class="where" title="${esc(where)}">${esc(where)}</div>` : ""}</span><span>
        <span class="name${title === "不在电脑前" ? " dim" : ""}">${esc(title)}</span>${desc ? `<div class="desc">${esc(desc)}</div>` : ""}
        ${chips ? `<div class="chips">${chips}</div>` : ""}${appsLine}${phSec ? `<div class="ph-line">手机 ${minText(phSec)}${topPh ? ` · ${esc(topPh)}` : ""}</div>` : ""}${wt.length ? `<div class="ph-line">对话 ${talkText(talkSec)} · ${esc(who.slice(0, 3).join("、"))}${who.length > 3 ? ` 等 ${who.length} 人` : ""}</div>` : ""}</span>
        ${inner ? `<span class="chev">${ICON.chevR}</span>` : "<span></span>"}</summary>${inner ? `<div class="hour-in">${inner}</div>` : ""}</details>`);
  }
  flushIdle();
  return out.join("");
}


const TL = {
  tab: (() => { try { return localStorage.getItem("tl-tab") || "all"; } catch (e) { return "all"; } })(),
  view: (() => { try { return localStorage.getItem("today-view") || "overview"; } catch (e) { return "overview"; } })(),
  pview: (() => { try { return localStorage.getItem("place-view") || "stays"; } catch (e) { return "stays"; } })(),
  jump: null,
};
const localHour = (iso) => +hm(iso).slice(0, 2);
/** 系统界面这类不是「在用的 app」，不画图标 */
const NOT_APPS = new Set(["com.apple.dock", "com.apple.loginwindow", "com.apple.notificationcenterui", "com.apple.controlcenter", "com.apple.Spotlight", "com.apple.systemuiserver", "com.apple.WindowManager", "org.p0deje.Maccy"]);

/** 这天有摘要的电脑、设备页里改过的名字：时间线每行标上是哪台 */
let DAY_COMPUTERS = [], DAY_NAMES = {};
/** 设备 → 标签：改过名用改的名；没改过 mac-… 叫 Mac、win-… 叫 Windows，同一种有两台时带上机器名 */
function devLabel(dev) {
  if (DAY_NAMES[dev]) return DAY_NAMES[dev];
  const kind = (x) => (x.startsWith("win-") ? "Windows" : x.startsWith("mac-") ? "Mac" : x);
  const k = kind(dev || "");
  return DAY_COMPUTERS.filter((x) => kind(x) === k).length > 1 ? `${k} · ${dev.replace(/^(mac|win)-/, "")}` : k;
}

/** 手机页签：按停留点分组，新的在上。每组一行标题（地点、起止、待了多久），这段时间里拿手机的记录排在它下面；
 *  两个停留点之间的空档也成一组（路上／没记到位置），没有拿手机就不列 */
function phoneByPlace(items, visits, date) {
  const ses = items.filter((x) => !x.visit);
  const blocks = placeBlocks(visits, date).map((b) => ({ ...b, items: [] }));
  for (const x of ses) {
    const t = Date.parse(x.start);
    const b = blocks.find((y) => t >= y.a && t < y.z) || (t < blocks[0].a ? blocks[0] : blocks[blocks.length - 1]);
    b.items.push(x);
  }
  return blocks.reverse().filter((b) => b.kind === "stay" || b.items.length).map((b) => {
    const h = `data-h="${new Date(b.a).getHours()}"`;
    const head = b.kind === "stay"
      ? `<div class="tl-place" ${h}><span class="t">${visitSpan(b.v)}</span><span class="n"><i></i>${esc(placeName(b.v))}</span><span class="d">${spanText((b.z - b.a) / 1000)}${b.items.some((x) => x.ses) ? ` · 手机 ${minText(b.items.reduce((n, x) => n + (x.ses ? x.ses.sec : 0), 0))}` : ""}</span></div>`
      : `<div class="tl-place gap" ${h}><span class="t">${hmMs(b.a)}–${hmMs(b.z)}</span><span class="n">${b.kind === "go" ? "路上" : "没记到位置"}</span><span class="d">${spanText((b.z - b.a) / 1000)}</span></div>`;
    return head + b.items.sort((x, y) => (x.start < y.start ? 1 : -1)).map(tlRow).join("");
  }).join("");
}

function timelineItems(d) {
  DAY_COMPUTERS = d.computers || [];
  DAY_NAMES = d.device_names || {};
  const out = [];
  for (const f of (d.focus && d.focus.sessions) || []) out.push({ dev: "focus", start: f.started_at, end: f.ended_at, focus: f });
  for (const s of d.segments || []) out.push({ dev: "computer", start: s.start, end: s.end, seg: s });
  for (const x of (d.phone && d.phone.sessions) || []) out.push({ dev: "phone", start: x.start, end: x.end, ses: x });
  for (const v of (d.places && d.places.visits) || []) out.push({ dev: "phone", start: v.start, end: v.end, visit: v });
  SELF = (d.speech && d.speech.self) || null;
  // 对话按录它的设备归页签：手表录的在「手表」，iPhone 自己录的在「手机」
  for (const c of (d.speech && d.speech.conversations) || []) out.push({ dev: (c.device || "").startsWith("iphone-") ? "phone" : "watch", start: c.start, end: c.end, conv: c });
  return out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

const minText = (sec) => (sec < 60 ? `${sec} 秒` : `${Math.round(sec / 60)} 分钟`);

function icons(ids, phone, names = {}) {
  const list = ids.filter((b) => b && !NOT_APPS.has(b)).slice(0, 10);
  if (!list.length) return "";
  return `<div class="apps">${list.map((b) => {
    const name = names[b] || b.split(".").pop();
    return `<span class="ico" data-b="${esc(b)}" data-p="${phone ? 1 : 0}" title="${esc(name)}">${esc((name[0] || "?").toUpperCase())}</span>`;
  }).join("")}</div>`;
}

/** 本人在转写里的名字（录音服务器按声纹认出的那个） */
let SELF = null;

/** 一段对话：标题行写时长和谁在说，第一句做预览，点开看原文 */
function convRow(c, h, t) {
  const who = speakers(c.talk || [], SELF);
  const sec = (c.talk || []).reduce((a, x) => a + x.sec, 0);
  const first = (c.lines || []).find((l) => l.text.length >= 4) || (c.lines || [])[0];
  const lines = (c.lines || []).map((l) => `<li><span class="ut">${hm(l.start)}${new Date(l.start).getSeconds() ? ":" + pad2(new Date(l.start).getSeconds()) : ":00"}</span><span class="who${l.speaker === SELF ? " self" : ""}">${esc(l.speaker)}</span><span>${esc(l.text)}</span></li>`).join("");
  return `<details class="tl-row watch" ${h}><summary>${t}<span><span class="name">对话 · ${talkText(sec)}</span><div class="desc">${esc(who.slice(0, 4).join("、"))}${who.length > 4 ? ` 等 ${who.length} 人` : ""}</div>${first ? `<div class="talk-line">${esc(first.speaker)}：${esc(first.text.length > 60 ? first.text.slice(0, 60) + "…" : first.text)}</div>` : ""}</span><span class="chev">${ICON.chevR}</span></summary>
    <div class="more"><ul class="utts">${lines}</ul><p class="note" style="margin:0">手表录音转写，可能有错字。「${esc(SELF || "本人")}」按声纹认出，「他人N」只在当天内是同一个人，「未辨」是太短认不出。</p></div></details>`;
}

function tlRow(x) {
  const t = `<span class="t">${hm(x.start)}–${x.end ? hm(x.end) : "现在"}</span>`;
  const h = `data-h="${localHour(x.start)}"`;
  if (x.focus) {
    const f = x.focus;
    return `<div class="tl-row focus" ${h}>${t}<span><span class="name">${TimeSeenFocus.ico("timer")}${esc(f.task.title)}<span class="mx-tag">专注 · ${Math.round((f.day_sec ?? f.active_ms / 1000) / 60)} 分钟${f.reason === "early" ? " · 提前结束" : ""}</span></span>${f.note ? `<div class="desc">${esc(f.note)}</div>` : ""}${f.task.project ? `<div class="desc">关联项目 · ${esc(f.task.project)}</div>` : ""}</span></div>`;
  }
  if (x.conv) return convRow(x.conv, h, t);
  if (x.visit) return `<div class="tl-row phone place" ${h}>${t}<span><span class="name">在 ${esc(x.visit.name || "没有地名的地方")}</span></span></div>`;
  if (x.dev === "phone") {
    const s = x.ses;
    const names = Object.fromEntries(s.apps.map((a) => [a.bundle_id, a.name]));
    if (s.kind === "brief") return `<div class="tl-row phone brief" ${h}>${t}<span><span class="name">手机 · 拿起 ${s.count} 次，共 ${minText(s.sec)}</span>${icons(s.apps.map((a) => a.bundle_id), true, names)}</span></div>`;
    const top = s.apps.filter((a) => a.sec >= 5).slice(0, 4).map((a) => `${esc(a.name)} ${minText(a.sec)}`).join("、");
    return `<div class="tl-row phone" ${h}>${t}<span><span class="name">手机 · ${minText(s.sec)}</span>${top ? `<div class="desc">${top}</div>` : ""}${icons(s.apps.map((a) => a.bundle_id), true, names)}</span></div>`;
  }
  const s = x.seg;
  // 连续的「不在电脑前」已由 Rust 合成一段：一行灰字，不能展开
  if (s.kind === "idle") return `<div class="tl-row computer idle" ${h}>${t}<span>${esc(s.title)}</span></div>`;
  // 当前未收口的 10 分钟段：占位提示，不是丢数据
  if (s.open) return `<div class="tl-row computer open" ${h}>${t}<span><span class="name">${esc(s.title || "进行中")}</span>${s.description ? `<div class="desc">${esc(s.description)}</div>` : ""}</span></div>`;
  const ctx = (s.context || []).filter((y) => !y.includes("/Users/"));
  const more = [
    ctx.length ? `<div><h4>涉及</h4>${md(ctx.map((y) => "- " + y).join("\n"))}</div>` : "",
    s.recording ? `<div><h4>经过</h4>${md(s.recording)}</div>` : s.memory ? `<div><h4>经过</h4>${md(s.memory)}</div>` : "",
  ].join("");
  const tag = (s.kind === "6h" ? `<span class="mx-tag">6 小时</span>` : s.source === "codex" ? `<span class="mx-tag">Codex</span>` : "")
    + (s.device ? `<span class="mx-tag">${esc(devLabel(s.device))}</span>` : "");
  return `<details class="tl-row computer" ${h}><summary>${t}<span><span class="name">${esc(s.title || "（没有标题）")}${tag}</span>${s.description ? `<div class="desc">${esc(s.description)}</div>` : ""}${icons(s.apps || [], false)}</span>${more ? `<span class="chev">${ICON.chevR}</span>` : "<span></span>"}</summary>${more ? `<div class="more">${more}</div>` : ""}</details>`;
}

/** 先画首字母，图标取到后换上（手机 app 第一次要联网查，之后走缓存） */
const ICONS = { 0: {}, 1: {} };
async function loadIcons() {
  for (const p of [0, 1]) {
    const els = [...$app.querySelectorAll(`.ico[data-p="${p}"]`)];
    const need = [...new Set(els.map((e) => e.dataset.b))].filter((b) => !(b in ICONS[p]));
    if (need.length && TAURI) Object.assign(ICONS[p], await call("get_icons", { ids: need, phone: !!p }).catch(() => ({})));
    for (const e of $app.querySelectorAll(`.ico[data-p="${p}"]`)) {
      const got = ICONS[p][e.dataset.b];
      // 名字表里没有的 app，用 App Store 上的名字
      if (got && got.name && e.title === e.dataset.b.split(".").pop()) e.title = got.name;
      if (got && got.icon && !e.querySelector("img")) { e.textContent = ""; e.classList.add("has-img"); const img = new Image(); img.src = got.icon; img.alt = ""; e.appendChild(img); }
    }
  }
}

// ---------- 日总结 ----------

const SUM = { err: null, picks: [], forDate: null, lastDate: null, editing: false, raw: "" };

function tomorrowHtml(date, sum) {
  if (!sum) return "";
  const part = sum.parts.find((p) => p.title === "明天");
  const lines = bulletsOf(part && part.body);
  const saved = (S.plan.days || {})[date] || {};
  const already = saved.status === "committed" || (S.todos || []).some((t) => t.source === "daily" && t.from_date === date);
  if (saved.status === "skipped" && !already) return section("明天", `<p class="mx-empty-inline">这晚的明天你放下了。</p>`);
  if (!lines.length) return "";
  if (SUM.forDate !== date || SUM.picks.length !== lines.length) { SUM.forDate = date; SUM.picks = lines.map(() => true); }
  const rows = lines.map((text, i) => {
    const on = already || !!SUM.picks[i];
    return `<div class="cmt${on ? "" : " is-off"}"><button type="button" class="todo-check q2" data-pick="${i}" role="checkbox" aria-checked="${on}" ${already ? "disabled" : ""}>${on ? ICON.check : ""}</button><div class="cmt-main"><div class="cmt-name">${esc(text)}</div><div class="cmt-meta">约 25 分钟 · 重要不紧急 · 次日 09:30</div></div></div>`;
  }).join("");
  const n = (SUM.picks || []).filter(Boolean).length;
  const acts = already
    ? `<p class="note" style="margin-top:8px">这晚的明天已经写成待办。</p>`
    : `<div class="commit-acts"><button type="button" class="mx-btn mx-btn--primary" id="cmt-commit" ${n ? "" : "disabled"}>写成明天的 ${n} 条</button><button type="button" class="mx-btn mx-btn--text" id="cmt-skip">今晚先不承诺</button></div>`;
  return section("明天", `<p class="note">勾着的写成次日 09:30 的待办，默认重要不紧急。放下的不会进待办。</p>${rows}${acts}`);
}

async function commitTomorrow(date, lines) {
  const chosen = lines.filter((_, i) => SUM.picks[i]);
  const dropped = lines.filter((_, i) => !SUM.picks[i]);
  const now = new Date().toISOString();
  const due = dueJoin(addDays(date, 1), "09:30");
  if (!Array.isArray(S.todos)) S.todos = [];
  for (const text of chosen) {
    if (S.todos.some((t) => t.source === "daily" && t.from_date === date && t.text === text)) continue;
    S.todos.unshift({ id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, done: false, due_at: due, quadrant: 2, source: "daily", from_date: date, created: now, updated: now });
  }
  await call("save_todos", { todos: S.todos });
  S.plan.days[date] = { status: "committed", dropped };
  await call("save_plan", { plan: S.plan });
}

async function renderWeek() {
  markNav("summary");
  await loadPlan();
  const w = await call("get_week", { date: localDay() }).catch(() => null);
  const kinds = `<div class="tabs" role="tablist"><button type="button" role="tab" id="go-day">日</button><button type="button" role="tab" class="is-on" aria-selected="true">周</button><button type="button" role="tab" disabled title="先不做月">月</button></div>`;
  if (!w) { $app.innerHTML = header("总结") + `<div class="toolbar">${kinds}</div>` + emptyInline("这一周的数还取不到。"); document.getElementById("go-day").onclick = () => { location.hash = SUM.lastDate ? `#/summary/${SUM.lastDate}` : "#/summary"; }; return; }
  const max = Math.max(...(w.projects || []).map((p) => p.sec), 1);
  const total = (w.projects || []).reduce((a, p) => a + p.sec, 0) || 1;
  const bars = (w.projects || []).map((p) => `<div class="bar-row"><span class="bar-chev"></span><span class="bar-name">${esc(p.name)}</span><span class="bar"><i style="width:${Math.max(2, Math.round((p.sec / max) * 100))}%"></i></span><span class="bar-v mono">${p.sec < 3600 ? Math.round(p.sec / 60) + "m" : hh(p.sec) + "h"}</span><span class="bar-p mono">${Math.round((p.sec / total) * 100)}%</span></div>`).join("");
  const rules = (w.rules || []).map((r) => `<div class="week-rule"><span>${esc(r.text)}</span><span class="streak">${(r.marks || []).map((m) => `<i class="${esc(m)}"></i>`).join("")}</span><b class="mono">${r.total ? `${r.kept}/${r.total}` : "—"}</b></div>`).join("");
  const items = (w.items || []).map((t) => `<div class="cmt${t.done ? " is-done" : ""}${t.dropped ? " is-off" : ""}"><span class="todo-check q2" aria-checked="${!!t.done}">${t.done ? ICON.check : ""}</span><div class="cmt-main"><div class="cmt-name">${esc(t.text)}</div>${t.dropped ? `<div class="cmt-meta">放下了</div>` : t.done ? "" : `<div class="cmt-meta">没做</div>`}</div></div>`).join("");
  const doneN = (w.items || []).filter((t) => t.done).length;
  const dropN = (w.items || []).filter((t) => t.dropped).length;
  const openN = (w.items || []).filter((t) => !t.done && !t.dropped).length;
  const dl = w.delta || {};
  const dStr = (pct) => {
    if (pct == null) return "";
    const s = pct > 0 ? `+${pct}%` : `${pct}%`;
    return `<span class="delta ${pct > 0 ? "up" : pct < 0 ? "down" : "flat"}">${s} vs 上周</span>`;
  };
  const promPct = (dl.promise_done || 0) + (dl.promise_undone || 0) > 0
    ? `兑现 ${Math.round((dl.promise_done || 0) / ((dl.promise_done || 0) + (dl.promise_undone || 0)) * 100)}%`
    : "";
  const ruleBtns = (w.rules || []).filter((r) => r.text).map((r, i) => `<button type="button" data-wrule aria-checked="${i === 0 ? "true" : "false"}">${esc(r.text)}</button>`).join("");
  const projBtns = (w.projects || []).slice(0, 6).map((p, i) => `<button type="button" data-wproj aria-checked="${i === 0 ? "true" : "false"}">${esc(p.name)}</button>`).join("");
  $app.innerHTML = header("总结") + `<div class="toolbar">${kinds}<span class="daychip mono">${esc(w.start.slice(5))}–${esc(w.end.slice(5))}</span></div>` + `<div class="reading">
    ${section("时间花在哪", bars || `<p class="mx-empty-inline">这一周还没有分成项目的时间。</p>`, { aside: `七天合计 ${dStr(dl.active_pct)}` })}
    ${section("规矩", rules || `<p class="mx-empty-inline">还没有规矩。</p>`, { aside: `守住了几天 ${dStr(dl.late_pct)}` })}
    ${section("承诺", items || `<p class="mx-empty-inline">这周还没有从日总结写成的待办。</p>`, { aside: `${promPct} · 完成 ${doneN} · 没做 ${openN} · 放下 ${dropN}` })}
    ${section("这周", `<p class="note">选完以后，这周剩下的「今天」顶上都会靠着它们。</p>
      ${ruleBtns ? `<div class="pick-block"><div class="k">只守一条</div><div class="choices" id="rule-choices">${ruleBtns}</div></div>` : ""}
      ${projBtns ? `<div class="pick-block"><div class="k">只推进一个项目</div><div class="choices" id="proj-choices">${projBtns}</div></div>` : ""}
      <div class="commit-acts"><button type="button" class="mx-btn mx-btn--primary" id="week-set" ${ruleBtns ? "" : "disabled"}>就按这个</button></div>`)}
  </div>`;
  document.getElementById("go-day").onclick = () => { location.hash = SUM.lastDate ? `#/summary/${SUM.lastDate}` : "#/summary"; };
  $app.querySelectorAll(".choices").forEach((box) => (box.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", x === b ? "true" : "false"));
  }));
  const set = document.getElementById("week-set");
  if (set) set.onclick = async () => {
    const rule = ($app.querySelector("#rule-choices [aria-checked='true']") || {}).textContent || "";
    const project = ($app.querySelector("#proj-choices [aria-checked='true']") || {}).textContent || "";
    if (!rule) return;
    S.plan.week = { start: mondayOf(localDay()), rule, project };
    await call("save_plan", { plan: S.plan });
    location.hash = "#/today";
  };
}

async function renderSummary(arg) {
  if (arg === "week") return renderWeek();
  await loadPlan();
  // 同「今天」翻日期：本地今天即使还没进 list_days（摘要未写出）也要能打开总结页
  const now = localDay();
  const dates = [...new Set([now, ...S.days.map((x) => x.date)])].sort().reverse();
  const date = dates.includes(arg) ? arg : dates[0];
  if (!date) { $app.innerHTML = header("总结") + emptyInline("还没有日数据。"); return; }
  SUM.lastDate = date;
  markNav("summary");
  const i = dates.indexOf(date);
  const prev = dates[i + 1], next = dates[i - 1];
  const d = await call("get_day", { date });
  const idx = S.days.find((x) => x.date === date) || {};
  const pack = (d && d.pack) || {}, ph = (d && d.phone) || null;
  // 还没有数据包（通常是今天）：电脑读数用自采事件实时算的
  const c = pack.computer && pack.computer.active_sec != null && !pack.partial ? pack.computer : (d && d.live) || pack.computer || {};
  const pp = pack.phone || {};
  // 熬夜＝这一晚：当天 21:00 以后＋次日 0–5 点（规格/日总结.md：凌晨 0–5 点属于前一晚），电脑和手机分别算再相加
  const nd = addDays(date, 1);
  const n = dates.includes(nd) ? await call("get_day", { date: nd }) : null;
  const npack = (n && n.pack) || {};
  const lateC = c.late_sec ?? secsAfter((d && d.live && d.live.spans) || [], date, 21);
  const lateP = ph ? ph.late_sec || 0 : pp.late_sec || 0;
  const dawnP = n ? (n.phone ? n.phone.night_sec || 0 : (npack.phone || {}).dawn_sec || 0) : 0;
  const dawnC = n ? hourSecs((n.live && n.live.active_hours) ? n.live : npack.computer).slice(0, 5).reduce((a, b) => a + b, 0) : 0;
  const night = Math.round((lateC + lateP + dawnP + dawnC) / 60);
  const hasNight = c.late_sec != null || (d && d.live) || ph || pp.late_sec != null;
  const sum = d && d.summary_md ? splitSummary(d.summary_md) : null;

  const right = `<button class="mx-iconbtn" id="prev" aria-label="前一天" title="前一天" ${prev ? "" : "disabled"}>${ICON.chevL}</button>
    <button class="mx-iconbtn" id="next" aria-label="后一天" title="后一天" ${next ? "" : "disabled"}>${ICON.chevR}</button>
    <div class="pick"><button class="mx-btn mx-btn--secondary mono" id="pick" aria-haspopup="menu" aria-expanded="false">${short(date)}${ICON.chevD}</button>
      <div class="mx-menu" role="menu" id="pick-menu" hidden>${dates.map((x) => `<button role="menuitemradio" aria-checked="${x === date}" data-date="${x}">${short(x)}${x === date ? `<span class="mx-check">${ICON.check}</span>` : ""}</button>`).join("")}</div></div>`;

  // 最近 14 天：截至这一天
  const byDate = Object.fromEntries(S.days.map((x) => [x.date, x]));
  const rows = Array.from({ length: 14 }, (_, k) => {
    const ymd = addDays(date, k - 13), x = byDate[ymd];
    return { date: ymd, has: !!x, hc: hourMinutes(x && x.hc), hp: hourMinutes(x && x.hp) };
  });
  const after = byDate[nd];
  if (after) rows[rows.length - 1].next = { hc: hourMinutes(after.hc), hp: hourMinutes(after.hp) };

  // 布局照 Claude「自定义」页：标题单独一行；下面一行左边 日／周／月 页签（周、月后续做），右边翻日期
  const kinds = `<div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true" class="is-on">日</button><button type="button" role="tab" id="go-week">周</button><button type="button" role="tab" disabled title="先不做月">月</button></div>`;
  const lines = bulletsOf(sum && (sum.parts.find((p) => p.title === "明天") || {}).body);
  $app.innerHTML = header("总结") + `<div class="toolbar">${kinds}<div class="toolbar-right">${right}</div></div>` + `<div class="reading">
    ${tomorrowHtml(date, sum)}
    <div class="readouts">
      ${readout("在电脑前", hh(c.active_sec ?? idx.active_sec), "h", c.first ? `${c.first}–${c.last}` : "取不到")}
      ${readout("手机", hh(ph ? ph.total_sec : pp.total_sec ?? idx.phone_sec), "h", ph ? `同步至 ${ymdhm(ph.synced_until)}` : pp.synced_at ? `同步至 ${pp.synced_at}` : "取不到")}
      ${readout("拿起", ph ? ph.pickups : pp.pickups ?? "—", "次", "", false, "按前台空档推算")}
      ${readout("熬夜", hasNight ? night : "—", "分钟", "21:00–5:00", night > 10)}
    </div>
    ${sum ? `<div class="gen-empty" style="margin:var(--space-3) 0 0">${sum.note ? `<p class="note">${esc(sum.note)}</p>` : ""}<div class="mockbar"><span class="seg${SUM.editing ? " on" : ""}" id="toggle-edit">编辑</span><span class="seg" id="toggle-preview">预览</span><button class="mx-btn mx-btn--secondary mx-btn--sm" id="gen-daily">重新生成</button></div>${SUM.err ? `<div class="mx-field-error">${esc(SUM.err)}</div>` : ""}</div>` : ""}
    <div style="margin-top:var(--space-6)">
      ${sum && SUM.editing ? `<div class="sketch"><textarea id="edit-summary" style="width:100%;min-height:400px;font-family:var(--font-mono);font-size:13px;line-height:1.6;padding:12px;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface);color:var(--ink)">${esc(d.summary_md)}</textarea></div>
        <div class="commit-acts"><button type="button" class="mx-btn mx-btn--primary mx-btn--sm" id="save-summary">保存修改</button><button type="button" class="mx-btn mx-btn--text mx-btn--sm" id="cancel-edit">放弃</button></div>`
      : sum ? sum.parts.filter((p) => p.title !== "明天").map((p) => section(p.title, p.title === "今天的一句话" ? `<p class="quote">${esc(p.body)}</p>` : md(p.body))).join("")
            : section("这一天", `<div class="gen-empty"><p class="mx-empty-inline">还没有日总结，21:30 自动生成</p>
                <button class="mx-btn mx-btn--primary mx-btn--sm" id="gen-daily">现在生成</button>${SUM.err ? `<div class="mx-field-error">${esc(SUM.err)}</div>` : ""}</div>`)}
      ${section("最近 14 天", actogram(rows, date))}
    </div></div>`;

  const weekBtn = document.getElementById("go-week");
  if (weekBtn) weekBtn.onclick = () => { location.hash = "#/summary/week"; };
  $app.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
    const i = +b.dataset.pick;
    SUM.picks[i] = !SUM.picks[i];
    renderSummary(date);
  }));
  const commitBtn = document.getElementById("cmt-commit");
  if (commitBtn) commitBtn.onclick = async () => { commitBtn.disabled = true; await commitTomorrow(date, lines); renderSummary(date); };
  const skipBtn = document.getElementById("cmt-skip");
  if (skipBtn) skipBtn.onclick = async () => {
    S.plan.days[date] = { status: "skipped", dropped: lines };
    await call("save_plan", { plan: S.plan });
    renderSummary(date);
  };
  const gen = document.getElementById("gen-daily");
  if (gen) gen.onclick = async () => {
    gen.disabled = true; gen.textContent = "生成中…"; SUM.err = null;
    try { await call("generate_daily", { date }); } catch (x) { SUM.err = String(x); }
    renderSummary(date);
  };
  const toggleEdit = document.getElementById("toggle-edit");
  if (toggleEdit) toggleEdit.onclick = () => { SUM.editing = true; renderSummary(date); };
  const togglePreview = document.getElementById("toggle-preview");
  if (togglePreview) togglePreview.onclick = () => { SUM.editing = false; renderSummary(date); };
  const saveBtn = document.getElementById("save-summary");
  if (saveBtn) saveBtn.onclick = async () => {
    const txt = document.getElementById("edit-summary").value;
    try { await call("save_summary", { date, text: txt }); SUM.editing = false; renderSummary(date); }
    catch (x) { SUM.err = String(x); renderSummary(date); }
  };
  const cancelBtn = document.getElementById("cancel-edit");
  if (cancelBtn) cancelBtn.onclick = () => { SUM.editing = false; renderSummary(date); };
  const go = (x) => { if (x) location.hash = `#/summary/${x}`; };
  document.getElementById("prev").onclick = () => go(prev);
  document.getElementById("next").onclick = () => go(next);
  const pick = document.getElementById("pick"), menu = document.getElementById("pick-menu");
  pick.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; pick.setAttribute("aria-expanded", String(!menu.hidden)); };
  menu.onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.date); };
}


// ---------- 待办／备忘（本机，不对接滴答） ----------

const NS = { tab: "todos", deleting: null }; // tab: todos | memos

/** 四象限：1 重要且紧急 · 2 重要不紧急 · 3 不重要但紧急 · 4 不重要不紧急 */
const QUADS = [
  { id: 1, roman: "I", name: "重要且紧急", short: "且紧急", cls: "q1" },
  { id: 2, roman: "II", name: "重要不紧急", short: "不紧急", cls: "q2" },
  { id: 3, roman: "III", name: "不重要但紧急", short: "但紧急", cls: "q3" },
  { id: 4, roman: "IV", name: "不重要不紧急", short: "不紧急", cls: "q4" },
];
const quadOf = (t) => {
  const n = +((t && t.quadrant) || 4);
  return (n >= 1 && n <= 4) ? n : 4;
};
const quadMeta = (id) => QUADS.find((q) => q.id === id) || QUADS[3];

/** due_at：本地 "YYYY-MM-DDTHH:mm" 或 ISO；空＝无日期 */
const dueParts = (due) => {
  if (!due) return { date: "", time: "" };
  const s = String(due).trim().replace(/\//g, "-");
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return { date: m[1], time: `${m[2]}:${m[3]}` };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, time: "" };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return { date: localDay(d), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
};
/** 把 date／time 输入规整成 YYYY-MM-DD、HH:mm（有的 WebView 会给出斜杠或只有一位） */
const dueNormDate = (v) => {
  const s = String(v || "").trim().replace(/\//g, "-");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}` : "";
};
const dueNormTime = (v) => {
  const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad2(+m[1])}:${m[2]}` : "";
};
const dueJoin = (date, time) => {
  const d = dueNormDate(date);
  if (!d) return "";
  const t = dueNormTime(time);
  return t ? `${d}T${t}` : `${d}T23:59`;
};
/** 新建待办的默认截止：今天＋当前时刻（空 value 的 date／time 在 macOS WebView 里仍可能「看起来」有日期，保存却是无日期） */
const dueDefaultNow = () => {
  const n = new Date();
  return { date: localDay(n), time: `${pad2(n.getHours())}:${pad2(n.getMinutes())}` };
};
const dueLabel = (due) => {
  const { date, time } = dueParts(due);
  if (!date) return "";
  const t = time && time !== "23:59" ? ` ${time}` : "";
  return `${date.slice(5).replace("-", "/")}${t}`;
};
const dueOverdue = (due) => {
  if (!due) return false;
  const { date, time } = dueParts(due);
  if (!date) return false;
  const end = new Date(`${date}T${time || "23:59"}:00`);
  return end.getTime() < Date.now();
};
const normalizeTodo = (t) => {
  if (!t || typeof t !== "object") return t;
  if (t.quadrant == null) t.quadrant = 4;
  if (t.due_at == null) t.due_at = "";
  return t;
};

function todoDialog(item, save, presetQuad) {
  const q0 = item ? quadOf(item) : (presetQuad || 4);
  // 新建：显式写入今天＋现在，避免空控件「看着有日期、存下来却是无日期」；改已有条目仍按原 due_at（空＝真无日期）
  const dp = item ? dueParts(item.due_at) : dueDefaultNow();
  const flags = QUADS.map((q) => `<button type="button" class="todo-qbtn ${q.cls}${q.id === q0 ? " is-on" : ""}" data-q="${q.id}" title="${esc(q.name)}" aria-pressed="${q.id === q0}"><span class="todo-qbadge">${q.roman}</span><span class="todo-qlabel">${esc(q.name)}</span></button>`).join("");
  openDialog({
    title: item ? "改待办" : "加一条待办", ok: item ? "保存改动" : "加上这条",
    body: `<div class="todo-dlg">
      <div class="mx-field"><label for="todo-text">准备做什么？</label>
        <textarea class="mx-input dlg-ta" id="todo-text" placeholder="准备做什么？">${esc(item ? item.text : "")}</textarea></div>
      <div class="mx-field"><label>日期与时间（可空＝无日期）</label>
        <div class="todo-due">
          <input class="mx-input" type="date" id="todo-date" value="${esc(dp.date)}" aria-label="日期">
          <input class="mx-input" type="time" id="todo-time" value="${esc(dp.time)}" aria-label="时间">
          <button type="button" class="mx-btn mx-btn--secondary mx-btn--sm" id="todo-due-clear">清除</button>
        </div></div>
      <div class="mx-field"><label>优先级（四象限）</label>
        <div class="todo-qgrid" id="todo-quad" role="group" aria-label="四象限">${flags}</div>
        <input type="hidden" id="todo-quadrant" value="${q0}">
      </div>
      <p class="note">只存在这台电脑。新加的默认重要不紧急。⌘↩ 保存。</p>
    </div>`,
    onOpen: (el) => {
      const hid = el.querySelector("#todo-quadrant");
      el.querySelector("#todo-quad").onclick = (e) => {
        const b = e.target.closest("[data-q]"); if (!b) return;
        el.querySelectorAll("#todo-quad [data-q]").forEach((x) => {
          const on = x === b;
          x.classList.toggle("is-on", on);
          x.setAttribute("aria-pressed", String(on));
        });
        hid.value = b.dataset.q;
      };
      el.querySelector("#todo-due-clear").onclick = () => {
        el.querySelector("#todo-date").value = "";
        el.querySelector("#todo-time").value = "";
      };
    },
    submit: async (el) => {
      const text = dlgVal(el, "todo-text");
      if (!text) throw "先写准备做什么。";
      const date = el.querySelector("#todo-date").value;
      const time = el.querySelector("#todo-time").value;
      const due_at = dueJoin(date, time);
      const quadrant = Math.min(4, Math.max(1, +el.querySelector("#todo-quadrant").value || 4));
      const now = new Date().toISOString();
      if (item) {
        const x = S.todos.find((t) => t.id === item.id);
        x.text = text; x.due_at = due_at; x.quadrant = quadrant; x.updated = now;
      } else {
        S.todos.unshift({ id: "t" + Date.now().toString(36), text, done: false, due_at, quadrant, created: now, updated: now });
      }
      await save();
    },
  });
}

function memoDialog(item, save) {
  openDialog({
    title: item ? "改备忘" : "写一条备忘", ok: item ? "保存改动" : "存好",
    body: `<div class="mx-field"><label for="memo-title">标题（可选）</label><input class="mx-input" id="memo-title" value="${esc(item ? (item.title || "") : "")}" placeholder="一句话标题"></div>
      <div class="mx-field"><label for="memo-body">内容</label><textarea class="mx-input dlg-ta dlg-ta--lg" id="memo-body" placeholder="随便记">${esc(item ? (item.body || "") : "")}</textarea>
      <p class="note">只存在这台电脑，⌘↩ 保存。</p></div>`,
    submit: async (el) => {
      const title = dlgVal(el, "memo-title");
      const body = dlgVal(el, "memo-body");
      if (!title && !body) throw "标题和内容至少写一样。";
      const now = new Date().toISOString();
      if (item) {
        const x = S.memos.find((m) => m.id === item.id);
        x.title = title; x.body = body; x.updated = now;
      } else {
        S.memos.unshift({ id: "m" + Date.now().toString(36), title, body, created: now, updated: now });
      }
      await save();
    },
  });
}

/** 一条待办在象限里的行 */
function todoBoardRow(t) {
  const over = !t.done && dueOverdue(t.due_at);
  const due = dueLabel(t.due_at);
  const q = quadMeta(quadOf(t));
  return `<div class="todo qrow${t.done ? " done" : ""}${over ? " overdue" : ""}" data-id="${t.id}">
    <div class="mx-row">
      <button class="todo-check ${q.cls}" role="checkbox" aria-checked="${!!t.done}" aria-label="${t.done ? "标成未完成" : "标成完成"}" data-act="toggle">${t.done ? ICON.check : ""}</button>
      <div class="mx-row-main">
        <div class="mx-row-name">${esc(t.text)}</div>
        <div class="todo-meta">${due ? `<span class="todo-due-l${over ? " over" : ""}">${over ? "已过期 · " : ""}${esc(due)}</span>` : `<span class="todo-due-l muted">无日期</span>`}${t.source === "daily" && t.from_date ? `<span class="todo-due-l"> · 来自 ${esc(String(t.from_date).slice(5))} 的日总结</span>` : ""}</div>
      </div>
      <div class="acts">${!t.done && TimeSeenFocus.enabled() ? `<button class="mx-btn mx-btn--text mx-btn--sm" data-act="focus">${TimeSeenFocus.ico("timer")}专注</button>` : ""}<button class="mx-btn mx-btn--text mx-btn--sm" data-act="edit">改</button><button class="mx-btn mx-btn--text mx-btn--sm" data-act="delete">删除</button></div>
    </div>
    ${NS.deleting === t.id ? `<div class="mx-confirm"><div class="mx-confirm-text"><b>删除这条待办？</b><span>删了找不回来。</span></div><button class="mx-btn mx-btn--secondary" data-act="keep">取消</button><button class="mx-btn mx-btn--danger" data-act="remove">删除这条</button></div>` : ""}
  </div>`;
}

/** 象限内：已过期 / 有日期 / 无日期 */
function todoQuadBody(items) {
  if (!items.length) return `<p class="todo-empty">没有任务</p>`;
  const overdue = items.filter((t) => dueOverdue(t.due_at));
  const dated = items.filter((t) => t.due_at && !dueOverdue(t.due_at));
  const none = items.filter((t) => !t.due_at);
  const blk = (title, xs) => xs.length ? `<div class="todo-group"><div class="todo-group-h">${esc(title)} <span class="n">${xs.length}</span></div>${xs.map(todoBoardRow).join("")}</div>` : "";
  return blk("已过期", overdue) + blk("有日期", dated) + blk("无日期", none);
}

async function renderNotes(arg) {
  NS.tab = arg === "memos" ? "memos" : "todos";
  if (!S.todos) S.todos = await call("get_todos");
  if (!S.memos) S.memos = await call("get_memos");
  if (!Array.isArray(S.todos)) S.todos = [];
  if (!Array.isArray(S.memos)) S.memos = [];
  S.todos.forEach(normalizeTodo);
  $app.classList.toggle("wide", NS.tab === "todos");

  const openCount = S.todos.filter((t) => !t.done).length;
  const tabs = `<div class="tabs" role="tablist">
    <button role="tab" aria-selected="${NS.tab === "todos"}" class="${NS.tab === "todos" ? "is-on" : ""}" data-ntab="todos">待办<span class="n">${openCount}</span></button>
    <button role="tab" aria-selected="${NS.tab === "memos"}" class="${NS.tab === "memos" ? "is-on" : ""}" data-ntab="memos">备忘<span class="n">${S.memos.length}</span></button>
  </div>`;

  const saveTodos = async () => { await call("save_todos", { todos: S.todos }); renderNotes("todos"); };
  const saveMemos = async () => { await call("save_memos", { memos: S.memos }); renderNotes("memos"); };

  if (NS.tab === "todos") {
    const open = S.todos.filter((t) => !t.done);
    const done = S.todos.filter((t) => t.done);
    const cells = QUADS.map((q) => {
      const xs = open.filter((t) => quadOf(t) === q.id);
      return `<section class="todo-cell ${q.cls}" data-quad="${q.id}">
        <header class="todo-cell-h">
          <span class="todo-qbadge">${q.roman}</span>
          <div class="todo-cell-t"><b>${esc(q.name)}</b><span class="n">${xs.length}</span></div>
          <button type="button" class="mx-iconbtn" data-act="add-q" data-q="${q.id}" aria-label="加到${esc(q.name)}" title="加到此象限">+</button>
        </header>
        <div class="todo-cell-b">${todoQuadBody(xs)}</div>
      </section>`;
    }).join("");

    $app.innerHTML = header("待办", `<button class="mx-btn mx-btn--primary" id="add">加一条待办</button>`)
      + `<div class="toolbar">${tabs}</div>`
      + `<div class="reading todo-board-wrap" id="notes">
        <div class="todo-board" role="list">${cells}</div>
        ${done.length ? section("已完成", done.map(todoBoardRow).join(""), { count: done.length }) : ""}
      </div>`;
    document.getElementById("add").onclick = () => { NS.deleting = null; todoDialog(null, saveTodos, 2); };
    document.getElementById("notes").onclick = async (e) => {
      const addQ = e.target.closest('[data-act="add-q"]');
      if (addQ) { NS.deleting = null; return todoDialog(null, saveTodos, +addQ.dataset.q); }
      const b = e.target.closest("[data-act]"); if (!b) return;
      const box = b.closest("[data-id]"); if (!box) return;
      const id = box.dataset.id, act = b.dataset.act;
      if (act === "focus") return TimeSeenFocus.fromTodo(S.todos.find((x) => x.id === id));
      if (act === "edit") { NS.deleting = null; return todoDialog(S.todos.find((x) => x.id === id), saveTodos); }
      if (act === "delete") { NS.deleting = id; return renderNotes("todos"); }
      if (act === "keep") { NS.deleting = null; return renderNotes("todos"); }
      if (act === "remove") { S.todos = S.todos.filter((x) => x.id !== id); NS.deleting = null; return saveTodos(); }
      if (act === "toggle") {
        const x = S.todos.find((t) => t.id === id);
        x.done = !x.done; x.updated = new Date().toISOString();
        S.todos = [...S.todos.filter((t) => !t.done), ...S.todos.filter((t) => t.done)];
        return saveTodos();
      }
    };
  } else {
    const row = (m) => {
      const title = (m.title || "").trim() || ((m.body || "").trim().split("\n")[0] || "（空白备忘）").slice(0, 40);
      const preview = (m.title || "").trim() ? (m.body || "").trim() : (m.body || "").trim().split("\n").slice(1).join("\n").trim();
      return `<div class="memo" data-id="${m.id}">
        <div class="mx-row">
          <div class="mx-row-main"><div class="mx-row-name">${esc(title)}</div>${preview ? `<div class="memo-body">${esc(preview)}</div>` : ""}<div class="memo-meta">${esc(mdhm(m.updated || m.created) || "")}</div></div>
          <div class="acts"><button class="mx-btn mx-btn--text mx-btn--sm" data-act="edit">改</button><button class="mx-btn mx-btn--text mx-btn--sm" data-act="delete">删除</button></div>
        </div>
        ${NS.deleting === m.id ? `<div class="mx-confirm"><div class="mx-confirm-text"><b>删除这条备忘？</b><span>删了找不回来。</span></div><button class="mx-btn mx-btn--secondary" data-act="keep">取消</button><button class="mx-btn mx-btn--danger" data-act="remove">删除这条</button></div>` : ""}
      </div>`;
    };
    $app.innerHTML = header("备忘", `<button class="mx-btn mx-btn--primary" id="add">写一条备忘</button>`)
      + `<div class="toolbar">${tabs}</div>`
      + `<div class="reading" id="notes">
        ${S.memos.length ? S.memos.map(row).join("") : emptyInline("还没有备忘，随手记一点")}
      </div>`;
    document.getElementById("add").onclick = () => { NS.deleting = null; memoDialog(null, saveMemos); };
    document.getElementById("notes").onclick = async (e) => {
      const b = e.target.closest("[data-act]");
      const box = e.target.closest("[data-id]");
      if (b && box) {
        const id = box.dataset.id, act = b.dataset.act;
        if (act === "edit") { NS.deleting = null; return memoDialog(S.memos.find((x) => x.id === id), saveMemos); }
        if (act === "delete") { NS.deleting = id; return renderNotes("memos"); }
        if (act === "keep") { NS.deleting = null; return renderNotes("memos"); }
        if (act === "remove") { S.memos = S.memos.filter((x) => x.id !== id); NS.deleting = null; return saveMemos(); }
        return;
      }
      if (NS.deleting || !box || e.target.closest(".mx-confirm")) return;
      memoDialog(S.memos.find((x) => x.id === box.dataset.id), saveMemos);
    };
  }

  $app.querySelector(".toolbar").onclick = (e) => {
    const tab = e.target.closest("[data-ntab]"); if (!tab) return;
    NS.deleting = null;
    location.hash = tab.dataset.ntab === "memos" ? "#/todos/memos" : "#/todos";
  };
  const keepBtn = $app.querySelector('[data-act="keep"]');
  if (keepBtn) keepBtn.focus();
  $app.onkeydown = (e) => { if (e.key === "Escape" && NS.deleting) { NS.deleting = null; renderNotes(NS.tab); } };
}

// ---------- 规矩 ----------
const RS = { deleting: null };

/** 把一条规矩识别成能算的三类；识别不了返回 null（交给日总结对照）
 *  after：几点以后不用（电脑／手机／都不用）；limit：某设备每天不超过多久；app：某个 app 每天不超过多久 */
function parseRule(text) {
  const t = String(text).replace(/\s+/g, "");
  const dev = /电脑|mac/i.test(t) ? "computer" : /手机|iphone/i.test(t) ? "phone" : "any";
  let m = t.match(/(\d{1,2})(?:[:：点](\d{2})?)?(?:分)?(?:以后|之后|后)/);
  if (m && /不|别|停|关|禁/.test(t)) return { kind: "after", dev, h: +m[1] + (+m[1] < 12 && /晚上|夜里|夜间|下午|傍晚/.test(t) ? 12 : 0), m: +(m[2] || 0) };
  m = t.match(/(不超过|少于|最多|以内|不到|≤|<=?)(\d+(?:\.\d+)?)(小时|h|分钟|min|分)/i) || t.match(/(\d+(?:\.\d+)?)(小时|h|分钟|min|分)(以内|以下)/i);
  if (m) {
    const [num, unit] = /\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[3]];
    const minutes = +num * (/小时|h/i.test(unit) ? 60 : 1);
    const subject = t.split(/每天|一天|每日|不超过|少于|最多|不到/)[0].replace(/^(用|玩|刷|看)/, "");
    if (dev !== "any" && /^(用|玩|刷|看)?(电脑|手机|mac|iphone)?$/i.test(subject)) return { kind: "limit", dev, minutes };
    if (subject) return { kind: "app", app: subject.replace(/^(用|玩|刷|看)/, ""), minutes };
  }
  return null;
}

/** 用今天的实时数据对照一条规矩：{label: 对照什么, value: 今天多少, ok: 是否守住（null＝还没到点）} */
function checkRule(r, d) {
  if (!d) return null;
  const live = d.live || {}, ph = d.phone || {};
  const dayStart = toDate(d.date).getTime();
  const overlap = (a, b, from) => Math.max(0, Math.min(b, dayStart + 864e5) - Math.max(a, from)) / 1000;
  if (r.kind === "after") {
    const from = dayStart + (r.h * 60 + r.m) * 6e4;
    const when = `${pad2(r.h)}:${pad2(r.m)}`;
    const what = r.dev === "phone" ? "用手机" : r.dev === "computer" ? "用电脑" : "用电脑和手机";
    if (Date.now() < from) return { label: `还没到 ${when}`, value: "", ok: null };
    let sec = 0;
    if (r.dev !== "phone") for (const [a, b] of live.spans || []) sec += overlap(Date.parse(a), Date.parse(b), from);
    if (r.dev !== "computer") for (const x of ph.sessions || []) { const a = Date.parse(x.start), b = Date.parse(x.end); sec += b > a ? (overlap(a, b, from) / ((b - a) / 1000)) * x.sec : 0; }
    return { label: `${when} 以后${what}`, value: `${Math.round(sec / 60)} 分钟`, ok: sec < 60 };
  }
  if (r.kind === "limit") {
    const sec = r.dev === "phone" ? ph.total_sec || 0 : live.active_sec || 0;
    return { label: `今天${r.dev === "phone" ? "手机" : "电脑"}`, value: `${hh(sec)} / ${+(r.minutes / 60).toFixed(1)} 小时`, ok: sec <= r.minutes * 60 };
  }
  if (r.kind === "app") {
    const key = r.app.toLowerCase();
    const hit = (x) => (x.name || "").toLowerCase().includes(key) || (x.bundle_id || "").toLowerCase().includes(key);
    let sec = 0;
    for (const x of ph.sessions || []) for (const a of x.apps) if (hit(a)) sec += a.sec;
    for (const a of live.apps || []) if (hit(a)) sec += a.sec;
    return { label: `今天${r.app}（电脑和手机）`, value: `${Math.round(sec / 60)} / ${r.minutes} 分钟`, ok: sec <= r.minutes * 60 };
  }
  return null;
}

/** 加一条或改一条规矩（小弹层） */
function ruleDialog(r, save) {
  openDialog({
    title: r ? "改规矩" : "加一条规矩", ok: r ? "保存改动" : "加上这条",
    body: `<div class="mx-field"><label for="rule-text">规矩</label><textarea class="mx-input dlg-ta" id="rule-text" placeholder="用自己的话写，比如「21:00 以后不开电脑」">${esc(r ? r.text : "")}</textarea>
      <p class="note">「几点以后不用电脑／手机」「电脑／手机每天不超过几小时」「某个 app 每天不超过几分钟」会当场对照，别的写法交给日总结。⌘↩ 保存。</p></div>`,
    submit: async (el) => {
      const text = dlgVal(el, "rule-text");
      if (!text) throw "先写一条规矩。";
      if (r) S.rules.find((x) => x.id === r.id).text = text;
      else S.rules.unshift({ id: "r" + Date.now().toString(36), text, enabled: true });
      await save();
    },
  });
}

async function renderRules() {
  if (!S.rules) S.rules = await call("get_rules");
  const rules = S.rules;
  const [today, hist] = await Promise.all([call("get_day", { date: localDay() }).catch(() => null), call("rule_history", { days: 14 }).catch(() => null)]);
  const marksOf = Object.fromEntries(((hist && hist.rules) || []).filter((r) => r && r.id).map((r) => [r.id, r.marks || []]));
  const verdict = (r) => {
    if (r.enabled === false) return `<div class="verdict muted">暂不对照</div>`;
    const c = checkRule(parseRule(r.text) || {}, today);
    const marks = marksOf[r.id] || [];
    const todayMark = marks[marks.length - 1];
    const dots = marks.length ? `<div class="streak" title="最近 ${marks.length} 天">${marks.map((m) => `<i class="${esc(m)}"></i>`).join("")}</div>` : "";
    if (!c) return `<div class="verdict muted"><span>这条算不出来，交给日总结对照</span> <button type="button" class="mx-btn mx-btn--text mx-btn--sm" data-act="rewrite">改成能算的</button></div>`;
    const warn = todayMark === "warn" && c.ok;
    const cls = c.ok === null ? "muted" : warn ? "warn" : c.ok ? "ok" : "over";
    const tail = c.ok === null ? "" : warn ? " · 到八成，菜单栏会说一次" : c.ok ? " · 守住了" : " · 没守住";
    return `<div class="verdict ${cls}"><span>${esc(c.label)}</span>${c.value ? `<b>${esc(c.value)}</b>` : ""}${tail}</div>${dots}`;
  };
  const row = (r, i) => `<div class="rule${r.enabled === false ? " off" : ""}" data-id="${r.id}">
      <div class="mx-row"><span class="mx-row-mark mono">${i + 1}</span>
        <div class="mx-row-main"><div class="mx-row-name">${esc(r.text)}</div>${verdict(r)}</div>
        <div class="acts"><button class="mx-btn mx-btn--text mx-btn--sm" data-act="edit">改</button><button class="mx-btn mx-btn--text mx-btn--sm" data-act="delete">删除</button></div>
        <button class="mx-switch" role="switch" aria-checked="${r.enabled !== false}" aria-label="对照这条" title="${r.enabled !== false ? "日总结对照这条" : "暂不对照"}" data-act="toggle"></button>
      </div>
      ${RS.deleting === r.id ? `<div class="mx-confirm"><div class="mx-confirm-text"><b>删除这条规矩？</b><span>删了找不回来。</span></div><button class="mx-btn mx-btn--secondary" data-act="keep">取消</button><button class="mx-btn mx-btn--danger" data-act="remove">删除这条</button></div>` : ""}
    </div>`;
  $app.innerHTML = header("规矩", `<button class="mx-btn mx-btn--primary" id="add">加一条规矩</button>`)
    + `<div class="reading" id="rules">
      ${rules.length ? `<p class="legend-dots"><i></i>守住 <i class="miss"></i>没守住 <i class="warn"></i>到八成 <i class="open"></i>还没到点</p>` : ""}
      ${rules.length ? rules.map(row).join("") : emptyInline("用自己的话写一条规矩，比如「21:00 以后不开电脑」")}
    </div>`;
  const save = async () => { await call("save_rules", { rules: S.rules }); renderRules(); };
  document.getElementById("add").onclick = () => { RS.deleting = null; ruleDialog(null, save); };
  const keepBtn = $app.querySelector('[data-act="keep"]');
  if (keepBtn) keepBtn.focus();
  document.getElementById("rules").onclick = async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const box = b.closest("[data-id]"), id = box.dataset.id, act = b.dataset.act;
    if (act === "edit" || act === "rewrite") { RS.deleting = null; return ruleDialog(S.rules.find((r) => r.id === id), save); }
    if (act === "delete") { RS.deleting = id; return renderRules(); }
    if (act === "keep") { RS.deleting = null; return renderRules(); }
    if (act === "remove") { S.rules = S.rules.filter((r) => r.id !== id); RS.deleting = null; return save(); }
    if (act === "toggle") { const r = S.rules.find((x) => x.id === id); r.enabled = r.enabled === false; return save(); }
  };
  $app.onkeydown = (e) => { if (e.key === "Escape" && RS.deleting) { RS.deleting = null; renderRules(); } };
}

// ---------- 设备：绑定的电脑和手机，各自的记录状态 ----------

const DS = { devs: null, names: {} };
const DEV_ICON = {
  mac: '<svg class="mx-ico lu" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  win: '<svg class="mx-ico lu" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  iphone: '<svg class="mx-ico lu" viewBox="0 0 24 24"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>',
  watch: '<svg class="mx-ico lu" viewBox="0 0 24 24"><rect width="12" height="12" x="6" y="6" rx="3"/><path d="M9 6l.6-3.5h4.8L15 6M9 18l.6 3.5h4.8L15 18"/></svg>',
};
const bytesText = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");
const numText = (n) => Number(n || 0).toLocaleString("en-US");

/** 设备页：照墨线的列表页和设置页——「设备」一组（一台一行，点进去是设备详情页）、「同步」一组（设置行）。
 *  本机缺权限时顶上一条提示 */
async function renderDevices() {
  const [devs, st] = await Promise.all([call("list_devices").catch(() => []), call("get_status")]);
  S.status = st; renderSide();
  // 设备显示名保存在本机
  DS.names = Object.fromEntries(devs.filter((d) => d.custom).map((d) => [d.id, d.name]));
  DS.devs = devs;
  const perm = st.permissions || {};
  const me = devs.find((d) => d.this);
  const missing = [["accessibility", "辅助功能"], ["input_monitoring", "输入监控"], ["full_disk_access", "完全磁盘访问"]].filter(([k]) => perm[k] === false).map(([, n]) => n);
  const notice = me && missing.length ? `<div class="mx-notice"><span>这台电脑缺${missing.join("、")}权限，记不全。</span><a class="mx-btn mx-btn--secondary mx-btn--sm" href="#/devices/${encodeURIComponent(me.id)}">去处理</a></div>` : "";
  const adding = `<div class="add-dev">
      <div class="add-opt">${DEV_ICON.iphone}<div><b>iPhone</b><span>不用装 app。iPhone 上打开 设置 → 屏幕使用时间 →「跨设备共享」，用同一个 Apple 账号，这台 Mac 就能读到。</span></div></div>
    </div>`;
  const rows = devs.map((d) => `<a class="mx-row" href="#/devices/${encodeURIComponent(d.id)}"><span class="mx-row-mark">${DEV_ICON[d.kind] || DEV_ICON.mac}</span>
      <span class="mx-row-main"><div class="mx-row-name">${esc(d.name)}${d.this ? `<span class="mx-tag">本机</span>` : ""}</div><div class="mx-row-desc">${devStatus(d, st)}</div></span>
      <span class="mx-row-side">${ICON.chevR}</span></a>`).join("");
  $app.innerHTML = header("设备", `<button class="mx-btn mx-btn--primary" id="add-dev">添加设备</button>`)
    + `<div class="reading">${notice}${section("设备", rows ? `<div class="mx-list">${rows}</div>` : emptyInline("还没有设备"))}</div>`;
  document.getElementById("add-dev").onclick = () => openDialog({ title: "添加设备", body: adding, cancel: "关闭" });
}

/** 设备一行下面那句状态 */
function devStatus(d, st) {
  const perm = (st && st.permissions) || {};
  if (d.this) {
    const missing = !perm.accessibility || !perm.input_monitoring;
    const [cls, text] = st.paused ? ["", st.paused_until ? `已暂停，${hm(st.paused_until)} 自动继续` : "已暂停"] : missing ? ["warn", "缺权限"] : st.capturing ? ["ok", "记录中"] : ["", "没在记录"];
    return `<span class="dot ${cls}"></span>${text} · 今天已记 ${numText(st.events_today)} 条`;
  }
  const m = String((st && st.phone_sync) || "").match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  if (d.kind === "iphone") {
    // 超过一天没有新数据：变提醒样式
    const at = m ? m[0] : d.last, stale = !at || Date.now() - Date.parse(at) > 86400e3;
    return `<span class="dot ${stale ? "warn" : "ok"}"></span>同步至 ${ymdhm(at) || "—"} · ${howto("screentime", "怎么设置")}`;
  }
  return `最近一条 ${ymdhm(d.last)}`;
}

/** 每种设备记什么：一行一项 */
const DEV_RECORDS = {
  mac: ["切换 app 和窗口", "键盘输入和发送（密码框打码）", "点击和滚动", "界面上的文字", "在不在电脑前、锁屏、睡眠", "10 分钟摘要"],
  win: ["切换程序和窗口", "键盘输入和发送（密码框打码）", "点击和滚动", "界面上的文字", "在不在电脑前、锁屏、睡眠", "10 分钟摘要"],
  iphone: ["每个 app 在前台的时长", "停留点：到了哪、待了多久"],
  watch: ["录音转成的文字，分出说话人", "录音时记下的停留点"],
};

/** 设备详情页：DetailHeader（返回、名字、状态、操作菜单）＋ 下划线页签 概况／事件 */
const DEV = { id: null, tab: "overview", events: [], more: false, type: "all", live: true, open: new Set(), timer: null, err: null };
async function renderDevice(id, tab) {
  if (DEV.id !== id) { DEV.events = []; DEV.more = false; DEV.type = "all"; DEV.open = new Set(); DEV.err = null; }
  DEV.id = id; DEV.tab = tab === "events" ? "events" : "overview";
  const [devs, st] = await Promise.all([DS.devs ? Promise.resolve(DS.devs) : call("list_devices").catch(() => []), call("get_status")]);
  S.status = st; renderSide();
  const d = devs.find((x) => x.id === id);
  if (!d) { location.hash = "#/devices"; return; }
  const base = `#/devices/${encodeURIComponent(id)}`;
  const head = `<div class="dev-detail"><a class="mx-back" href="#/devices">${ICON.chevL}设备</a>
    <div class="mx-detail"><span class="mx-detail-mark">${DEV_ICON[d.kind] || DEV_ICON.mac}</span><div class="mx-detail-main"><h1>${esc(d.name)}</h1><p>${devStatus(d, st)}${d.this ? " · 本机" : ""}</p></div>
      <div class="pick"><button class="mx-btn mx-btn--secondary" id="dev-ops" aria-haspopup="menu" aria-expanded="false">操作${ICON.chevD}</button>
        <div class="mx-menu" role="menu" hidden><button role="menuitem" id="dev-rename">重命名</button></div></div></div>
    <nav class="mx-utabs"><a href="${base}" class="${DEV.tab === "overview" ? "is-on" : ""}">概况</a><a href="${base}/events" class="${DEV.tab === "events" ? "is-on" : ""}">事件</a></nav></div>`;
  $app.innerHTML = `<div class="reading">${head}<div id="dev-body">${DEV.tab === "events" ? evShell(d) : devOverview(d, st)}</div></div>`;
  bindPick(document.getElementById("dev-ops"));
  document.getElementById("dev-rename").onclick = () => renameDialog(d, () => { DS.devs = null; renderDevice(id, DEV.tab); });
  $app.querySelectorAll("[data-perm]").forEach((b) => (b.onclick = () => call("open_permission", { kind: b.dataset.perm })));
  if (DEV.tab === "events") { DEV.drawn = false; bindEvents(d); await loadEvents(d, false); startEventsTimer(d); } else stopEventsTimer();
}

function devOverview(d, st) {
  const perm = st.permissions || {};
  const permLabel = (kind) => perm[kind] ? "已授权" : (perm[`${kind}_label`] || "未授权");
  const permDesc = (kind, desc) => (!perm[kind] && perm[`${kind}_label`]) ? "系统里还开着，但当前签名未生效，请关掉再打开" : desc;
  const permRow = (kind, name, desc) => `<div class="mx-setting"><div class="mx-setting-main"><div class="mx-setting-name">${name}</div><div class="mx-setting-desc">${permDesc(kind, desc)}</div></div>
    <span class="mx-status mx-status--${perm[kind] ? "ok" : "warn"}">${permLabel(kind)}</span>${perm[kind] ? "" : `<button class="mx-btn mx-btn--secondary mx-btn--sm" data-perm="${kind}">去授权</button>`}</div>`;
  const stats = `<div class="mx-stats dev-stats">
      <div class="mx-stat"><div class="mx-stat-label">记录从</div><div class="mx-stat-value mx-num">${esc(mdhm(d.first) || "—")}</div></div>
      <div class="mx-stat"><div class="mx-stat-label">最近一条</div><div class="mx-stat-value mx-num">${esc(ymdhm(d.last) || "—")}</div></div>
      <div class="mx-stat"><div class="mx-stat-label">共</div><div class="mx-stat-value mx-num">${numText(d.events)}<small>条</small></div></div>
      <div class="mx-stat"><div class="mx-stat-label">占用</div><div class="mx-stat-value mx-num">${bytesText(d.bytes).replace(/ (\S+)$/, "<small>$1</small>")}</div></div></div>`;
  const kind = d.kind === "win" ? "win" : d.kind;
  const recs = DEV_RECORDS[kind] || DEV_RECORDS.mac;
  const what = section("记什么", `<ul class="dev-recs">${recs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`, { aside: `<a href="#/devices/${encodeURIComponent(d.id)}/events">看最近的事件</a>` });
  const perms = d.this && !IS_WIN ? section("权限", `<div class="rows">${permRow("accessibility", "辅助功能", "读取窗口标题和屏幕上的文字")}${permRow("input_monitoring", "输入监控", "判断你在打字还是程序在操作")}${permRow("full_disk_access", "完全磁盘访问", `读取 iPhone 的屏幕使用时间 · ${howto("screentime", "怎么设置")}`)}</div>`) : "";
  return stats + what + perms + `<p class="note dev-id">设备编号 <span class="mono">${esc(d.id)}</span></p>`;
}

// ---------- 设备详情 · 事件：最近的原始事件，新的在上；页面开着时每 3 秒刷新 ----------

/** 筛选：显示名 → 事件种类（以「.」结尾按前缀）；每种设备只列它会有的 */
const EV_TYPES = {
  all: ["全部", null],
  input: ["打字和发送", ["keyboard."]],
  mouse: ["点击和滚动", ["mouse."]],
  switch: ["切换", ["app.activated", "window.changed", "app.focus"]],
  ui: ["界面文字", ["ui.text"]],
  presence: ["在不在", ["presence", "heartbeat", "screen.", "system."]],
  speech: ["对话", ["speech."]],
  place: ["位置", ["place.visit"]],
  bg: ["后台", ["summary.run", "phone.sync", "app.launch", "app.quit", "permission.", "tap.started"]],
};
const EV_KINDS = { mac: ["all", "input", "mouse", "switch", "ui", "presence", "bg"], win: ["all", "input", "mouse", "switch", "ui", "presence", "bg"], iphone: ["all", "switch", "place"], watch: ["all", "speech", "place"] };

/** 一条事件的种类标签 */
function evTag(t) {
  const m = { "keyboard.text_input": "打字", "keyboard.submit": "发送", "keyboard.return": "回车", "keyboard.shortcut": "快捷键", "mouse.click": "点击", "mouse.scroll": "滚动",
    "app.activated": "切换", "window.changed": "窗口", "app.focus": "前台", "ui.text": "界面文字", heartbeat: "心跳", presence: "在不在", "speech.utterance": "说话", "speech.segment": "录音",
    "place.visit": "停留", "summary.run": "摘要", "phone.sync": "读 iPhone", "app.launch": "启动", "app.quit": "退出" };
  return m[t] || (/^(screen|system)\./.test(t) ? "屏幕" : /^permission\./.test(t) ? "权限" : t);
}

/** 打的字：去掉方向键、退格这些控制字符，回车写成 ⏎ */
const typedText = (s) => String(s || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\n/g, " ⏎ ").trim();
/** 这次打字敲了几下键（人敲的＋代理敲的） */
const keyCount = (e) => Object.values(e.keys || {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
const clip = (s, n = 80) => (s.length > n ? s.slice(0, n) + "…" : s);
const durText = (sec) => (sec < 60 ? `${Math.round(sec)} 秒` : sec < 3600 ? `${Math.round(sec / 60)} 分钟` : `${hh(sec)} 小时`);

/** 一条事件的一句人话（打的字、界面文字原样写出来：只在本机显示） */
function evText(e) {
  const app = e.app_name || "";
  const at = app ? `在 ${app} ` : "";
  const el = e.element || {};
  const who = e.actor && e.actor.kind === "agent" ? `代理（${e.actor.source_proc || "别的程序"}）` : e.actor_kind === "agent" ? "代理" : "";
  const elName = el.title || el.description || ({ AXButton: "按钮", AXTextField: "输入框", AXTextArea: "输入框", AXLink: "链接", AXMenuItem: "菜单项", AXCheckBox: "勾选框", AXTab: "页签", AXImage: "图片", AXStaticText: "文字" }[el.role] || "");
  switch (e.event_type) {
    case "keyboard.text_input": { const t = typedText(e.text || e.typed), n = keyCount(e); return t ? `${who}${at}打了「${clip(t)}」` : `${who}${at}敲了${n ? ` ${n} 下` : ""}键盘（没读到打的内容）`; }
    case "keyboard.submit": { const t = typedText(e.text), n = keyCount(e); return `${who}${at}发出${t ? `「${clip(t)}」` : ""}${n ? `（敲了 ${n} 下）` : ""}`; }
    case "keyboard.return": return `${who}${at}按了回车`;
    case "keyboard.shortcut": return `${who}${at}按了 ${e.keys || ""}`;
    case "mouse.click": return `${who}${at}点了${elName ? `「${clip(elName, 40)}」` : "一下"}${e.button === "right" ? "（右键）" : ""}`;
    case "mouse.scroll": return `${who}${at}滚了 ${e.ticks || 1} 格`;
    case "app.activated": return `切到 ${app}${e.window_title ? ` · ${clip(e.window_title, 50)}` : ""}`;
    case "window.changed": return `${app} 换了窗口${e.window_title ? `：${clip(e.window_title, 50)}` : ""}`;
    case "ui.text": return `读到 ${app} 的界面文字 ${e.lines || 0} 行${e.has_secure_field ? "（有密码框，已打码）" : ""}`;
    case "heartbeat": return e.state === "idle" ? `没在操作，空闲 ${durText(e.idle_seconds || 0)}` : `在用 ${app}`;
    case "presence": return e.state === "active" ? "回到电脑前" : `离开电脑（空闲 ${durText(e.idle_seconds || 0)}）`;
    case "screen.sleep": return "屏幕关了";
    case "screen.wake": return "屏幕亮了";
    case "screen.locked": return "锁屏";
    case "screen.unlocked": return "解锁";
    case "system.sleep": return "电脑睡眠";
    case "system.wake": return "电脑唤醒";
    case "app.focus": { const n = (ICONS[1][e.bundle_id] || {}).name || String(e.bundle_id || "").split(".").pop(); return `${e.state === "start" ? "打开" : "离开"} ${n}`; }
    case "speech.utterance": return `${e.speaker || "未辨"}：${clip(String(e.text || ""), 120)}`;
    case "speech.segment": return `录了一段 ${durText(e.audio_sec || 0)}，有人说话 ${durText(e.speech_sec || 0)}${e.battery != null ? `，电量 ${Math.round(e.battery * 100)}%` : ""}`;
    case "place.visit": return `${e.depart ? "离开" : "到了"} ${e.label || e.name || "没有地名的地方"}`;
    case "summary.run": return `写了 ${e.written || 0} 段摘要（${e.seconds || 0} 秒）`;
    case "phone.sync": return `从 iCloud 读到 iPhone 新记录 ${numText(e.added)} 条`;
    case "app.launch": return `TimeSeen ${e.version || ""} 启动${e.shadow ? "（测试版）" : ""}`;
    case "app.quit": return "TimeSeen 退出";
    case "tap.started": return "开始监听键盘和鼠标";
    case "permission.requested": return `申请${{ accessibility: "辅助功能", input_monitoring: "输入监控", full_disk_access: "完全磁盘访问" }[e.service] || e.service || ""}权限`;
    case "permission.changed": return "权限变了";
    default: return e.event_type || "（没有种类）";
  }
}

const hms = (iso) => { const t = new Date(iso); return `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`; };
/** 一条事件的键：时刻＋种类＋第几条（同一秒可能有好几条） */
const evKey = (e, i) => `${e.timestamp}|${e.event_type}|${i}`;

function evShell(d) {
  const kinds = EV_KINDS[d.kind] || EV_KINDS.mac;
  if (!kinds.includes(DEV.type)) DEV.type = "all";
  return `<div class="toolbar ev-bar"><div class="toolbar-left"><div class="pick"><button class="mx-btn mx-btn--secondary" id="ev-type" aria-haspopup="menu" aria-expanded="false">${EV_TYPES[DEV.type][0]}${ICON.chevD}</button>
      <div class="mx-menu" role="menu" hidden>${kinds.map((k) => `<button role="menuitemradio" aria-checked="${k === DEV.type}" data-ev-type="${k}">${EV_TYPES[k][0]}${k === DEV.type ? `<span class="mx-check">${ICON.check}</span>` : ""}</button>`).join("")}</div></div></div>
    <div class="toolbar-right"><span class="mx-status ${DEV.live ? "mx-status--ok" : ""}" id="ev-live-state">${DEV.live ? "实时 · 每 3 秒刷新" : "已暂停刷新"}</span><button class="mx-btn mx-btn--text mx-btn--sm" id="ev-live">${DEV.live ? "暂停" : "继续"}</button></div></div>
    <div id="ev-list"><p class="note">读取中…</p></div>
    <p class="note">打的字和界面文字只在这台电脑上显示，不进网站；密码框在记录时就打了码。</p>`;
}

function bindEvents(d) {
  bindPick(document.getElementById("ev-type"));
  $app.querySelectorAll("[data-ev-type]").forEach((b) => (b.onclick = () => { DEV.type = b.dataset.evType; DEV.events = []; DEV.open = new Set(); renderDevice(d.id, "events"); }));
  document.getElementById("ev-live").onclick = () => { DEV.live = !DEV.live; renderDevice(d.id, "events"); };
}

/** 读事件：older＝接着往前读一页；不然读最新一页，和已经读到的更早的那些接上 */
async function loadEvents(d, older) {
  const types = EV_TYPES[DEV.type][1];
  const before = older && DEV.events.length ? DEV.events[DEV.events.length - 1].timestamp : null;
  let r;
  try { r = await call("recent_events", { device: d.id, before, limit: 200, types }); DEV.err = null; }
  catch (x) { DEV.err = String(x && x.message ? x.message : x); return drawEvents(d); }
  if (older) { DEV.events = DEV.events.concat(r.events); DEV.more = r.more; }
  else {
    const oldest = r.events.length ? r.events[r.events.length - 1].timestamp : null;
    const keep = oldest ? DEV.events.filter((e) => e.timestamp < oldest) : [];
    const same = DEV.events.length && r.events.length && DEV.events[0].timestamp === r.events[0].timestamp && DEV.events.length >= r.events.length;
    if (same && DEV.drawn) return;
    DEV.events = r.events.concat(keep);
    if (!keep.length) DEV.more = r.more;
  }
  drawEvents(d);
}

function drawEvents(d) {
  const box = document.getElementById("ev-list"); if (!box) return;
  DEV.drawn = true;
  if (DEV.err) { box.innerHTML = `<p class="mx-error">读不到事件：${esc(DEV.err)}</p>`; return; }
  if (!DEV.events.length) { box.innerHTML = emptyInline("最近 8 小时没有这类事件"); return; }
  const phone = d.kind === "iphone";
  box.innerHTML = `<div class="ev-list">${DEV.events.map((e, i) => {
    const k = evKey(e, i), app = e.bundle_id && (e.app_name || phone) ? `<span class="ico" data-b="${esc(e.bundle_id)}" data-p="${phone ? 1 : 0}" title="${esc(e.app_name || e.bundle_id)}">${esc(((e.app_name || e.bundle_id.split(".").pop())[0] || "?").toUpperCase())}</span>` : `<span class="ico ico-none"></span>`;
    const raw = JSON.stringify(e, null, 2);
    const extra = e.event_type === "ui.text" && e.text ? `<pre class="ev-text">${esc(clip(String(e.text), 2000))}</pre>` : "";
    return `<details class="ev-row" data-k="${esc(k)}"${DEV.open.has(k) ? " open" : ""}><summary><span class="t mono">${hms(e.timestamp)}</span><span class="mx-tag">${esc(evTag(e.event_type))}</span>${app}<span class="ev-say">${esc(evText(e))}</span></summary>
      <div class="ev-more">${extra}<pre class="ev-raw mono">${esc(raw)}</pre></div></details>`;
  }).join("")}</div>${DEV.more ? `<div class="btns ev-older"><button class="mx-btn mx-btn--secondary mx-btn--sm" id="ev-older">加载更早</button></div>` : ""}`;
  box.querySelectorAll(".ev-row").forEach((x) => x.addEventListener("toggle", () => { x.open ? DEV.open.add(x.dataset.k) : DEV.open.delete(x.dataset.k); }));
  const older = document.getElementById("ev-older"); if (older) older.onclick = () => loadEvents(d, true);
  loadIcons().then(() => { if (phone) box.querySelectorAll(".ev-row").forEach((x, i) => { const e = DEV.events[i]; if (e && e.event_type === "app.focus") x.querySelector(".ev-say").textContent = evText(e); }); });
}

function startEventsTimer(d) {
  stopEventsTimer();
  if (!DEV.live) return;
  DEV.timer = setInterval(() => {
    if (S.page !== "devices" || DEV.id !== d.id || DEV.tab !== "events" || !document.getElementById("ev-list")) return stopEventsTimer();
    loadEvents(d, false);
  }, 3000);
}
function stopEventsTimer() { if (DEV.timer) { clearInterval(DEV.timer); DEV.timer = null; } }

/** 下拉菜单（.pick 里的按钮＋.mx-menu）：点按钮开关，点外面或 Esc 关（见文末） */
function bindPick(btn) {
  if (!btn) return;
  const menu = btn.parentElement.querySelector(".mx-menu");
  btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); };
}

/** 给设备改名（小弹层）。改的名字会同步到别的设备，时间线上的标签也用它；清空＝改回默认名 */
function renameDialog(d, done) {
  if (!d) return;
  openDialog({
    title: "重命名设备", ok: "保存",
    body: dlgField("dev-name", "名称", { value: d.custom ? d.name : "", ph: d.default_name, help: "清空就改回默认名字" }),
    onOpen: (el) => { el.querySelector("#dev-name").maxLength = 40; },
    submit: async (el) => { await call("rename_device", { id: d.id, name: dlgVal(el, "dev-name") }); DS.devs = null; done ? done() : renderDevices(); },
  });
}

// ---------- 设置 ----------

const THEMES = [["", "跟随系统"], ["light", "浅色"], ["dark", "深色"]];
const SETTING_KEYS = ["gateway", "model_segment", "repo_path", "blocklist"];
const same = (a, b) => JSON.stringify(SETTING_KEYS.map((k) => a[k])) === JSON.stringify(SETTING_KEYS.map((k) => b[k]));
/** Windows 版：没有钥匙串和系统授权（密钥存数据目录，采集不用授权） */
const IS_WIN = /Windows/.test(navigator.userAgent);
const KEY_SOURCE = { keychain: "已存（钥匙串）", file: "已存（数据目录）", env: "在用环境变量里的" };
const KEY_STORE = IS_WIN ? "数据目录" : "钥匙串";
const DELETES = [["15", "最近 15 分钟"], ["60", "最近 1 小时"], ["today", "今天全部"]];
const SS = { deleting: null, deleted: null, advanced: false };
/** 项目列表（设置页进来时取一次，改过后重取） */
const PJ = { err: null, list: null };

function profileRow() {
  const pf = S.profile || { name: "我" };
  return `<div class="mx-setting"><div class="profile"><span class="avatar big">${avatarHtml(pf)}</span><div><div class="mx-setting-name">${esc(pf.name)}</div><div class="mx-setting-desc">${pf.email ? esc(pf.email) : "显示在左下角"}</div></div></div>
      <button class="mx-btn mx-btn--secondary mx-btn--sm" id="pf-edit">编辑</button></div>`;
}

/** 选的图片居中裁成方的、缩到 128 像素，转成 JPEG data URL */
function shrinkImage(file) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement("canvas");
      c.width = c.height = 128;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      ok(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => fail("读不了这张图片");
    img.src = URL.createObjectURL(file);
  });
}

/** 编辑头像和名称（小弹层）。avatar：undefined＝没动，null＝改用名字首字 */
function profileDialog() {
  const pf = S.profile || { name: "我" };
  let avatar;
  openDialog({
    title: "编辑个人资料", ok: "保存",
    body: `<div class="profile"><span class="avatar big" id="pf-av">${avatarHtml(pf)}</span>
        <div class="btns sync-btns"><button class="mx-btn mx-btn--secondary mx-btn--sm" id="pf-pick">换头像</button><button class="mx-btn mx-btn--text mx-btn--sm" id="pf-clear">用名字首字</button><input type="file" id="pf-file" accept="image/*" hidden></div></div>
      ${dlgField("pf-name", "名称", { value: pf.name || "", help: "" })}`,
    onOpen: (el, d) => {
      const av = el.querySelector("#pf-av"), file = el.querySelector("#pf-file"), name = el.querySelector("#pf-name");
      name.maxLength = 40;
      const show = () => (av.innerHTML = avatarHtml({ name: name.value.trim() || pf.name, avatar: avatar === undefined ? pf.avatar : avatar }));
      name.oninput = show;
      el.querySelector("#pf-pick").onclick = () => file.click();
      el.querySelector("#pf-clear").onclick = () => { avatar = null; show(); };
      file.onchange = async () => { if (!file.files[0]) return; try { avatar = await shrinkImage(file.files[0]); d.setErr(null); show(); } catch (x) { d.setErr(String(x)); } };
    },
    submit: async (el) => {
      const name = dlgVal(el, "pf-name");
      if (!name) throw "名称不能空。";
      await call("save_profile", { name, avatar: avatar === undefined ? pf.avatar || null : avatar });
      S.profile = await call("get_profile"); renderSide(); renderSettings();
    },
  });
}

function bindProfile() {
  const b = document.getElementById("pf-edit");
  if (b) b.onclick = profileDialog;
}

const DOMAINS = ["工作", "成长", "生活", "健康", "关系", "休闲"];

function projectsSection() {
  const list = PJ.list || [];
  if (!list.length) return "";
  const dur = (sec) => (sec < 3600 ? Math.round(sec / 60) + " 分钟" : hh(sec) + " 小时");
  const byDom = DOMAINS.map((d) => [d, list.filter((p) => p.domain === d)]).filter(([, xs]) => xs.length);
  const rows = byDom.map(([d, xs]) => `<div class="pj-group">${d}</div>` + xs.map((p) => `<div class="pj-row" data-p="${esc(p.name)}">
      <div class="pj-main"><div class="mx-setting-name">${esc(p.name)}</div><div class="mx-setting-desc">累计 ${dur(p.sec)}${p.aliases.length ? ` · 也叫 ${esc(p.aliases.join("、"))}` : ""}</div></div>
      <button class="mx-btn mx-btn--text mx-btn--sm" data-pj-edit>编辑</button></div>`).join("")).join("");
  return section("项目", `<p class="note">项目由摘要自动判断，你改过的不会被覆盖</p><div class="pj">${rows}</div>${PJ.err ? `<div class="mx-field-error">${esc(PJ.err)}</div>` : ""}`);
}

/** 编辑一个项目（小弹层）：改领域，或者合并到另一个项目 */
function projectDialog(p) {
  const others = (PJ.list || []).filter((q) => q.name !== p.name);
  const why = "同一件事的两个叫法，合并成一个";
  let domain = p.domain, into = "";
  openDialog({
    title: `编辑「${p.name}」`, ok: "保存",
    body: `<div class="mx-field" id="pj-dom-f"><label>领域</label><div class="mx-seg" role="tablist" id="pj-dom">${DOMAINS.map((x) => `<button role="tab" aria-selected="${x === domain}" class="${x === domain ? "is-on" : ""}" data-v="${x}">${x}</button>`).join("")}</div></div>
      ${others.length ? `<div class="mx-field"><label>合并到</label><div class="pick-list" role="listbox" id="pj-into"><button role="option" aria-selected="true" data-v=""><span>不合并</span>${ICON.check}</button>${others.map((q) => `<button role="option" aria-selected="false" data-v="${esc(q.name)}"><span>${esc(q.name)}</span><span class="mx-menu-val">${esc(q.domain)}</span>${ICON.check}</button>`).join("")}</div>
        <p class="note" id="pj-why">${why}</p></div>` : ""}`,
    onOpen: (el, d) => {
      el.querySelector("#pj-dom").onclick = (e) => {
        const b = e.target.closest("[data-v]"); if (!b) return;
        domain = b.dataset.v;
        el.querySelectorAll("#pj-dom button").forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-selected", x === b); });
      };
      const lst = el.querySelector("#pj-into"); if (!lst) return;
      lst.onclick = (e) => {
        const b = e.target.closest("[data-v]"); if (!b) return;
        into = b.dataset.v;
        lst.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", x === b));
        el.querySelector("#pj-why").textContent = into ? `记成「${p.name}」的时间都算到「${into}」` : why;
        el.querySelector("#pj-dom-f").hidden = !!into;
        d.setOk(into ? `合并到「${into}」` : "保存");
      };
    },
    submit: async () => {
      if (into) await call("merge_project", { from: p.name, into });
      else if (domain !== p.domain) await call("set_project_domain", { project: p.name, domain });
      else return;
      PJ.err = null; PJ.list = await call("list_projects"); renderSettings();
    },
  });
}

function bindProjects() {
  $app.querySelectorAll("[data-pj-edit]").forEach((b) => (b.onclick = () => projectDialog(PJ.list.find((p) => p.name === b.closest("[data-p]").dataset.p))));
}

/** 到明早 8 点还有几分钟 */
function minutesToMorning() {
  const now = new Date(), t = new Date(now);
  t.setHours(8, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return Math.ceil((t - now) / 60000);
}

// ---------- 设置：地图（高德 Key、常去的地方） ----------

const PL = { labels: [] };
const PL_TYPES = [["home", "家"], ["work", "工作"], ["other", "其他"]];
const PL_ICON = { home: "家", work: "工作" };

/** 改了常去的地方以后：在哪一页就重画哪一页 */
const afterPlaces = () => (S.page === "settings" ? renderSettings() : renderToday());

/** 改常去的地方里的一项：名字、地址、种类、范围；名字清空＝删掉 */
async function labelDialog(i) {
  PL.labels = await call("list_place_labels").catch(() => PL.labels);
  const l = PL.labels[i]; if (!l) return;
  let kind = l.type || "other", r = Math.round(l.r || 150);
  const seg = (id, items, cur) => `<div class="mx-seg" role="tablist" id="${id}">${items.map(([k, t]) => `<button role="tab" aria-selected="${String(k) === String(cur)}" class="${String(k) === String(cur) ? "is-on" : ""}" data-v="${k}">${t}</button>`).join("")}</div>`;
  openDialog({
    title: `改「${l.label}」`, ok: "保存",
    body: dlgField("pl-n", "名字", { value: l.label, help: "清空就删掉这个地方。" })
      + dlgField("pl-a", "地址", { value: l.address || "", ph: "比如 某某小区 3 幢" })
      + `<div class="mx-field"><label>种类</label>${seg("pl-k", PL_TYPES, kind)}</div>`
      + `<div class="mx-field"><label>范围</label>${seg("pl-r", [[100, "100 米"], [150, "150 米"], [250, "250 米"], [400, "400 米"]], r)}<p class="note">离得近的两个地方，范围别重叠</p></div>`,
    onOpen: (el) => {
      const bindSeg = (id, set) => { el.querySelector("#" + id).onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; set(b.dataset.v); el.querySelectorAll(`#${id} button`).forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-selected", x === b); }); }; };
      bindSeg("pl-k", (v) => (kind = v)); bindSeg("pl-r", (v) => (r = +v));
    },
    submit: async (el) => { await call("edit_place_label", { index: i, label: dlgVal(el, "pl-n"), kind, r, address: dlgVal(el, "pl-a") || null }); afterPlaces(); },
  });
}

/** 添加一个常去的地方：搜高德（以第一个常去的地方为中心，按距离），挑一个就加上，名字先用店名，之后可以改 */
function addPlaceDialog() {
  openDialog({title:"添加本地地点",ok:"保存",body:dlgField("place-label","名称",{ph:"例如：家"})+dlgField("place-lat","纬度",{mono:true})+dlgField("place-lon","经度",{mono:true}),submit:async el=>{const label=dlgVal(el,"place-label"),lat=Number(dlgVal(el,"place-lat")),lon=Number(dlgVal(el,"place-lon"));if(!label||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw "请填写名称和有效经纬度。";await call("set_place_label",{lat,lon,label,kind:"other"});afterPlaces();}});
}

/** 设置页：通用｜记录｜连接｜数据｜项目。改了就存，不再有「保存设置」；要填几项的（地址、模型、密钥）开小弹层 */
const SET_TABS = [["general", "通用"], ["record", "记录"], ["connect", "连接"], ["data", "数据"], ["projects", "项目"]];
try { SS.tab = localStorage.getItem("settings-tab") || "general"; } catch (e) { SS.tab = "general"; }
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u || ""; } };
const setRow = (name, desc, right) => `<div class="mx-setting"><div class="mx-setting-main"><div class="mx-setting-name">${name}</div>${desc ? `<div class="mx-setting-desc">${desc}</div>` : ""}</div>${right}</div>`;
const smallBtn = (id, text, attrs = "") => `<button class="mx-btn mx-btn--secondary mx-btn--sm" id="${id}" ${attrs}>${text}</button>`;
const pill = (ok, text) => `<span class="mx-status mx-status--${ok ? "ok" : "warn"}">${text}</span>`;
/** 只改几个键：save_settings 只写传进去的键 */
async function saveSome(part) {
  await call("save_settings", { settings: part });
  S.settings = await call("get_settings"); S.draft = JSON.parse(JSON.stringify(S.settings));
}
const isUrl = (v) => /^https?:\/\/\S+$/.test(v);
const KEEP = "已存，留空不改";

async function renderSettings() {
  if (!S.settings) { S.settings = await call("get_settings"); S.draft = JSON.parse(JSON.stringify(S.settings)); }
  // 手机版不采集：没有「记录」页（暂停、不记录的 app、删最近记录都是电脑上的事）
  const tabsHere = S.status && S.status.mobile ? SET_TABS.filter(([k]) => k !== "record") : SET_TABS;
  const tab = tabsHere.some(([k]) => k === SS.tab) ? SS.tab : "general";
  if (tab === "projects") PJ.list = PJ.list || await call("list_projects").catch(() => []);
  S.profile = await call("get_profile").catch(() => S.profile);
  S.status = await call("get_status");
  renderSide();
  const st = S.status, cf = S.settings;
  const theme = document.documentElement.dataset.theme || "";
  const tabs = `<div class="toolbar"><div class="toolbar-left"><div class="tabs" role="tablist" id="set-tabs">${tabsHere.map(([k, v]) =>
    `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? "is-on" : ""}" data-st="${k}">${v}</button>`).join("")}</div></div></div>`;

  let body = "";
  if (tab === "general") {
    const mobile = !!st.mobile;
    body = section("个人资料", profileRow())
      + section("通用", (mobile ? "" : setRow("开机自动启动", "登录电脑后自动开始记录。", `<button class="mx-switch" role="switch" id="login" aria-checked="${!!st.login_item}" aria-label="开机自动启动"></button>`))
        + setRow("主题", "", `<div class="mx-seg" role="tablist" id="theme">${THEMES.map(([k, v]) => `<button role="tab" aria-selected="${k === theme}" class="${k === theme ? "is-on" : ""}" data-theme="${k}">${v}</button>`).join("")}</div>`))
      + aboutSection();
  } else if (tab === "record") {
    const pause = st.paused
      ? setRow("已暂停", st.paused_until ? `到 ${hm(st.paused_until)} 自动继续。` : "一直暂停，点继续才恢复。", `<button class="mx-btn mx-btn--primary mx-btn--sm" data-pause="off">继续记录</button>`)
      : setRow("暂停记录", "暂停后不记录", `<div class="btns"><button class="mx-btn mx-btn--secondary mx-btn--sm" data-pause="60">1 小时</button><button class="mx-btn mx-btn--secondary mx-btn--sm" data-pause="morning">到明早 8 点</button><button class="mx-btn mx-btn--secondary mx-btn--sm" data-pause="on">一直</button></div>`);
    const block = `<div class="block"><div><div class="mx-setting-name">不记录的 app</div><div class="mx-setting-desc">在前台时只记用了多久，不记内容。</div></div>
        ${cf.blocklist.length ? `<div class="mx-chips" id="chips">${cf.blocklist.map((b, i) => `<button class="mx-chip" data-i="${i}" title="移出">${esc(b)}${ICON.close}</button>`).join("")}</div>` : ""}
        <div class="inline"><input class="mx-input mono" id="block-new" placeholder="app 名或 bundle id，比如 1Password" aria-label="不记录的 app"><button class="mx-btn mx-btn--secondary" id="block-add">加入</button></div></div>`;
    const del = SS.deleting
      ? `<div class="mx-confirm"><div class="mx-confirm-text"><b>删除${DELETES.find((x) => x[0] === SS.deleting)[1]}的记录？</b><span>删了找不回来。</span></div><button class="mx-btn mx-btn--secondary" data-del="keep">取消</button><button class="mx-btn mx-btn--danger" data-del="go">删除</button></div>`
      : setRow("删除最近的记录", SS.deleted != null ? `刚删掉 ${SS.deleted} 条。` : "比如刚输过的私人内容。", `<div class="btns">${DELETES.map(([k, v]) => `<button class="mx-btn mx-btn--secondary mx-btn--sm" data-del="${k}">${v}</button>`).join("")}</div>`);
    body = section("记录", pause + block) + section("隐私", del);
  } else if (tab === "connect") {
    const ks = cf.api_key_source;
    body = section("模型服务", setRow("自主配置 AI", `<span class="mono">${esc(hostOf(cf.gateway) || "未设置 Base URL")} · ${esc(cf.model_segment || "未设置模型")}</span>`, `${pill(!!ks, ks ? "密钥已存" : "没有密钥")}${smallBtn("c-model", "设置")}`)
      + setRow("定时 AI 分析", "开启后，定时摘要与日总结会把所需记录发送给你配置的模型服务。关闭时仍可手动生成。", `<button class="mx-switch" role="switch" id="ai-enabled" aria-checked="${!!cf.ai_enabled}" aria-label="定时 AI 分析"></button>`))
      + (cf.legacy_model_disabled ? `<p class="note">原平台模型已停用。旧 Base URL、模型名与密钥均保留，请确认独立模型服务配置后再使用。</p>` : "");
  } else if (tab === "data") {
    body = SS.storage ? storageView(SS.storage) : `<div class="form">${emptyInline("在看数据存在哪……")}</div>`;
  } else {
    body = projectsSection();
  }
  $app.innerHTML = header("设置") + tabs + `<div class="form">${body}</div>`;

  document.getElementById("set-tabs").onclick = (e) => {
    const b = e.target.closest("[data-st]"); if (!b) return;
    SS.tab = b.dataset.st; try { localStorage.setItem("settings-tab", SS.tab); } catch (x) {}
    renderSettings();
  };
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
  if (tab === "general") {
    bindProfile();
    document.getElementById("theme").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const t = b.dataset.theme;
      if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
      try { t ? localStorage.setItem("theme", t) : localStorage.removeItem("theme"); } catch (err) {}
      renderSettings();
    };
    on("login", async () => { try { await call("set_login_item", { on: !st.login_item }); } catch (x) { alert(`没改成：${x}`); } renderSettings(); });
  }
  if (tab === "projects") bindProjects();
  if (tab === "record") {
    $app.querySelectorAll("[data-pause]").forEach((b) => (b.onclick = async () => {
      const k = b.dataset.pause;
      if (k === "off") await call("set_paused", { paused: false });
      else await call("set_paused", { paused: true, minutes: k === "on" ? null : k === "morning" ? minutesToMorning() : +k });
      renderSettings();
    }));
    $app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      const k = b.dataset.del;
      if (k === "keep") { SS.deleting = null; return renderSettings(); }
      if (k === "go") {
        const what = SS.deleting; SS.deleting = null;
        SS.deleted = await call("delete_since", what === "today" ? { today: true } : { minutes: +what });
        return renderSettings();
      }
      SS.deleting = k; SS.deleted = null; renderSettings();
    }));
    const setBlock = async (list) => { await saveSome({ blocklist: list }); renderSettings(); };
    const addBlock = () => { const v = document.getElementById("block-new").value.trim(); if (v && !cf.blocklist.includes(v)) setBlock([...cf.blocklist, v]); };
    on("block-add", addBlock);
    document.getElementById("block-new").onkeydown = (e) => { if (e.key === "Enter") addBlock(); };
    const chips = document.getElementById("chips");
    if (chips) chips.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) setBlock(cf.blocklist.filter((_, i) => i !== +b.dataset.i)); };
  }
  clearInterval(SS.storageTimer);
  if (tab === "data") {
    const load = async () => {
      try { SS.storage = await call("storage_stats"); } catch (x) { SS.storage = { error: String(x) }; }
      if (S.page === "settings" && SS.tab === "data" && !document.querySelector(".dlg-root")) renderSettings();
    };
    if (!SS.storage || Date.now() - (SS.storage.at || 0) > 60e3) load();
    SS.storageTimer = setInterval(load, 60e3);
    on("open-dir", () => call("open_data_dir"));
    on("local-export", () => localArchiveDialog("export"));
    on("local-import", () => localArchiveDialog("import"));
    on("repo-edit", () => openDialog({
      title: "人生记录仓库", ok: "保存",
      body: dlgField("repo", "路径", { value: cf.repo_path || "", mono: true, ph: "~/人生记录", help: "日数据包和日总结的文件夹" }),
      submit: async (el) => { await saveSome({ repo_path: dlgVal(el, "repo") }); renderSettings(); },
    }));
  }
  if (tab === "connect") {
    on("c-model", modelDialog);
    on("ai-enabled", async () => { await saveSome({ ai_enabled: !cf.ai_enabled }); renderSettings(); });
  }

}

/** 「数据」页：本机、Cloudflare、转写服务三处各存了什么、多大、留多久（方案见 报告/方案_20261021_录音与存储.md）；开着时每分钟刷新 */
function storageView(d) {
  if (d.error) return section("数据", `<div class="mx-field-error">${esc(d.error)}</div>`);
  const table = (rows, cols) => `<table class="mx-table store"><thead><tr>${cols.map((c) => `<th${c[2] ? ' class="num"' : ""}>${c[0]}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td${c[2] ? ' class="num mono"' : ""}>${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const L = d.local;
  const local = section("本机", setRow("数据目录", `<span class="mono">${esc((L.path || "").replace(/^\/Users\/[^/]+/, "~"))}</span> · 共 ${bytesText(L.total)}`, (S.status && S.status.mobile ? "" : smallBtn("open-dir", "在访达中打开")))
    + table(L.items, [["内容", (r) => esc(r.name)], ["大小", (r) => bytesText(r.bytes), 1], ["留多久", (r) => esc(r.keep)]]), { aside: "全部数据，以这里为准" });
  const repo = section("人生记录仓库", setRow(d.repo ? `<span class="mono">${esc((d.repo.path || "").replace(/^\/Users\/[^/]+/, "~"))}</span>` : "没填",
    d.repo ? `raw/ 共 ${bytesText(d.repo.bytes)} · ${esc(d.repo.keep)}` : "日数据包和日总结的文件夹", smallBtn("repo-edit", "更改")));
  return local + section("本地导入导出", setRow("数据归档", "手动保存到本机。导出不含 API Key、账户凭据和旧云端令牌；导入合并记录，不覆盖同名文件。", `<div class="btns">${smallBtn("local-export", "导出")}${smallBtn("local-import", "导入")}</div>`)) + repo + `<p class="note">${d.at ? `${hm(new Date(d.at).toISOString())} 取的，开着这一页每分钟更新。` : ""}</p>`;
}

function localArchiveDialog(action) {
  const exp=action==="export";
  if(!TAURI){openDialog({title:"本地归档",body:'<p>请在桌面应用中使用本地导入导出。</p>',cancel:"关闭"});return;}
  openDialog({title:exp?"导出本地数据":"导入本地数据",ok:exp?"保存归档":"导入归档",busy:"处理中…",body:dlgField("archive-path",exp?"保存文件的完整路径":"归档文件的完整路径",{mono:true,ph:exp?"~/Desktop/timeseen-2026-11-09.tar":"~/Desktop/timeseen-data.tar",help:exp?"文件保存在本机，不包含 API Key 和旧云端账户凭据。":"同名记录不覆盖，现有 AI 配置保持；导入配置另存到 imports。"}),submit:async el=>{const path=dlgVal(el,"archive-path");if(!path)throw "请填写完整路径。";const result=await call(exp?"export_local_data":"import_local_data",{path});SS.storage=null;S.todos=S.memos=null;setTimeout(()=>openDialog({title:exp?"已导出":"已导入",body:`<p>${exp?esc(result.path):`新增 ${result.imported} 个文件，跳过 ${result.skipped} 个同名文件。`}</p>${result.note?`<p class="note">${esc(result.note)}</p>`:""}`,cancel:"关闭"}),0);}});
}

function modelGatewayAddress(value) {
  const address = value.trim().replace(/\/+$/, "").replace(/\/(chat\/completions|responses|models)$/, "");
  let url;
  try { url = new URL(address); } catch { throw "请输入完整的 http:// 或 https:// 网关地址。"; }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw "网关地址需包含 http:// 或 https://，密钥请填写在密钥栏。";
  }
  if (url.hostname.toLowerCase().replace(/\.$/,"")==="beayy.com" || url.hostname.toLowerCase().replace(/\.$/,"").endsWith(".beayy.com")) throw "原平台服务已移除，请填写独立模型服务地址。";
  return address;
}

function modelClientHtml(settings) {
  return `<div class="mx-field"><label for="model-client">客户端兼容</label>
    <select id="model-client" class="mx-input"><option value="timeseen" ${settings.model_client !== "codex" ? "selected" : ""}>TimeSeen（默认）</option><option value="codex" ${settings.model_client === "codex" ? "selected" : ""}>Codex 兼容</option></select>
    <p class="note">Codex 兼容会发送 Codex 风格客户端标识，并保留 TimeSeen 来源；适用于你有权接入的网关，不增加模型权限。</p></div>
    <div class="mx-field"><label for="model-protocol">请求协议</label>
    <select id="model-protocol" class="mx-input"><option value="chat" ${settings.model_protocol !== "responses" ? "selected" : ""}>Chat Completions</option><option value="responses" ${settings.model_protocol === "responses" ? "selected" : ""}>Responses（Codex 常用）</option></select>
    <p class="note">列表获取、模型测试、摘要与日总结使用同一套配置；Codex 网关通常需要 Responses。</p></div>`;
}

function modelPickerHtml() {
  return `<div class="model-list" data-model-picker>
    <div class="model-list-head"><span>模型</span><span data-mp="count"></span></div>
    <div class="btns model-actions"><button type="button" class="mx-btn mx-btn--primary mx-btn--sm" data-mp="fetch">拉取全部模型</button><button type="button" class="mx-btn mx-btn--secondary mx-btn--sm" data-mp="test">测试已选</button><button type="button" class="mx-btn mx-btn--text mx-btn--sm" data-mp="stop" hidden>停止测试</button></div>
    <div class="model-selection-tools"><div class="mx-seg" role="tablist" aria-label="模型筛选">${[["all", "全部模型"], ["selected", "已选模型"], ["working", "测试可用"]].map(([value, label]) => `<button type="button" role="tab" data-mp-filter="${value}">${label}</button>`).join("")}</div><div class="btns"><button type="button" class="mx-btn mx-btn--text mx-btn--sm" data-mp="select-all">全选</button><button type="button" class="mx-btn mx-btn--text mx-btn--sm" data-mp="select-none">清空</button></div></div>
    <input class="mx-input" type="search" data-mp="search" aria-label="搜索模型" placeholder="搜索模型 ID…" autocomplete="off">
    <div class="model-chips" data-mp="chips" aria-label="可选模型"></div>
    <div class="inline model-add"><input class="mx-input mono" data-mp="new" aria-label="手动添加模型 ID" placeholder="手动添加模型 ID，多个用逗号分隔" autocomplete="off"><button type="button" class="mx-btn mx-btn--secondary" data-mp="add">添加模型</button></div>
    <p class="note model-current">已选 <b data-mp="selected-count"></b> 个模型 · 当前使用：<span class="mono" data-mp="current"></span></p>
    <p class="note">点击模型可多选，再次点击取消；点击「设为主用」切换摘要模型。测试会发送少量请求并消耗网关额度。</p>
    <p class="note model-feedback" data-mp="status" role="status" aria-live="polite"></p>
  </div>`;
}

function bindModelPicker(root, { getConnection, getModel, setModel, getSelected, setSelected }) {
  const box = root.querySelector("[data-model-picker]");
  const field = (name) => box.querySelector(`[data-mp="${name}"]`);
  let selected = new Set([...getSelected(), getModel()].filter(Boolean));
  let models = new Set(selected), manual = new Set();
  let tests = new Map(), filter = "all", fetched = false, fetching = false, revision = 0, run = null;
  let testPending = 0;
  const sorted = (ids) => [...ids].sort((first, second) => first.localeCompare(second));
  const choose = (ids) => { selected = new Set([...ids, getModel()].filter((id) => id && models.has(id))); setSelected(sorted(selected)); };
  const chooseOne = (id) => { if (!selected.has(id)) { selected.add(id); setSelected(sorted(selected)); } setModel(id); };
  const visible = () => {
    const query = field("search").value.trim().toLowerCase();
    return sorted([...models].filter((id) => (!query || id.toLowerCase().includes(query))
      && (filter !== "selected" || selected.has(id)) && (filter !== "working" || tests.get(id)?.ok)));
  };
  const feedback = (text, error = false) => {
    field("status").textContent = text;
    field("status").classList.toggle("model-feedback-error", error);
  };
  const draw = () => {
    const ids = visible(), current = getModel();
    field("count").textContent = `${ids.length} / ${models.size} 个`;
    field("current").textContent = current || "尚未选择";
    field("selected-count").textContent = selected.size;
    box.querySelectorAll("[data-mp-filter]").forEach((button) => {
      const active = button.dataset.mpFilter === filter;
      button.classList.toggle("is-on", active); button.setAttribute("aria-selected", String(active));
    });
    const chips = field("chips"), scroll = chips.scrollTop;
    chips.innerHTML = ids.map((id) => {
      const result = tests.get(id), pending = tests.has(id) && result === null;
      const status = pending ? "测试中…" : result ? result.ok ? `${result.ms} ms` : "失败" : "";
      const title = pending ? "正在请求此模型" : result ? result.ok ? `可用 · ${result.ms} ms` : result.error : selected.has(id) ? "点击取消选择" : "点击选择此模型";
      return `<span class="model-entry"><button type="button" class="model-chip${selected.has(id) ? " selected" : ""}${id === current ? " primary" : ""}${pending ? " pending" : result ? result.ok ? " ok" : " bad" : ""}" data-model="${esc(id)}" aria-pressed="${selected.has(id)}" title="${esc(title)}">${selected.has(id) ? ICON.check : ""}<span>${esc(id)}</span>${id === current ? '<em>主用</em>' : ""}${result?.ok ? '<i class="dot" aria-hidden="true"></i>' : ""}${status ? `<b>${esc(status)}</b>` : ""}</button><button type="button" class="model-test-one" data-primary-model="${esc(id)}" ${id === current ? "disabled" : ""}>设为主用</button><button type="button" class="model-test-one" data-test-model="${esc(id)}" aria-label="${esc(`测试 ${id}`)}" ${run || fetching || testPending ? "disabled" : ""}>测试</button></span>`;
    }).join("") || `<p class="note">${filter === "working" ? "还没有测试成功的模型。" : models.size ? "没有符合条件的模型。" : "填写地址和密钥，获取全部模型，或手动添加模型 ID。"}</p>`;
    chips.scrollTop = scroll;
    field("fetch").disabled = fetching || !!run || !!testPending;
    field("fetch").textContent = fetching ? "拉取中…" : fetched ? "重新拉取全部模型" : "拉取全部模型";
    field("test").disabled = !selected.size || fetching || !!run || !!testPending;
    field("select-all").disabled = !ids.length || fetching || !!run;
    field("select-none").disabled = !selected.size || fetching || !!run;
    field("stop").hidden = !run;
    field("stop").disabled = !!run?.stopped;
    field("stop").textContent = run?.stopped ? "等待当前请求结束…" : "停止测试";
    field("add").disabled = !field("new").value.trim();
  };
  const add = () => {
    const ids = [...new Set(field("new").value.split(/[,\n]/).map((id) => id.trim()).filter(Boolean))];
    if (!ids.length) return;
    for (const id of ids) { models.add(id); manual.add(id); selected.add(id); }
    choose(selected); setModel(ids[0]); field("new").value = ""; field("search").value = ""; filter = "all";
    feedback(`已添加并选择 ${ids.length} 个模型，当前使用 ${ids[0]}`); draw();
  };
  const reset = () => {
    revision++;
    if (run) run.stopped = true;
    run = null; fetching = false; fetched = false; tests = new Map(); manual = new Set();
    selected = new Set([...getSelected(), getModel()].filter(Boolean)); models = new Set(selected); filter = "all"; field("search").value = "";
    feedback("地址或密钥已更改，请重新获取列表或测试。"); draw();
  };
  field("fetch").onclick = async () => {
    if (run || fetching || testPending) return;
    const generation = ++revision, connection = getConnection();
    fetching = true; feedback("正在获取供应商的全部模型…"); draw();
    try {
      const ids = await call("list_models", connection);
      if (generation !== revision || !box.isConnected) return;
      models = new Set([...ids, ...manual, ...selected]); fetched = true; filter = "all";
      feedback(ids.length ? `已拉取 ${ids.length} 个模型。可全选或点击指定模型，再测试已选。` : "供应商返回空列表，可以手动添加模型 ID。");
    } catch (error) {
      if (generation === revision) feedback(`获取失败：${String(error)}`, true);
    } finally {
      if (generation === revision) { fetching = false; draw(); }
    }
  };
  const test = async (ids) => {
    if (run || fetching || testPending || !ids.length) return;
    const task = { stopped: false }, generation = revision, connection = getConnection();
    run = task;
    let next = 0, finished = 0, succeeded = 0, lastError = "";
    const active = () => generation === revision && box.isConnected && !task.stopped;
    const progress = () => feedback(`已测试 ${finished}/${ids.length} 个 · 可用 ${succeeded} 个${lastError ? ` · ${lastError}` : ""}`);
    const worker = async () => {
      while (active() && next < ids.length) {
        const id = ids[next++]; tests.set(id, null); draw();
        let result;
        testPending++;
        try {
          const results = await call("test_models", { ...connection, models: [id] });
          result = results.find((value) => value.model === id) || { model: id, ok: false, error: "未收到模型测试结果" };
        } catch (error) { result = { model: id, ok: false, error: String(error) }; }
        finally { testPending--; }
        if (generation !== revision || !box.isConnected) { if (box.isConnected) draw(); return; }
        tests.set(id, result); finished++; if (result.ok) succeeded++; else lastError = `${id}：${result.error}`;
        progress(); draw();
      }
    };
    feedback(`开始测试 ${ids.length} 个模型…`); draw();
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    if (generation !== revision || !box.isConnected) return;
    run = null;
    if (task.stopped) feedback(`已停止后续测试 · 完成 ${finished}/${ids.length} 个 · 可用 ${succeeded} 个`);
    else progress();
    draw();
  };
  field("test").onclick = () => test(sorted(selected));
  field("select-all").onclick = () => { const ids = field("search").value.trim() ? visible() : [...selected, ...visible()]; choose(ids); feedback(`已选择 ${selected.size} 个模型，点击「测试已选」检查可用性。`); draw(); };
  field("select-none").onclick = () => { choose([]); feedback("已清空其他选择，保留当前主用模型；重新点击模型可设为主用。"); draw(); };
  field("stop").onclick = () => {
    if (run) run.stopped = true;
    feedback("已停止发送新测试，正在执行的请求结束后显示结果（单次最多 30 秒）。"); draw();
  };
  field("search").oninput = draw;
  field("search").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); } };
  field("new").oninput = draw;
  field("new").onkeydown = (event) => {
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); add(); }
  };
  field("add").onclick = add;
  box.onclick = (event) => {
    const filterButton = event.target.closest("[data-mp-filter]");
    if (filterButton) { filter = filterButton.dataset.mpFilter; draw(); return; }
    const testButton = event.target.closest("[data-test-model]");
    if (testButton) { test([testButton.dataset.testModel]); return; }
    const primaryButton = event.target.closest("[data-primary-model]");
    if (primaryButton) { chooseOne(primaryButton.dataset.primaryModel); draw(); return; }
    const modelButton = event.target.closest("[data-model]");
    if (modelButton) {
      const id = modelButton.dataset.model;
      if (selected.has(id)) { selected.delete(id); choose(selected); }
      else { selected.add(id); choose(selected); setModel(id); }
      draw();
    }
  };
  draw();
  return { reset, add, selected: () => sorted(selected) };
}

function modelDialog() {
  const cf = S.settings, ks = cf.api_key_source;
  let picker;
  return openDialog({
    title: "模型", ok: "保存",
    body: `<div class="stack">`
      + dlgField("gw", "网关地址", { value: cf.gateway, mono: true, ph: cf.default_gateway, help: "可填 DeepSeek、通义千问等兼容接口，也可填本机 http://127.0.0.1:11434/v1。仅直连此地址。" })
      + dlgField("key", "密钥", { type: "password", mono: true, ph: ks === "env" ? "在用环境变量里的" : ks ? KEEP : "sk-…", help: "留空使用已保存的密钥。获取和测试使用当前填写的内容，保存后才会修改配置。" })
      + modelClientHtml(cf)
      + `<input type="hidden" id="md" value="${esc(cf.model_segment || "")}"><input type="hidden" id="model-list-selected">${modelPickerHtml()}`
      + dlgField("daily-model", "日总结模型（选填）", { value: cf.model_daily || "", mono: true, help: "可与摘要模型不同；留空时使用当前所选摘要模型。" })
      + (cf.default_gateway ? `<button type="button" class="mx-btn mx-btn--text mx-btn--sm" style="align-self:flex-start" id="md-reset">恢复默认地址和模型</button>` : "") + `</div>`,
    onOpen: (el) => {
      el.classList.add("model-dialog");
      picker = bindModelPicker(el, {
        getConnection: () => ({ gateway: dlgVal(el, "gw"), key: dlgVal(el, "key"), client: dlgVal(el, "model-client"), protocol: dlgVal(el, "model-protocol") }),
        getModel: () => dlgVal(el, "md"), setModel: (id) => { el.querySelector("#md").value = id; },
        getSelected: () => JSON.parse(el.querySelector("#model-list-selected").value || "[]"),
        setSelected: (ids) => { el.querySelector("#model-list-selected").value = JSON.stringify(ids); },
      });
      el.querySelector("#model-list-selected").value = JSON.stringify(Array.isArray(cf.model_list) && cf.model_list.length ? cf.model_list : [cf.model_segment].filter(Boolean));
      picker.selected();
      for (const id of ["gw", "key"]) el.querySelector(`#${id}`).addEventListener("input", picker.reset);
      el.querySelector("#model-client").onchange = () => {
        if (dlgVal(el, "model-client") === "codex") el.querySelector("#model-protocol").value = "responses";
        picker.reset();
      };
      el.querySelector("#model-protocol").onchange = picker.reset;
      const reset = el.querySelector("#md-reset");
      if (reset) reset.onclick = () => { el.querySelector("#gw").value = cf.default_gateway; el.querySelector("#md").value = cf.default_model || ""; picker.reset(); };
    },
    submit: async (el) => {
      picker.add();
      const gateway = modelGatewayAddress(dlgVal(el, "gw"));
      const model = dlgVal(el, "md"), key = dlgVal(el, "key");
      if (!model) throw "从列表选择一个模型，或手动添加模型 ID。";
      const modelList = picker.selected();
      if (!modelList.length) throw "请至少选择一个模型；可全选或点击指定模型。";
      if (key) await call("set_api_key", { key });
      await saveSome({ gateway, model_segment: model, model_list: modelList, model_daily: dlgVal(el, "daily-model") || model, model_client: dlgVal(el, "model-client"), model_protocol: dlgVal(el, "model-protocol") });
      renderSettings();
    },
  });
}

// ---------- 首次启动引导 ----------

const OB = { step: 0, timer: null };
async function renderOnboarding() {
  document.documentElement.classList.add("onboarding");
  const st = S.status = await call("get_status"), perm = st.permissions || {};
  const steps = ["认识时见", "本机权限", "自主配置 AI"];
  const permissionRows = [["accessibility", "辅助功能", "读取应用窗口与界面文字"], ["input_monitoring", "输入监控", "记录键鼠活动"], ["full_disk_access", "完全磁盘访问（可选）", "读取本机 iPhone 屏幕使用时间"]].map(([key,label,help]) => setRow(label,help,perm[key] ? pill(true,"已授权") : smallBtn("ob-perm-"+key,"去授权"))).join("");
  const bodies = [
    `<h1 class="ob-title">时见 TimeSeen</h1><p class="ob-lead">看见时间，看见自己。</p><p>本地记录一天，管理待办，留出专注时间。人文帮出品。</p><p class="note">记录默认保存在本机。AI 分析只会直接请求你配置的模型服务，定时分析默认关闭。</p>`,
    `<h2>本机权限</h2>${IS_WIN ? '<p>Windows 无需单独授权。</p>' : permissionRows}`,
    `<h2>自主配置 AI</h2><p class="ob-lead">支持国产及其他兼容 OpenAI 的模型服务，也支持本地模型。填写自己的 Base URL、API Key 和模型名。</p><button class="mx-btn mx-btn--secondary" id="ob-model-settings">配置模型</button><p class="note">可以稍后设置，离线时仍可记录、计时和管理待办。</p>`
  ];
  $app.innerHTML = `<div class="ob"><div class="ob-steps">${steps.map((name,i)=>`<span class="${i===OB.step?"is-on":""}">${i+1}. ${name}</span>`).join("")}</div><div class="ob-body">${bodies[OB.step]}</div><div class="ob-nav">${OB.step?'<button class="mx-btn mx-btn--text" id="ob-back">上一步</button>':'<span></span>'}<button class="mx-btn mx-btn--primary" id="ob-next">${OB.step===2?"开始使用":"继续"}</button></div></div>`;
  clearInterval(OB.timer);
  if (OB.step === 1) OB.timer = setInterval(async()=>{const next=(await call("get_status")).permissions||{};if(JSON.stringify(next)!==JSON.stringify(perm))renderOnboarding();},2000);
  document.getElementById("ob-back")?.addEventListener("click",()=>{OB.step--;renderOnboarding();});
  document.getElementById("ob-next").onclick=async()=>{if(OB.step===2){clearInterval(OB.timer);await saveSome({onboarded:true});document.documentElement.classList.remove("onboarding");location.hash="#/today";route();}else{OB.step++;renderOnboarding();}};
  document.getElementById("ob-model-settings")?.addEventListener("click",modelDialog);
  $app.querySelectorAll('[id^="ob-perm-"]').forEach(b=>b.onclick=()=>call("open_permission",{kind:b.id.replace("ob-perm-","")}));
}

// ---------- 路由 ----------

async function route() {
  const t0 = performance.now();
  try { await route1(); } finally { const ms = performance.now() - t0; if (ms > 300 || PERF.cycle) perfNote(`route ${location.hash || "#/today"} ${Math.round(ms)}ms`); }
}

async function route1() {
  const [page = "today", arg, arg2] = location.hash.replace(/^#\/?/, "").split("/");
  // 换页就关掉弹层；刚拿到恢复码那个必须点「我已存好」才关
  if (DLG && DLG.closable) closeDialog();
  S.page = ["today", "focus", "summary", "rules", "todos", "devices", "settings"].includes(page) ? page : "today";
  $app.classList.toggle("focus-page", S.page === "focus");
  markNav(S.page);
  // 四象限待办用宽版；其它页（除今天自己会 toggle）先收掉
  if (S.page !== "todos" && S.page !== "today") $app.classList.remove("wide");
  try {
    if (!S.days.length && !S.status) await boot();
    if (!S.settings) { S.settings = await call("get_settings"); S.draft = JSON.parse(JSON.stringify(S.settings)); }
    if (!S.settings.onboarded && TAURI && !(S.status && S.status.mobile)) return renderOnboarding();
    if (S.page !== "devices") { DEV.id = null; stopEventsTimer(); }
    if (S.page === "focus") await TimeSeenFocus.show();
    else if (S.page === "summary") await renderSummary(arg);
    else if (S.page === "rules") await renderRules();
    else if (S.page === "todos") await renderNotes(arg);
    else if (S.page === "devices") { if (arg) await renderDevice(decodeURIComponent(arg), arg2); else { DEV.id = null; stopEventsTimer(); await renderDevices(); } }
    else if (S.page === "settings") await renderSettings();
    else { TD.date = /^\d{4}-\d{2}-\d{2}$/.test(arg || "") ? arg : null; await renderToday(); }
    document.getElementById("main").scrollTop = 0;
  } catch (e) {
    $app.innerHTML = header("出错了") + `<p class="mx-error">${esc(e && e.message ? e.message : e)}</p>`;
  }
}

document.addEventListener("click", (e) => {
  for (const menu of document.querySelectorAll(".pick .mx-menu")) if (!menu.hidden && !menu.parentElement.contains(e.target)) menu.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") for (const menu of document.querySelectorAll(".pick .mx-menu")) menu.hidden = true;
});
// 后退／前进：自己记一份走过的页面，没得退或没得进时按钮置灰（照 Claude）
const NAV = { stack: [], pos: -1, jumping: false };
function trackNav() {
  const h = location.hash || "#/today";
  if (NAV.jumping) NAV.jumping = false;
  else if (NAV.stack[NAV.pos] !== h) { NAV.stack = NAV.stack.slice(0, NAV.pos + 1).concat(h); NAV.pos = NAV.stack.length - 1; }
  document.getElementById("go-back").disabled = NAV.pos <= 0;
  document.getElementById("go-fwd").disabled = NAV.pos >= NAV.stack.length - 1;
}
const jump = (d) => { const p = NAV.pos + d; if (p < 0 || p >= NAV.stack.length) return; NAV.pos = p; NAV.jumping = true; location.hash = NAV.stack[p]; };
document.getElementById("go-back").onclick = () => jump(-1);
document.getElementById("go-fwd").onclick = () => jump(1);
window.addEventListener("hashchange", trackNav);
trackNav();
document.getElementById("side-toggle").onclick = () => {
  const root = document.documentElement, collapsed = root.dataset.side === "collapsed";
  if (collapsed) delete root.dataset.side; else root.dataset.side = "collapsed";
  const btn = document.getElementById("side-toggle"), label = collapsed ? "收起侧栏" : "展开侧栏";
  btn.setAttribute("aria-label", label); btn.title = label;
  try { collapsed ? localStorage.removeItem("side") : localStorage.setItem("side", "collapsed"); } catch (e) {}
};
if (document.documentElement.dataset.side === "collapsed") { const b = document.getElementById("side-toggle"); b.setAttribute("aria-label", "展开侧栏"); b.title = "展开侧栏"; }
window.addEventListener("hashchange", route);
// 今天页每分钟自动刷新（展开着某一段、或正在看别的页时不刷）
setInterval(async () => {
  if (S.page !== "today" || isPastDay() || document.hidden || $app.querySelector("details[open]") || document.getElementById("pl-live") || EDITOR) return;
  const y = document.getElementById("main").scrollTop;
  try { [S.days, S.status] = await Promise.all([call("list_days"), call("get_status")]); renderSide(); await renderToday(); } catch (e) { return; }
  document.getElementById("main").scrollTop = y;
}, 60000);
route();
// 自测：TIMESEEN_PERF=1 启动时依次切各页三轮并记耗时（见 perf.txt）
setTimeout(async () => {
  if (!TAURI) return;
  let st; try { st = await TAURI.invoke("get_status"); } catch (e) { return; }
  if (!st || !st.perf) return;
  PERF.cycle = true;
  for (let r = 0; r < (st.perf === "daily" ? 0 : 3); r++) for (const h of ["#/summary", "#/rules", "#/todos", "#/devices", "#/today"]) {
    location.hash = h; await new Promise((ok) => setTimeout(ok, 2500));
  }
  if (st.perf === "daily") {
    const d = localDay(), t1 = performance.now();
    try { await call("generate_daily", { date: d }); perfNote(`generate_daily 成功 ${Math.round(performance.now() - t1)}ms`); }
    catch (x) { perfNote(`generate_daily 失败 ${Math.round(performance.now() - t1)}ms：${x}`); }
  }
  perfNote("自测结束");
}, 6000);

/* 窗口：侧栏顶和页标题可拖动；在这两处双击放大或还原。不画一条可见的标题栏。 */
(function () {
  if (!window.__TAURI__) return;
  const noDrag = 'button,a,input,select,textarea,label,.mx-iconbtn,.win-tools,.mx-head-right,.mx-nav';
  const current = () => {
    const w = window.__TAURI__.window;
    if (w && w.getCurrentWindow) return w.getCurrentWindow();
    if (w && w.appWindow) return w.appWindow;
    return null;
  };
  const inDragRegion = (e) => !e.target.closest(noDrag) && e.target.closest('[data-tauri-drag-region]');
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.detail > 1) return;
    if (!inDragRegion(e)) return;
    const x = e.screenX, y = e.screenY;
    const move = (ev) => {
      if (Math.hypot(ev.screenX - x, ev.screenY - y) < 4) return;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const win = current();
      if (win && win.startDragging) win.startDragging();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, true);
  document.addEventListener('dblclick', (e) => {
    if (!inDragRegion(e)) return;
    const win = current();
    if (!win || !win.isMaximized || !win.maximize || !win.unmaximize) return;
    win.isMaximized().then((on) => (on ? win.unmaximize() : win.maximize())).catch(() => {});
  }, true);
})();
