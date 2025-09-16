#!/usr/bin/env node
import { existsSync, readdirSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(currentDir, '..', 'dist');

if (!existsSync(distDir)) {
  console.error('dist directory not found. Did you run "npm run build"?');
  process.exit(1);
}

const mirrorDir = join(distDir, 'calc-hub');
rmSync(mirrorDir, { recursive: true, force: true });
mkdirSync(mirrorDir, { recursive: true });

for (const entry of readdirSync(distDir)) {
  if (entry === 'calc-hub') {
    continue;
  }
  const sourcePath = join(distDir, entry);
  const targetPath = join(mirrorDir, entry);
  cpSync(sourcePath, targetPath, { recursive: true });
}

console.log('Prepared dist/calc-hub mirror for Lighthouse static hosting.');
