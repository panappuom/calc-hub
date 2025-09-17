#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, '..');

const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

function loadDefaultUrls(config) {
  return config?.ci?.collect?.url ?? [];
}

async function readConfig(configPath) {
  const content = await readFile(configPath, 'utf8');
  return JSON.parse(content);
}

function astroPathToUrl(relativePath) {
  if (!relativePath.endsWith('.astro')) {
    return null;
  }

  if (/[\[{]/.test(relativePath)) {
    return null;
  }

  const withoutExtension = relativePath.replace(/\.astro$/, '');

  if (withoutExtension === 'index') {
    return 'index.html';
  }

  if (withoutExtension.endsWith('/index')) {
    const base = withoutExtension.replace(/\/index$/, '');
    return base ? `${base}/index.html` : 'index.html';
  }

  return `${withoutExtension}/index.html`;
}

function collectChangedFiles(baseRef) {
  let diffOutput = '';

  const options = { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

  if (process.env.LHCI_DIFF_RANGE) {
    try {
      diffOutput = execSync(`git diff --name-only ${process.env.LHCI_DIFF_RANGE}`, options);
    } catch (error) {
      console.warn(`Failed to run git diff for LHCI_DIFF_RANGE: ${error.message}`);
      return [];
    }

    return diffOutput.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  const candidates = [baseRef, 'main', 'master'];
  const tried = new Set();
  let baseCommit = null;

  for (const candidate of candidates) {
    if (!candidate || tried.has(candidate)) {
      continue;
    }

    tried.add(candidate);

    try {
      baseCommit = execSync(`git merge-base HEAD ${candidate}`, options).trim();
      if (baseCommit) {
        break;
      }
    } catch (error) {
      // Try the next candidate.
    }
  }

  if (baseCommit) {
    diffOutput = execSync(`git diff --name-only ${baseCommit}`, options);
    return diffOutput.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  try {
    diffOutput = execSync('git diff --name-only HEAD^', options);
  } catch (error) {
    console.warn('Failed to determine git diff range; falling back to default URLs.');
    return [];
  }

  return diffOutput.split('\n').map((line) => line.trim()).filter(Boolean);
}

function shouldIgnoreFile(file) {
  const ext = extname(file).toLowerCase();

  if (DOCUMENTATION_EXTENSIONS.has(ext)) {
    return true;
  }

  if (file.startsWith('.github/')) {
    return true;
  }

  return false;
}

export async function generateLhciUrls() {
  const configEnvPath = process.env.LHCI_CONFIG;
  const configPath = configEnvPath
    ? isAbsolute(configEnvPath)
      ? configEnvPath
      : join(projectRoot, configEnvPath)
    : join(projectRoot, '.lighthouserc.json');
  let config;

  try {
    config = await readConfig(configPath);
  } catch (error) {
    console.warn(`Failed to read LHCI config at ${configPath}: ${error.message}`);
    config = {};
  }

  const defaultUrls = loadDefaultUrls(config);

  const baseRef = process.env.LHCI_BASE_REF || 'origin/main';
  const changedFiles = collectChangedFiles(baseRef);

  if (changedFiles.length === 0) {
    return defaultUrls;
  }

  const urls = new Set();
  let fallbackRequired = false;

  for (const file of changedFiles) {
    if (!existsSync(join(projectRoot, file))) {
      continue;
    }

    if (shouldIgnoreFile(file)) {
      continue;
    }

    if (file.startsWith('src/pages/')) {
      const relative = file.slice('src/pages/'.length);
      const url = astroPathToUrl(relative);
      if (url) {
        urls.add(url);
        continue;
      }

      fallbackRequired = true;
      break;
    }

    if (file.startsWith('public/')) {
      const relative = file.slice('public/'.length);
      if (relative.endsWith('.html')) {
        urls.add(relative);
        continue;
      }

      fallbackRequired = true;
      break;
    }

    fallbackRequired = true;
    break;
  }

  if (fallbackRequired || urls.size === 0) {
    return defaultUrls;
  }

  return [...urls];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const urls = await generateLhciUrls();
  for (const url of urls) {
    console.log(url);
  }
}
