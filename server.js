#!/usr/bin/env node
// Приём пингов. Map в памяти, TTL 120 секунд, ни базы, ни диска.
'use strict';
const http = require('http');

const PORT = Number(process.env.PORT) || 8787;
const TTL_MS = 120_000;
const MAX_BODY = 1024;

const live = new Map();

// Полоса ±25%, но не уже ±3 дней.
function range(streak) {
  return {
    lo: Math.min(streak - 3, Math.floor(streak * 0.75)),
    hi: Math.max(streak + 3, Math.ceil(streak * 1.25)),
  };
}

function cohort(id, streak, now, peers = live) {
  const { lo, hi } = range(streak);
  let near = 0;
  let limited = 0;
  for (const [pid, p] of peers) {
    if (pid === id || p.exp <= now) continue;
    if (p.streak < lo || p.streak > hi) continue;
    near++;
    if (p.state === 'limit') limited++;
  }
  return { near, limited };
}

function valid(b) {
  return b
    && typeof b.id === 'string' && /^[0-9a-f]{32}$/.test(b.id)
    && Number.isInteger(b.streak) && b.streak >= 0 && b.streak < 100_000
    && (b.state === 'work' || b.state === 'limit');
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
    live.set(body.id, { streak: body.streak, state: body.state, exp: now + TTL_MS });
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(cohort(body.id, body.streak, now)));
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`presence on :${PORT}`));
module.exports = { range, cohort, valid, server, live };
