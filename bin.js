#!/usr/bin/env node
// npx cc-presence [install|start|stop|status|uninstall]
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const HOME = os.homedir();
const DIR = path.join(HOME, '.claude', 'presence');
const BIN = path.join(DIR, 'bin');
const PID = path.join(DIR, 'pingd.pid');
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const RUNTIME = ['statusline.js', 'pingd.js', 'dump.js'];
const CMD = `node ${path.join(BIN, 'statusline.js')}`;

// npx распаковывает пакет во временный кэш, поэтому рантайм копируем к себе.
function copyRuntime() {
  fs.mkdirSync(BIN, { recursive: true });
  for (const f of RUNTIME) fs.copyFileSync(path.join(__dirname, f), path.join(BIN, f));
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(s) {
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.bak`);
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, `${JSON.stringify(s, null, 2)}\n`);
}

function running() {
  try {
    process.kill(Number(fs.readFileSync(PID, 'utf8')), 0);
    return Number(fs.readFileSync(PID, 'utf8'));
  } catch {
    return 0;
  }
}

function start() {
  if (running()) return console.log('пингер уже работает');
  const child = spawn(process.execPath, [path.join(BIN, 'pingd.js')], {
    detached: true, stdio: 'ignore', env: process.env,
  });
  child.unref();
  fs.writeFileSync(PID, String(child.pid));
  console.log(`пингер запущен (pid ${child.pid})`);
}

function stop() {
  const pid = running();
  if (!pid) return console.log('пингер не работает');
  process.kill(pid);
  fs.rmSync(PID, { force: true });
  console.log('пингер остановлен');
}

function install() {
  copyRuntime();
  const s = readSettings();
  const busy = s.statusLine && s.statusLine.command && s.statusLine.command !== CMD;
  if (busy) {
    console.log('\nstatusLine уже занят — свой не трогаю. Допиши в конец своего скрипта:\n');
    console.log(`  presence=$(printf '%s' "$input" | ${CMD} 2>/dev/null)`);
    console.log('  [ -n "$presence" ] && printf " | %s" "$presence"\n');
  } else {
    s.statusLine = { type: 'command', command: CMD };
    writeSettings(s);
    console.log('statusLine прописан в ~/.claude/settings.json');
  }
  start();
  console.log(`\nС машины уходит ровно это: { id: <случайные 16 байт>, streak, state, night }.
Ни промптов, ни путей, ни имён репозиториев, ни моделей, ни времени — только эти четыре поля.
Сервер: ${process.env.PRESENCE_SERVER || 'https://presence.mybrocade.ru'} (свой — переменной PRESENCE_SERVER).
Снести целиком: npx cc-presence uninstall\n`);
}

function status() {
  const pid = running();
  console.log(`пингер: ${pid ? `работает (pid ${pid})` : 'не работает'}`);
  console.log(`statusLine: ${readSettings().statusLine?.command || 'не настроен'}`);
  try {
    console.log(`строка: ${fs.readFileSync(path.join(DIR, 'cohort.json'), 'utf8')}`);
  } catch {
    console.log('строка: ещё нет данных');
  }
}

function uninstall() {
  stop();
  const s = readSettings();
  if (s.statusLine && s.statusLine.command === CMD) {
    delete s.statusLine;
    writeSettings(s);
    console.log('statusLine убран');
  }
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('~/.claude/presence удалён — не осталось ничего');
}

const cmds = { install, start, stop, status, uninstall };
(cmds[process.argv[2]] || install)();
