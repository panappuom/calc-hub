#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function runPlaywrightCommand(args) {
  const result = spawnSync(npxCommand, ['playwright', ...args], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Failed to run playwright ${args.join(' ')}:`, result.error);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

if (process.platform === 'linux') {
  runPlaywrightCommand(['install-deps', 'chromium']);
}

runPlaywrightCommand(['install', 'chromium']);
