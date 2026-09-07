#!/usr/bin/env node
// Единственный процесс, который ходит в сеть. Тик раз в 45 секунд.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = os.homedir();
const DIR = path.join(HOME, '.claude', 'presence');
const PROJECTS = path.join(HOME, '.claude', 'projects');
const ID_FILE = path.join(DIR, 'id');
const STATE = path.join(DIR, 'state.json');
const COHORT = path.join(DIR, 'cohort.json');
const SERVER = process.env.PRESENCE_SERVER || 'http://127.0.0.1:8787';
const TICK_MS = 45_000;
const STATE_TTL_MS = 120_000;
const DAY_MS = 86_400_000;

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

function collectDays(root, now = Date.now()) {
  const days = new Set();
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true, recursive: true });
  } catch {
    return days;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    try {
      const m = fs.statSync(path.join(e.parentPath || e.path, e.name)).mtimeMs;
      if (m <= now) days.add(dayKey(m));
    } catch {}
  }
  return days;
}

// Поблажка: пока сегодняшней сессии нет, стрик считается от вчера.
function streakFrom(days, now = Date.now()) {
  let cursor = days.has(dayKey(now)) ? now : now - DAY_MS;
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor -= DAY_MS;
  }
  return n;
}

function getId() {
  try {
    const v = fs.readFileSync(ID_FILE, 'utf8').trim();
    if (/^[0-9a-f]{32}$/.test(v)) return v;
  } catch {}
  const id = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ID_FILE, id, { mode: 0o600 });
  return id;
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (s.state === 'limit' && Date.now() - s.ts < STATE_TTL_MS) return 'limit';
  } catch {}
  return 'work';
}

function writeCohort(data) {
  const tmp = `${COHORT}.${process.pid}.tmp`;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, COHORT);
}

async function tick(id) {
  const streak = streakFrom(collectDays(PROJECTS));
  const body = { id, streak, state: readState() };
  let near = 0;
  let limited = 0;
  try {
    const res = await fetch(`${SERVER}/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const j = await res.json();
      near = Number(j.near) || 0;
      limited = Number(j.limited) || 0;
    }
  } catch {}
  try {
    writeCohort({ streak, near, limited, ts: Date.now() });
  } catch {}
}

function main() {
  const id = getId();
  const run = () => tick(id).catch(() => {});
  run();
  setInterval(run, TICK_MS);
}

if (require.main === module) main();
module.exports = { streakFrom, dayKey, collectDays };
