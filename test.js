#!/usr/bin/env node
// Приёмка из ТЗ. node test.js
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { usedPct, render, lang } = require('./statusline.js');
const { streakFrom, daysFromStats } = require('./pingd.js');
const { isNear, cohort, valid, server, live } = require('./server.js');
const NOW = Date.parse('2026-09-07T12:00:00Z');
const DAY = 86_400_000;
const days = (...ts) => new Set(ts.map((t) => {
  const d = new Date(t);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}));

// --- rate_limits: все варианты имён + отсутствие
assert.equal(usedPct({ rate_limits: { five_hour: { used_percentage: 96 } } }), 96, 'реальное поле Claude Code');
assert.equal(usedPct({ rate_limits: { five_hour: { used_pct: 96 } } }), 96);
assert.equal(usedPct({ rate_limits: { fiveHour: { usedPct: 96 } } }), 96);
assert.equal(usedPct({ rate_limits: { five_hour: { utilization: 0.96 } } }), 96);
assert.equal(usedPct({ rate_limits: { five_hour: { used: 48, limit: 50 } } }), 96);
assert.equal(usedPct({}), null, 'нет rate_limits -> null, дальше work');
assert.equal(usedPct(null), null);

// --- рендер
const ru = { locale: 'ru' };
assert.equal(render({ streak: 70, near: 0, night: 0, limited: 0, ts: NOW }, NOW, ru), 'день 70', 'нули -> блоков нет');
assert.equal(render({ streak: 70, near: 9, night: 0, limited: 0, ts: NOW }, NOW, ru), 'день 70 · 9 в консоли');
assert.equal(render({ streak: 70, near: 9, night: 4, limited: 6, ts: NOW }, NOW, ru),
  'день 70 · 9 в консоли · 4 не спят · 6 ждут сброса');
assert.equal(render({ streak: 70, near: 9, night: 4, limited: 6, ts: NOW }, NOW),
  'day 70 · 9 online · 4 still up · 6 waiting it out', 'английский по умолчанию');
assert.equal(render({ streak: 70, near: 1, night: 1, limited: 1, ts: NOW }, NOW, ru),
  'день 70 · 1 в консоли · 1 не спит · 1 ждёт сброса', 'единственное число');
assert.equal(render({ streak: 70, near: 21, night: 21, limited: 21, ts: NOW }, NOW, ru),
  'день 70 · 21 в консоли · 21 не спит · 21 ждёт сброса', '21 тоже единственное');
assert.equal(render({ streak: 70, near: 11, night: 11, limited: 11, ts: NOW }, NOW, ru),
  'день 70 · 11 в консоли · 11 не спят · 11 ждут сброса', 'а 11 — множественное');
assert.equal(render({ streak: 70, near: 9, night: 0, limited: 6, ts: NOW }, NOW, ru),
  'день 70 · 9 в консоли · 6 ждут сброса', 'нулевая ночь выпадает из середины');
assert.equal(render({ streak: 70, near: 9, night: 4, limited: 6, ts: NOW - 6 * 60_000 }, NOW, ru), 'день 70', 'протух -> только стрик');
assert.equal(render(null, NOW), '', 'нет cohort.json -> пусто');
assert.equal(render({ near: 9 }, NOW), '');

assert.equal(lang({ LANG: 'ru_RU.UTF-8' }), 'ru');
assert.equal(lang({ LANG: 'en_US.UTF-8' }), 'en');
assert.equal(lang({}), 'en', 'без локали -> английский');
assert.equal(lang({ PRESENCE_LANG: 'ru', LANG: 'en_US.UTF-8' }), 'ru', 'явная переменная сильнее');

assert.equal(render({ streak: 70, near: 0, night: 0, limited: 6, ts: NOW }, NOW, { color: true, locale: 'ru' }),
  '\x1b[2mдень 70\x1b[0m · \x1b[33m6 ждут сброса\x1b[0m', 'цвет только в main');

// --- стрик
assert.equal(streakFrom(days(NOW, NOW - DAY, NOW - 2 * DAY), NOW), 3);
assert.equal(streakFrom(days(NOW - DAY, NOW - 2 * DAY), NOW), 2, 'поблажка: сегодня пусто -> считаем от вчера');
assert.equal(streakFrom(days(NOW - 2 * DAY), NOW), 0, 'разрыв в два дня -> стрик сгорел');
assert.equal(streakFrom(new Set(), NOW), 0);

// --- дни из stats-cache
const statsFile = path.join(os.tmpdir(), `presence-stats-${process.pid}.json`);
fs.writeFileSync(statsFile, JSON.stringify({ dailyActivity: [
  { date: '2026-09-06', messageCount: 10 },
  { date: '2026-09-05', messageCount: 3 },
  { date: '2026-09-04', messageCount: 0 },
  { date: 'мусор', messageCount: 5 },
] }));
assert.deepEqual([...daysFromStats(statsFile)].sort(), ['2026-09-05', '2026-09-06'], 'пустые дни и мусор отбрасываются');
assert.equal(streakFrom(daysFromStats(statsFile), Date.parse('2026-09-07T12:00:00Z')), 2, 'поблажка на сегодня');
assert.throws(() => daysFromStats(path.join(os.tmpdir(), 'нет-такого.json')), 'нет кэша -> fallback на mtime');
fs.rmSync(statsFile);

