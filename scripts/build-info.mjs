import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const hash = createHash('sha256');
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.name !== 'build-info.json') { hash.update(relative(dist, path)); hash.update(readFileSync(path)); }
  }
}
scan(dist);
let commit = null, dirty = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
  dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim() !== '';
} catch { /* published npm package need not have a .git directory */ }
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(dist, 'build-info.json'), JSON.stringify({ version, commit, dirty, buildId: hash.digest('hex') }, null, 2) + '\n');
