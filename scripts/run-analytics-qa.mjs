#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { chromium } from 'playwright';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, '..');
const distDir = join(projectRoot, 'dist');

const pages = [
  { name: 'index', segments: ['index.html'] },
  { name: 'deals', segments: ['deals', 'index.html'] },
  { name: 'calculators', segments: ['calculators', 'index.html'] },
];

function assertBuildOutput() {
  if (!existsSync(distDir)) {
    console.error('dist directory not found. Run "npm run build" before executing QA checks.');
    process.exit(1);
  }
}

assertBuildOutput();

const browser = await chromium.launch();
const page = await browser.newPage();

const issues = [];
const results = [];

for (const { name, segments } of pages) {
  const filePath = join(distDir, ...segments);
  if (!existsSync(filePath)) {
    issues.push(`dist/${segments.join('/')} not found for ${name} page.`);
    continue;
  }

  const fileUrl = pathToFileURL(filePath).href;
  await page.goto(fileUrl, { waitUntil: 'load' });

  const scriptCount = await page.evaluate(() =>
    document.querySelectorAll('script[src*="plausible.io/js/script"]').length
  );

  results.push({ name, scriptCount });

  if (scriptCount > 1) {
    issues.push(`${name} page has ${scriptCount} Plausible scripts. Expected at most 1.`);
  }
}

await browser.close();

if (issues.length) {
  console.error('Analytics QA failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

for (const { name, scriptCount } of results) {
  console.log(`${name}: ${scriptCount} Plausible script tag(s)`);
}

console.log('Analytics QA passed.');
