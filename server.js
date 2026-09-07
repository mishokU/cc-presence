#!/usr/bin/env node
// Приём пингов. Map в памяти, TTL 120 секунд, ни базы, ни диска.
'use strict';
const http = require('http');

const PORT = Number(process.env.PORT) || 8787;
const TTL_MS = 120_000;
const MAX_BODY = 1024;

const live = new Map();

// Ниже этого числа онлайн когорта не делится: делить нечего.
const COHORT_MIN_ALIVE = 20;

// Симметрично: ±25% от большего стрика, но не уже ±3 дней.
// Полоса от собственного стрика делала отношение односторонним —
// 36 видел 27, а 27 не видел 36.
function isNear(a, b) {
  return Math.abs(a - b) <= Math.max(3, 0.25 * Math.max(a, b));
}

function cohort(id, streak, now, peers = live) {
  const alive = [];
  for (const [pid, p] of peers) {
    if (pid === id || p.exp <= now) continue;
    alive.push(p);
  }
  const split = alive.length >= COHORT_MIN_ALIVE;
  let near = 0;
  let night = 0;
  let limited = 0;
  for (const p of alive) {
    if (split && !isNear(streak, p.streak)) continue;
    near++;
    if (p.night) night++;
    if (p.state === 'limit') limited++;
  }
  return { near, night, limited };
}

function valid(b) {
  return b
    && typeof b.id === 'string' && /^[0-9a-f]{32}$/.test(b.id)
    && Number.isInteger(b.streak) && b.streak >= 0 && b.streak < 100_000
    && (b.state === 'work' || b.state === 'limit')
    && (b.night === undefined || typeof b.night === 'boolean');
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/ping') {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > MAX_BODY) req.destroy();
  });
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {}
    if (!valid(body)) {
      res.writeHead(400).end();
      return;
    }
    const now = Date.now();
    for (const [pid, p] of live) if (p.exp <= now) live.delete(pid);
    live.set(body.id, { streak: body.streak, state: body.state, night: !!body.night, exp: now + TTL_MS });
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(cohort(body.id, body.streak, now)));
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`presence on :${PORT}`));
module.exports = { isNear, cohort, valid, server, live, COHORT_MIN_ALIVE };
