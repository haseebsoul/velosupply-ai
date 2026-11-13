import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'frontend', 'src');
const allowed = path.join(sourceRoot, 'styles', 'tokens.css');
const extensions = new Set(['.css', '.ts', '.tsx', '.js', '.jsx']);
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(file);
      continue;
    }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue;
    if (path.resolve(file) === path.resolve(allowed)) continue;
    const source = await readFile(file, 'utf8');
    const pattern = /#[0-9a-fA-F]{3,8}\b/g;
    let match;
    while ((match = pattern.exec(source))) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({ file: path.relative(root, file), line, value: match[0] });
    }
  }
}

await walk(sourceRoot);
if (violations.length) {
  for (const violation of violations) {
    process.stderr.write(violation.file + ':' + violation.line + ' contains ' + violation.value + '\n');
  }
  process.stderr.write('Use the shared palette in frontend/src/styles/tokens.css.\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Hex-color check passed. All frontend hex values are centralized in styles/tokens.css.\n');
}
