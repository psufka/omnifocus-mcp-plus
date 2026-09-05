import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageInfo = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const VERSION: string = packageInfo.version;
export function buildInfo() {
  let build: Record<string, unknown> = { commit: null, buildId: null, dirty: null };
  try { build = JSON.parse(readFileSync(new URL('../build-info.json', import.meta.url), 'utf8')); } catch { /* source/test execution */ }
  return { ...build, version: VERSION, nodeVersion: process.version, executable: realpathSync(process.execPath),
    serverPath: fileURLToPath(new URL('../server.js', import.meta.url)), platform: process.platform };
}
