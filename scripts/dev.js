'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const node = process.execPath;
const services = [
  { name: 'backend', args: [path.join(root, 'backend', 'server.js')], cwd: path.join(root, 'backend') },
  { name: 'frontend', args: [path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '0.0.0.0'], cwd: path.join(root, 'frontend') }
];

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

for (const service of services) {
  const child = spawn(node, service.args, { cwd: service.cwd, stdio: 'inherit', env: process.env });
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
