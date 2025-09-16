#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, '..');

rmSync(join(projectRoot, '.lighthouseci'), { recursive: true, force: true });

function runNpx(args, options = {}) {
  const result = spawnSync(npxCommand, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    console.error(`Failed to run ${npxCommand} ${args.join(' ')}:`, result.error);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  return result;
}

const { chromium } = await import('playwright');
const chromePath = chromium.executablePath();

if (!chromePath) {
  console.error('Could not determine the Chromium executable path from Playwright.');
  process.exit(1);
}

console.log(`Using Chromium executable: ${chromePath}`);

const env = {
  ...process.env,
  CHROME_PATH: chromePath,
};

runNpx(['lhci', 'collect', '--config=.lighthouserc.json'], {
  env,
});

runNpx(['lhci', 'assert', '--config=.lighthouserc.json'], {
  env,
});