// --- когорта: симметрия
assert.ok(isNear(70, 60) && isNear(60, 70), 'близкие видят друг друга с обеих сторон');
assert.ok(isNear(36, 27) && isNear(27, 36), 'раньше 27 не видел 36 — теперь симметрично');
assert.ok(isNear(5, 2) && isNear(2, 5), 'на малых стриках работает окно ±3');
assert.ok(!isNear(70, 5) && !isNear(5, 70), 'далёкие не видят друг друга в обе стороны');
assert.ok(isNear(0, 3) && !isNear(0, 4), 'граница окна ±3');
const peers = new Map([
  ['a', { streak: 60, state: 'limit', night: true, exp: NOW + 1 }],
  ['b', { streak: 88, state: 'work', night: true, exp: NOW + 1 }],
  ['c', { streak: 5, state: 'limit', night: false, exp: NOW + 1 }],
  ['d', { streak: 70, state: 'limit', night: true, exp: NOW - 1 }],
  ['me', { streak: 70, state: 'work', night: false, exp: NOW + 1 }],
]);
// живых мало (< 20) — когорта не делится, видно всех
assert.deepEqual(cohort('me', 70, NOW, peers), { near: 3, night: 2, limited: 2 }, 'мало онлайн -> видно всех живых');

// а когда живых много, полоса включается
const many = new Map(peers);
for (let i = 0; i < 20; i++) {
  many.set(`e${i}`.padEnd(32, '0'), { streak: 200, state: 'work', night: false, exp: NOW + 1 });
}
assert.deepEqual(cohort('me', 70, NOW, many), { near: 2, night: 2, limited: 1 }, 'много онлайн -> только когорта');
assert.deepEqual(cohort('c', 5, NOW, many), { near: 0, night: 0, limited: 0 }, '5 не видит 70 и 200');

// --- валидация тела
assert.ok(valid({ id: 'a'.repeat(32), streak: 70, state: 'work' }));
assert.ok(!valid({ id: 'nope', streak: 70, state: 'work' }));
assert.ok(!valid({ id: 'a'.repeat(32), streak: -1, state: 'work' }));
assert.ok(!valid({ id: 'a'.repeat(32), streak: 70, state: 'idle' }));
assert.ok(valid({ id: 'a'.repeat(32), streak: 70, state: 'work', night: true }));
assert.ok(!valid({ id: 'a'.repeat(32), streak: 70, state: 'work', night: 'да' }), 'night только boolean');
assert.ok(!valid(undefined));

// --- statusline как процесс: битый stdin, чужой HOME
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-'));
const run = (stdin) => execFileSync(process.execPath, [path.join(__dirname, 'statusline.js')], {
  input: stdin, env: { ...process.env, HOME: home }, encoding: 'utf8',
});
assert.equal(run('не json'), '', 'битый JSON -> пусто, exit 0');
assert.equal(run('{}'), '', 'нет cohort.json -> пусто, exit 0');
const pdir = path.join(home, '.claude', 'presence');
fs.mkdirSync(pdir, { recursive: true });
fs.writeFileSync(path.join(pdir, 'cohort.json'), JSON.stringify({ streak: 70, near: 0, limited: 0, ts: Date.now() }));
assert.match(run('{"rate_limits":{"five_hour":{"used_percentage":99}}}'), /(день|day) 70/);
assert.equal(JSON.parse(fs.readFileSync(path.join(pdir, 'state.json'), 'utf8')).state, 'limit');
assert.match(run('{"rate_limits":{"five_hour":{"used_percentage":10}}}'), /(день|day) 70/);
assert.equal(JSON.parse(fs.readFileSync(path.join(pdir, 'state.json'), 'utf8')).state, 'work');

const t = [];
for (let i = 0; i < 20; i++) {
  const s = process.hrtime.bigint();
  run('{}');
  t.push(Number(process.hrtime.bigint() - s) / 1e6);
}
t.sort((a, b) => a - b);
const median = Math.round(t[10]);

// --- сервер: 404, 400, валидный ping, разрыв на большом теле
(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${url}/ping`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal((await fetch(`${url}/other`)).status, 404, 'чужой путь -> 404');
  assert.equal((await post('{')).status, 400, 'битый body -> 400');
  assert.equal((await post('{"id":"zz","streak":1,"state":"work"}')).status, 400);

  const me = 'b'.repeat(32);
  const peer = 'c'.repeat(32);
  await post(JSON.stringify({ id: peer, streak: 72, state: 'limit', night: true }));
  const res = await post(JSON.stringify({ id: me, streak: 70, state: 'work', night: false }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { near: 1, night: 1, limited: 1 });

  await assert.rejects(post('x'.repeat(2048)), 'body > 1 КБ -> разрыв');

  live.clear();
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(`ok — все ветки приёмки прошли; медиана рендера ${median} мс (20 прогонов, вместе со стартом node)`);
})();
