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
const LABEL = 'com.cc-presence.pingd';
const AGENT = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const UNIT = path.join(HOME, '.config', 'systemd', 'user', 'cc-presence.service');
const VBS = path.join(BIN, 'pingd-hidden.vbs');

function quiet(cmd, args) {
  try {
    require('child_process').execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Автозапуск: без него пингер не переживает перезагрузку и тул тихо умирает.
// process.execPath у Homebrew указывает в Cellar с версией: обновление
// Node молча ломает автозапуск. Предпочитаем стабильный симлинк.
function nodePath() {
  for (const c of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    try {
      if (fs.realpathSync(c) === fs.realpathSync(process.execPath)) return c;
    } catch {}
  }
  return process.execPath;
}

function serviceFile() {
  const node = nodePath();
  const pingd = path.join(BIN, 'pingd.js');
  const server = process.env.PRESENCE_SERVER;
  if (process.platform === 'darwin') {
    const env = server
      ? `  <key>EnvironmentVariables</key>\n  <dict><key>PRESENCE_SERVER</key><string>${server}</string></dict>\n`
      : '';
    return {
      kind: 'launchd',
      file: AGENT,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${node}</string><string>${pingd}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
${env}</dict>
</plist>
`,
    };
  }
  if (process.platform === 'win32') {
    // Задача планировщика запускает не node напрямую, а wscript:
    // иначе при каждом входе в систему мигало бы окно консоли.
    return {
      kind: 'schtasks',
      file: VBS,
      body: `CreateObject("WScript.Shell").Run ${node} ${pingd}, 0, False\r\n`,
    };
  }
  if (process.platform === 'linux') {
    return {
      kind: 'systemd',
      file: UNIT,
      body: `[Unit]
Description=cc-presence pinger

[Service]
ExecStart=${node} ${pingd}
${server ? `Environment=PRESENCE_SERVER=${server}\n` : ''}Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`,
    };
  }
  return null;
}

function installService() {
  const svc = serviceFile();
  if (!svc) return null;
  fs.mkdirSync(path.dirname(svc.file), { recursive: true });
  fs.writeFileSync(svc.file, svc.body);
  if (svc.kind === 'launchd') {
    quiet('launchctl', ['unload', svc.file]);
    return quiet('launchctl', ['load', '-w', svc.file]) ? svc.kind : null;
  }
  if (svc.kind === 'schtasks') {
    const ok = quiet('schtasks', ['/create', '/tn', 'cc-presence', '/tr',
      `wscript.exe "${svc.file}"`, '/sc', 'onlogon', '/f']);
    if (ok) quiet('schtasks', ['/run', '/tn', 'cc-presence']);
    return ok ? svc.kind : null;
  }
  quiet('systemctl', ['--user', 'daemon-reload']);
  return quiet('systemctl', ['--user', 'enable', '--now', 'cc-presence']) ? svc.kind : null;
}

function removeService() {
  const svc = serviceFile();
  if (!svc || !fs.existsSync(svc.file)) return false;
  if (svc.kind === 'launchd') quiet('launchctl', ['unload', '-w', svc.file]);
  else if (svc.kind === 'schtasks') quiet('schtasks', ['/delete', '/tn', 'cc-presence', '/f']);
  else {
    quiet('systemctl', ['--user', 'disable', '--now', 'cc-presence']);
    quiet('systemctl', ['--user', 'daemon-reload']);
  }
  fs.rmSync(svc.file, { force: true });
  return true;
}

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
  const kind = installService();
  if (kind) {
    fs.rmSync(PID, { force: true });
    return console.log(`пингер запущен и переживёт перезагрузку (${kind})`);
  }
  const child = spawn(process.execPath, [path.join(BIN, 'pingd.js')], {
    detached: true, stdio: 'ignore', env: process.env,
  });
  child.unref();
  fs.writeFileSync(PID, String(child.pid));
  console.log(`пингер запущен (pid ${child.pid})`);
}

function stop() {
  const hadService = removeService();
  const pid = running();
  if (pid) {
    process.kill(pid);
    fs.rmSync(PID, { force: true });
  }
  if (!hadService && !pid) return console.log('пингер не работает');
  console.log(hadService ? 'пингер остановлен, автозапуск снят' : 'пингер остановлен');
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
  const svc = serviceFile();
  const auto = svc && fs.existsSync(svc.file);
  let pid = running();
  if (!pid) {
    try {
      pid = Number(require('child_process')
        .execFileSync('pgrep', ['-f', path.join(BIN, 'pingd.js')], { encoding: 'utf8' })
        .trim().split('\n')[0]);
    } catch {}
  }
  console.log(`пингер: ${pid ? `работает (pid ${pid})` : 'не работает'}`);
  console.log(`автозапуск: ${auto ? `${svc.kind}, ${svc.file}` : 'нет'}`);
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
