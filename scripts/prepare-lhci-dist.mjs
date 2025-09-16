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

const baseSegment = 'calc-hub';
const mirrorDir = join(distDir, baseSegment);
const mirrorIndexPath = join(mirrorDir, 'index.html');
const rootIndexPath = join(distDir, 'index.html');

const mirrorHasIndex = existsSync(mirrorIndexPath);
const rootHasIndex = existsSync(rootIndexPath);

if (!mirrorHasIndex && !rootHasIndex) {
  console.error('No build output found in dist or dist/calc-hub. Did you run "npm run build"?');
  process.exit(1);
}

function toSet(values = []) {
  return new Set(values);
}

function removeEntries(dir, skip = new Set()) {
  if (!existsSync(dir)) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) {
      continue;
    }

    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

function copyEntries(sourceDir, targetDir, skip = new Set()) {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    if (skip.has(entry)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

if (mirrorHasIndex && !rootHasIndex) {
  removeEntries(distDir, toSet([baseSegment]));
  copyEntries(mirrorDir, distDir);
  console.log('Mirrored dist/calc-hub into dist root for Lighthouse static hosting.');
} else {
  removeEntries(mirrorDir);
  copyEntries(distDir, mirrorDir, toSet([baseSegment]));
  console.log('Prepared dist/calc-hub mirror for Lighthouse static hosting.');
}
