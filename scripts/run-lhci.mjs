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
  const { allowFailure = false, ...spawnOptions } = options;

  const result = spawnSync(npxCommand, args, {
    stdio: 'inherit',
    ...spawnOptions,
  });

  if (result.error) {
    console.error(`Failed to run ${npxCommand} ${args.join(' ')}:`, result.error);
    process.exit(1);
  }

  if (!allowFailure && typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  return result;
}

let chromePath = process.env.CHROME_PATH;
let chromeSource = 'CHROME_PATH environment variable';

if (!chromePath) {
  try {
    const { chromium } = await import('playwright');
    chromePath = chromium.executablePath();
    chromeSource = 'Playwright';
  } catch (error) {
    console.error('Failed to resolve Chromium via Playwright:', error);
  }
}

if (!chromePath) {
  console.error('Could not determine the Chromium executable path.');
  process.exit(1);
}

console.log(`Using Chromium executable (${chromeSource}): ${chromePath}`);

const configPath = process.env.LHCI_CONFIG || '.lighthouserc.json';
const allowAssertFailure = process.env.ALLOW_ASSERT_FAILURE === '1';

const env = {
  ...process.env,
  CHROME_PATH: chromePath,
};

runNpx(['lhci', 'collect', `--config=${configPath}`], {
  env,
});

const assertResult = runNpx(['lhci', 'assert', `--config=${configPath}`], {
  env,
  allowFailure: allowAssertFailure,
});

if (allowAssertFailure && typeof assertResult.status === 'number' && assertResult.status !== 0) {
  console.warn('LHCI assertions failed but continuing due to ALLOW_ASSERT_FAILURE=1');
}
