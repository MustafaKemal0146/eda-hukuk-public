// CI betikleri için ortak yardımcılar: repo kökü, git ile izlenen dosyalar, package.json okuma.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

export type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/** Git'in izlediği ve henüz eklenmemiş (yoksayılmayan) dosyalar; kök göreli. */
export function listFiles(root: string = REPO_ROOT): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  // Silinmiş ama henüz sahnelenmemiş dosyalar listede kalır; yalnız diskte olanlar döner.
  return out.split('\0').filter((f) => f.length > 0 && existsSync(join(root, f)));
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function workspacePackageFiles(root: string = REPO_ROOT): string[] {
  return listFiles(root).filter(
    (f) => f.endsWith('package.json') && !f.includes('node_modules/') && !f.startsWith('plans/'),
  );
}

export function report(name: string, errors: string[]): void {
  if (errors.length === 0) {
    console.log(`${name}: 0 ihlal`);
    return;
  }
  for (const e of errors) console.error(`${name}: ${e}`);
  console.error(`${name}: ${errors.length} ihlal`);
  process.exitCode = 1;
}
