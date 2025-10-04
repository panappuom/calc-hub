#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { chromium } from 'playwright';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, '..');
const distDir = join(projectRoot, 'dist');
const reportPath = join(projectRoot, 'qa-deals-report.md');

function ensureBuildOutput() {
  if (!existsSync(distDir)) {
    console.error('dist directory not found. Run "npm run build" before executing QA checks.');
    process.exit(1);
  }

  const dealsPath = join(distDir, 'deals', 'index.html');
  if (!existsSync(dealsPath)) {
    console.error('dist/deals/index.html not found. Ensure the deals page is part of the build output.');
    process.exit(1);
  }

  return dealsPath;
}

function formatIssues(title, issues) {
  if (!issues.length) {
    return `- ${title}: ✅`;
  }
  const lines = [`- ${title}: ❌`];
  for (const issue of issues) {
    lines.push(`  - ${issue}`);
  }
  return lines.join('\n');
}

function writeReport(result) {
  const lines = [
    '# /deals/ QA report',
    '',
    '## Checks',
    formatIssues('rel attribute on affiliate links', result.relIssues),
    formatIssues('Affiliate link href format', result.hrefIssues),
    formatIssues('Structured data schema', result.schemaIssues),
    formatIssues('Analytics attributes and tracking', result.analyticsIssues),
    '',
    '## Metrics',
    `- deal card count: ${result.dealCardCount}`,
    `- schema item count: ${result.schemaItemCount}`,
  ];

  if (result.schemaSample) {
    lines.push('', '## Schema summary', '```json', result.schemaSample, '```');
  }

  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
}

function clearReport() {
  if (existsSync(reportPath)) {
    rmSync(reportPath);
  }
}

const dealsPath = ensureBuildOutput();

const browser = await chromium.launch();
const page = await browser.newPage();

const fileUrl = pathToFileURL(dealsPath).href;
await page.goto(fileUrl, { waitUntil: 'load' });

const evaluation = await page.evaluate(() => {
  const relIssues = [];
  const hrefIssues = [];
  const schemaIssues = [];
  const analyticsIssues = [];

  const dealLinks = Array.from(document.querySelectorAll('a.deal-card'));

  for (const link of dealLinks) {
    const rel = (link.getAttribute('rel') || '').trim();
    const tokens = rel.split(/\s+/).filter(Boolean);
    const expected = ['sponsored', 'noopener'];
    for (const token of expected) {
      if (!tokens.includes(token)) {
        relIssues.push(`Missing "${token}" on link with text "${link.textContent?.trim() || ''}".`);
      }
    }

    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) {
      hrefIssues.push(`Expected absolute URL for deal link but received "${href}".`);
    }

    const analyticsName = link.getAttribute('data-analytics') || '';
    if (analyticsName !== 'deal_click') {
      analyticsIssues.push('Deal link is missing data-analytics="deal_click" attribute.');
    }
    const payload = link.getAttribute('data-analytics-payload') || '';
    if (!payload) {
      analyticsIssues.push('Deal link is missing data-analytics-payload attribute.');
    }
  }

  let schemaItemCount = 0;
  let schemaSample = '';

  const schemaScript = document.querySelector('script[type="application/ld+json"][data-schema="deal-list"]')
    || document.querySelector('script[type="application/ld+json"]');

  if (!schemaScript) {
    schemaIssues.push('Structured data script tag not found.');
  } else {
    const raw = schemaScript.textContent || '';
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') {
        schemaIssues.push('Structured data payload is not an object.');
      } else {
        if (data['@type'] !== 'ItemList') {
          schemaIssues.push(`Expected schema @type ItemList but received "${data['@type'] ?? ''}".`);
        }
        if (typeof data.numberOfItems !== 'number') {
          schemaIssues.push('Schema numberOfItems must be a number.');
        }

        const elements = Array.isArray(data.itemListElement) ? data.itemListElement : [];
        schemaItemCount = elements.length;
        if (!elements.length) {
          schemaIssues.push('Schema itemListElement must be a non-empty array.');
        }

        elements.forEach((element, index) => {
          if (!element || typeof element !== 'object') {
            schemaIssues.push(`itemListElement[${index}] is not an object.`);
            return;
          }
          if (element['@type'] !== 'ListItem') {
            schemaIssues.push(`itemListElement[${index}] @type should be ListItem.`);
          }
          if (typeof element.position !== 'number') {
            schemaIssues.push(`itemListElement[${index}] is missing numeric position.`);
          }
          if (!element.url || typeof element.url !== 'string') {
            schemaIssues.push(`itemListElement[${index}] url is missing.`);
          }
          if (!element.name || typeof element.name !== 'string') {
            schemaIssues.push(`itemListElement[${index}] name is missing.`);
          }
        });

        schemaSample = JSON.stringify({
          '@type': data['@type'],
          numberOfItems: data.numberOfItems,
          firstItem: elements[0] ?? null,
        }, null, 2);
      }
    } catch (error) {
      schemaIssues.push(`Failed to parse structured data JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const plausibleCalls = [];
  window.plausible = (...args) => {
    plausibleCalls.push(args);
  };

  const firstLink = dealLinks[0];
  if (firstLink) {
    firstLink.addEventListener('click', (event) => event.preventDefault(), { once: true });
    firstLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    if (!plausibleCalls.length) {
      analyticsIssues.push('window.plausible was not called when clicking the first deal card.');
    }
  } else {
    analyticsIssues.push('No deal links found for analytics verification.');
  }

  return {
    relIssues,
    hrefIssues,
    schemaIssues,
    analyticsIssues,
    dealCardCount: dealLinks.length,
    schemaItemCount,
    schemaSample,
  };
});

await browser.close();

const hasIssues = evaluation.relIssues.length || evaluation.hrefIssues.length || evaluation.schemaIssues.length || evaluation.analyticsIssues.length;

if (hasIssues) {
  writeReport(evaluation);
  console.error('QA checks failed. See qa-deals-report.md for details.');
  console.error(readFileSync(reportPath, 'utf8'));
  process.exit(1);
}

clearReport();
console.log('/deals/ QA checks passed.');
