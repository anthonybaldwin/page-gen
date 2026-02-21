/**
 * Minimal JSONL log viewer served via Bun.
 * Usage: bun scripts/logs-viewer.ts
 * Opens a web UI at http://localhost:3200
 */

import { join } from "path";
import { readFileSync } from "fs";

const LOG_DIR = join(import.meta.dir, "../logs");
const APP_LOG = join(LOG_DIR, "app.jsonl");
const PORT = Number(process.env.LOGS_PORT) || 3200;

interface LogEntry {
  ts: string;
  level: string;
  tag: string;
  msg: string;
  [key: string]: unknown;
}

function readLogs(): LogEntry[] {
  const file = Bun.file(APP_LOG);
  if (!file.size) return [];
  const text = readFileSync(APP_LOG, "utf-8");
  const entries: LogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; background: #1e1e2e; color: #cdd6f4; font-size: 13px; }
  .toolbar { position: sticky; top: 0; z-index: 10; background: #181825; border-bottom: 1px solid #313244; padding: 8px 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .toolbar label { color: #a6adc8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .toolbar select, .toolbar input { background: #313244; color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px; padding: 4px 8px; font-family: inherit; font-size: 12px; }
  .toolbar select:focus, .toolbar input:focus { outline: none; border-color: #89b4fa; }
  .toolbar input[type="search"] { width: 220px; }
  .toolbar input[type="datetime-local"] { width: 185px; }
  .toolbar input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: invert(0.7); }
  .toolbar .count { margin-left: auto; color: #6c7086; font-size: 11px; }
  .toolbar button { background: #313244; color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-family: inherit; font-size: 12px; }
  .toolbar button:hover { background: #45475a; }
  .toolbar button.active { background: #89b4fa; color: #1e1e2e; border-color: #89b4fa; }
  table { width: 100%; border-collapse: collapse; }
  thead { position: sticky; top: 41px; z-index: 5; }
  th { background: #181825; color: #a6adc8; text-align: left; padding: 6px 10px; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #313244; }
  td { padding: 4px 10px; border-bottom: 1px solid #1e1e2e; vertical-align: top; white-space: nowrap; }
  tr { background: #181825; }
  tr:hover { background: #1e1e30; }
  tr.expanded { background: #1e1e30; }
  .ts { color: #6c7086; width: 90px; }
  .level { width: 50px; font-weight: 600; text-transform: uppercase; font-size: 11px; }
  .level-info { color: #89b4fa; }
  .level-warn { color: #f9e2af; }
  .level-error { color: #f38ba8; }
  .tag { color: #a6e3a1; width: 100px; }
  .msg { color: #cdd6f4; white-space: pre-wrap; word-break: break-word; max-width: 0; width: 100%; }
  .extra-toggle { color: #89b4fa; cursor: pointer; font-size: 11px; margin-left: 6px; user-select: none; }
  .extra-row td { padding: 0 10px 6px 10px; border-bottom: 1px solid #313244; }
  .extra-content { background: #11111b; border-radius: 4px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap; word-break: break-all; color: #bac2de; max-height: 400px; overflow: auto; }
  .highlight { background: #f9e2af33; border-radius: 2px; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #313244; color: #cdd6f4; border: 1px solid #45475a; border-radius: 8px; padding: 10px 18px; font-size: 12px; display: flex; align-items: center; gap: 10px; z-index: 100; box-shadow: 0 4px 16px rgba(0,0,0,0.4); opacity: 0; pointer-events: none; transition: opacity 0.2s; }
  .toast.visible { opacity: 1; pointer-events: auto; }
  .toast button { background: #89b4fa; color: #1e1e2e; border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600; }
  .toast button:hover { background: #b4d0fb; }
</style>
</head>
<body>
<div class="toolbar">
  <label>Level</label>
  <select id="level-filter">
    <option value="">All</option>
    <option value="info">info</option>
    <option value="warn">warn</option>
    <option value="error">error</option>
  </select>
  <label>Tag</label>
  <select id="tag-filter"><option value="">All</option></select>
  <label>From</label>
  <input type="datetime-local" id="date-from" step="1">
  <label>To</label>
  <input type="datetime-local" id="date-to" step="1">
  <label>Search</label>
  <input type="search" id="search" placeholder="Filter messages...">
  <button id="btn-sort" title="Toggle sort direction">Newest first</button>
  <button id="btn-tail" title="Auto-scroll to newest">Tail</button>
  <button id="btn-refresh" title="Reload logs">Refresh</button>
  <span class="count" id="count"></span>
</div>
<div class="toast" id="toast">Tailing paused — you scrolled away <button id="toast-resume">Resume</button></div>
<table>
  <thead><tr><th class="ts">Time</th><th class="level">Level</th><th class="tag">Tag</th><th class="msg">Message</th></tr></thead>
  <tbody id="log-body"></tbody>
</table>
<script>
let allLogs = [];
let tailing = true;
let sortNewest = true;
let pollTimer = null;

const body = document.getElementById('log-body');
const levelFilter = document.getElementById('level-filter');
const tagFilter = document.getElementById('tag-filter');
const search = document.getElementById('search');
const countEl = document.getElementById('count');
const dateFrom = document.getElementById('date-from');
const dateTo = document.getElementById('date-to');
const btnSort = document.getElementById('btn-sort');
const btnTail = document.getElementById('btn-tail');
const btnRefresh = document.getElementById('btn-refresh');
const toast = document.getElementById('toast');
const toastResume = document.getElementById('toast-resume');
let toastTimer = null;
let scrolledByRender = false;

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function highlightText(text, q) {
  if (!q) return escHtml(text);
  const escaped = escHtml(text);
  const qEsc = q.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  return escaped.replace(new RegExp(qEsc, 'gi'), m => '<span class="highlight">' + m + '</span>');
}

function extraFields(entry) {
  const skip = new Set(['ts','level','tag','msg']);
  const extra = {};
  let has = false;
  for (const [k,v] of Object.entries(entry)) {
    if (!skip.has(k)) { extra[k] = v; has = true; }
  }
  return has ? extra : null;
}

function render() {
  const lv = levelFilter.value;
  const tg = tagFilter.value;
  const q = search.value.toLowerCase();

  const fromVal = dateFrom.value;
  const toVal = dateTo.value;
  const fromMs = fromVal ? new Date(fromVal).getTime() : 0;
  const toMs = toVal ? new Date(toVal).getTime() : Infinity;

  const filtered = allLogs.filter(e => {
    if (lv && e.level !== lv) return false;
    if (tg && e.tag !== tg) return false;
    if (fromVal || toVal) {
      const t = new Date(e.ts).getTime();
      if (t < fromMs || t > toMs) return false;
    }
    if (q && !e.msg.toLowerCase().includes(q) && !e.tag.toLowerCase().includes(q) && !JSON.stringify(e).toLowerCase().includes(q)) return false;
    return true;
  });

  countEl.textContent = filtered.length + ' / ' + allLogs.length + ' entries';

  if (sortNewest) filtered.reverse();

  const rows = [];
  for (const entry of filtered) {
    const extra = extraFields(entry);
    const id = 'r' + rows.length;
    const toggleHtml = extra ? '<span class="extra-toggle" data-id="' + id + '">+data</span>' : '';
    rows.push(
      '<tr>' +
        '<td class="ts">' + fmtTime(entry.ts) + '</td>' +
        '<td class="level level-' + entry.level + '">' + entry.level + '</td>' +
        '<td class="tag">' + escHtml(entry.tag) + '</td>' +
        '<td class="msg">' + highlightText(entry.msg, escHtml(q)) + toggleHtml + '</td>' +
      '</tr>'
    );
    if (extra) {
      rows.push(
        '<tr class="extra-row" id="' + id + '" style="display:none">' +
          '<td colspan="4"><div class="extra-content">' + escHtml(JSON.stringify(extra, null, 2)) + '</div></td>' +
        '</tr>'
      );
    }
  }
  body.innerHTML = rows.join('');

  if (tailing) {
    scrolledByRender = true;
    window.scrollTo(0, sortNewest ? 0 : document.body.scrollHeight);
  }
}

function showToast() {
  clearTimeout(toastTimer);
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function pauseTailing() {
  tailing = false;
  btnTail.classList.remove('active');
  showToast();
}

function resumeTailing() {
  clearTimeout(toastTimer);
  toast.classList.remove('visible');
  tailing = true;
  btnTail.classList.add('active');
  window.scrollTo(0, sortNewest ? 0 : document.body.scrollHeight);
}

window.addEventListener('scroll', () => {
  if (scrolledByRender) { scrolledByRender = false; return; }
  if (!tailing) return;
  const atTailPos = sortNewest
    ? window.scrollY < 5
    : (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 5;
  if (!atTailPos) pauseTailing();
}, { passive: true });

function populateTags() {
  const tags = [...new Set(allLogs.map(e => e.tag))].sort();
  const current = tagFilter.value;
  tagFilter.innerHTML = '<option value="">All</option>' + tags.map(t => '<option value="' + t + '"' + (t === current ? ' selected' : '') + '>' + t + '</option>').join('');
}

async function fetchLogs() {
  const res = await fetch('/api/logs');
  allLogs = await res.json();
  populateTags();
  render();
}

body.addEventListener('click', e => {
  const toggle = e.target.closest('.extra-toggle');
  if (!toggle) return;
  const row = document.getElementById(toggle.dataset.id);
  if (!row) return;
  const visible = row.style.display !== 'none';
  row.style.display = visible ? 'none' : '';
  toggle.textContent = visible ? '+data' : '-data';
  toggle.closest('tr')?.classList.toggle('expanded', !visible);
});

levelFilter.addEventListener('change', render);
tagFilter.addEventListener('change', render);
dateFrom.addEventListener('change', render);
dateTo.addEventListener('change', render);
search.addEventListener('input', render);

btnSort.addEventListener('click', () => {
  sortNewest = !sortNewest;
  btnSort.textContent = sortNewest ? 'Newest first' : 'Oldest first';
  render();
});

btnTail.addEventListener('click', () => {
  if (tailing) { pauseTailing(); } else { resumeTailing(); }
});
btnTail.classList.add('active');

toastResume.addEventListener('click', resumeTailing);

btnRefresh.addEventListener('click', fetchLogs);

// Poll for new entries every 2s
pollTimer = setInterval(fetchLogs, 2000);

fetchLogs();
</script>
</body>
</html>`;

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/logs") {
      const entries = readLogs();
      return Response.json(entries);
    }

    // Serve the HTML UI for everything else
    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`Log viewer running at http://localhost:${PORT}`);
