import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(moduleDir, '..');
const projectRoot = resolve(srcDir, '..');

const candidateFiles = [
  resolve(srcDir, 'data/deals.json'),
  resolve(srcDir, 'data/prices/today.json'),
  resolve(projectRoot, 'public/data/deals.json'),
  resolve(projectRoot, 'public/data/prices/today.json'),
];

async function readUpdatedAt(path) {
  try {
    const raw = await readFile(path, 'utf-8');
    const json = JSON.parse(raw);
    if (!json || typeof json.updatedAt !== 'string') {
      return null;
    }
    const date = new Date(json.updatedAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

function formatJst(date) {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
  const { year, month, day, hour, minute } = parts;
  return `${year}-${month}-${day} ${hour}:${minute} JST`;
}

export async function getLastUpdated() {
  const fallback = new Date();
  const dates = await Promise.all(candidateFiles.map(readUpdatedAt));
  const validDates = dates.filter(Boolean);
  const latest = [fallback, ...validDates].reduce((max, current) =>
    current && current > max ? current : max
  );
  return {
    date: latest,
    formatted: formatJst(latest),
  };
}
