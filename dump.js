#!/usr/bin/env node
// Отладка: повесить на statusLine на один рендер, посмотреть сырой stdin.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'presence');
try {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'stdin-dump.json'), fs.readFileSync(0, 'utf8'));
} catch {}
