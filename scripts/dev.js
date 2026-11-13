'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';
const services = [
  { name: 'backend', args: ['start'], cwd: path.join(root, 'backend') },
  { name: 'frontend', args: ['run', 'dev'], cwd: path.join(root, 'frontend') }
];

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

for (const service of services) {
  const child = spawn(npm, service.args, {
    cwd: service.cwd,
    stdio: 'inherit',
    shell,
    env: process.env
  });
  children.push(child);
  child.on('error', (error) => {
    process.stderr.write('[dev] ' + service.name + ' failed to start: ' + error.message + '\n');
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    const exitCode = code === null ? 1 : code;
    process.stderr.write('[dev] ' + service.name + ' stopped (' + (signal || exitCode) + '). Stopping both services.\n');
    stopAll(exitCode);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
