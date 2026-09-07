#!/usr/bin/env node
// Рендер строки. Только диск, никакой сети, никогда не бросает.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'presence');
const STATE = path.join(DIR, 'state.json');
const COHORT = path.join(DIR, 'cohort.json');
const TTL_MS = 5 * 60 * 1000;
const LIMIT_PCT = 95;

// Имена полей rate_limits менялись между версиями Claude Code.
function usedPct(input) {
  const rl = input && input.rate_limits;
  const w = rl && (rl.five_hour || rl.fiveHour);
  if (!w || typeof w !== 'object') return null;
  for (const k of ['used_pct', 'usedPct', 'utilization', 'used_percent']) {
    const v = w[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v <= 1 ? v * 100 : v;
  }
  if (typeof w.used === 'number' && typeof w.limit === 'number' && w.limit > 0) {
    return (w.used / w.limit) * 100;
  }
  return null;
}

function render(c, now) {
  if (!c || typeof c.streak !== 'number' || !Number.isFinite(c.streak)) return '';
  let s = `день ${c.streak}`;
  const fresh = typeof c.ts === 'number' && now - c.ts < TTL_MS;
  if (fresh) {
    if (c.limited > 0) s += ` · ${c.limited} из твоих на лимите`;
    else if (c.near > 0) s += ` · рядом ${c.near}`;
  }
  return s;
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const p = usedPct(input);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({
      state: p !== null && p >= LIMIT_PCT ? 'limit' : 'work',
      ts: Date.now(),
    }));
  } catch {}
  try {
    const line = render(JSON.parse(fs.readFileSync(COHORT, 'utf8')), Date.now());
    if (line) process.stdout.write(line);
  } catch {}
}

if (require.main === module) main();
module.exports = { usedPct, render, TTL_MS };
