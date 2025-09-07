import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const outPath = path.join(rootDir, 'src', 'data', 'prices', 'yahoo.json');

async function fetchJsonWithRetry(url) {
  let delay = 500;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function loadPrev() {
  try {
    const raw = await fs.readFile(outPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function run() {
  const appId = process.env.YAHOO_APP_ID;
  let skus = [];
  try {
    const raw = await fs.readFile(skuPath, 'utf-8');
    skus = JSON.parse(raw);
  } catch (e) {
    console.error('[prices] failed to read skus.json', e);
    return;
  }

  if (!appId) {
    console.warn('[prices] YAHOO_APP_ID is missing');
    const prev = (await loadPrev()) ?? { updatedAt: new Date().toISOString(), items: [], status: 'fail' };
    prev.status = 'fail';
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(prev, null, 2));
    return;
  }

  const items = [];
  let success = 0;
  for (const sku of skus) {
    try {
      const url = new URL('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch');
      url.searchParams.set('appid', appId);
      url.searchParams.set('query', sku.q);
      url.searchParams.set('hits', '30');

      const data = await fetchJsonWithRetry(url);
      const candidates = data.hits || [];
      const filtered = candidates
        .filter(it => {
          const title = it.name?.toLowerCase() || '';
          if (sku.filters && sku.filters.some(f => !title.includes(f.toLowerCase()))) return false;
          if (sku.brandHints && !sku.brandHints.some(b => title.includes(b.toLowerCase()))) return false;
          return true;
        })
        .map(it => ({
          title: it.name,
          shopName: it.seller?.name,
          itemUrl: it.url,
          price: Number(it.price),
          pointRate: Number(it.point?.pointRate) || 0,
        }));
      filtered.sort((a, b) => (a.price - (a.price * a.pointRate) / 100) - (b.price - (b.price * b.pointRate) / 100));
      const best = filtered[0];
      if (best) success++;
      items.push({
        skuId: sku.id,
        bestPrice: best?.price ?? null,
        bestShop: best?.shopName ?? null,
        list: filtered,
      });
    } catch (e) {
      console.error('[prices] yahoo sku failed', sku.id, e);
      items.push({ skuId: sku.id, bestPrice: null, bestShop: null, list: [] });
    }
  }

  let status = 'ok';
  if (success === 0) status = 'fail';
  else if (success < skus.length) status = 'partial';

  let out = { updatedAt: new Date().toISOString(), items, status };
  if (status === 'fail') {
    const prev = await loadPrev();
    if (prev) {
      out = { ...prev, status };
    }
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log('[prices] wrote', outPath);
}
