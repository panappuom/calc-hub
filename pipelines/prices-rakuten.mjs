import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const outPath = path.join(rootDir, 'public', 'data', 'prices', 'today.json');
const historyDir = path.join(rootDir, 'data', 'price-history');
const publicHistoryDir = path.join(rootDir, 'public', 'data', 'price-history');

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
export const HISTORY_COMMIT_MESSAGE = 'chore(history): update prices [skip ci]';
const DUMMY_PRICE = 12345;

async function writeHistory(items, { force = false } = {}) {
  try {
    await fs.mkdir(historyDir, { recursive: true });
    for (const item of items) {
      if (!force && typeof item.bestPrice !== 'number') continue;
      const histFile = path.join(historyDir, `${item.skuId}.json`);
      let hist = [];
      try {
        const raw = await fs.readFile(histFile, 'utf-8');
        hist = JSON.parse(raw).filter(h => typeof h.price === 'number');
      } catch {}

      let price;
      if (typeof item.bestPrice === 'number') {
        price = item.bestPrice;
      } else {
        const last = [...hist].reverse().find(h => typeof h.price === 'number');
        price = last ? last.price : DUMMY_PRICE;
      }

      const idx = hist.findIndex(h => h.date === today);
      if (idx >= 0) {
        hist[idx].price = price;
      } else {
        hist.push({ date: today, price });
      }
      hist.sort((a, b) => a.date.localeCompare(b.date));
      if (hist.length > 30) hist = hist.slice(-30);
      await fs.writeFile(histFile, JSON.stringify(hist, null, 2));
    }
    await fs.mkdir(publicHistoryDir, { recursive: true });
    await fs.cp(historyDir, publicHistoryDir, { recursive: true });
  } catch (e) {
    console.warn('[rakuten] failed to update history', e);
  }
}

export async function run() {
  const appId = process.env.RAKUTEN_APP_ID;
  console.log(`[rakuten] appId: ${appId ? 'detected' : 'missing'}`);
  let skus = [];
  try {
    const raw = await fs.readFile(skuPath, 'utf-8');
    skus = JSON.parse(raw);
  } catch (e) {
    console.error('[rakuten] failed to read skus.json', e);
    return;
  }
  if (!appId) {
    console.warn('[rakuten] RAKUTEN_APP_ID is missing, insert dummy history');
    const dummy = skus.map(s => ({ skuId: s.id, bestPrice: null }));
    await writeHistory(dummy, { force: true });
    return;
  }

  const items = [];
  let successCount = 0;
  for (const sku of skus) {
    try {
      const url = new URL('https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601');
      url.searchParams.set('format', 'json');
      url.searchParams.set('applicationId', appId);
      url.searchParams.set('keyword', sku.q);
      url.searchParams.set('hits', '30');

      const res = await fetch(url);
      const data = await res.json();
      const candidates = (data.Items || []).map(it => it.Item);
      const filtered = candidates.filter(it => {
        const title = it.itemName?.toLowerCase() || '';
        if (sku.filters && sku.filters.some(f => !title.includes(f.toLowerCase()))) return false;
        if (sku.brandHints && !sku.brandHints.some(b => title.includes(b.toLowerCase()))) return false;
        return true;
      }).map(it => ({
        title: it.itemName,
        shopName: it.shopName,
        itemUrl: it.itemUrl,
        price: Number(it.itemPrice),
        pointRate: Number(it.pointRate) || 0,
        imageUrl: it.mediumImageUrls?.[0]?.imageUrl,
        itemCode: it.itemCode
      }));
      filtered.sort((a, b) => (a.price - a.price * a.pointRate / 100) - (b.price - b.price * b.pointRate / 100));
      const best = filtered[0];
      if (best) successCount++;
      items.push({
        skuId: sku.id,
        bestPrice: best?.price ?? null,
        bestShop: best?.shopName ?? null,
        list: filtered
      });
    } catch (e) {
      console.error('[rakuten] sku failed', sku.id, e);
      items.push({ skuId: sku.id, bestPrice: null, bestShop: null, list: [] });
    }
  }

  if (successCount === 0) {
    console.warn('[rakuten] all fetches failed, keep previous data');
    let out = { updatedAt: new Date().toISOString(), items: [] };
    try {
      const raw = await fs.readFile(outPath, 'utf-8');
      out = JSON.parse(raw);
    } catch {}
    out.sourceStatus = { ...(out.sourceStatus || {}), rakuten: 'fail' };
    try {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, JSON.stringify(out, null, 2));
    } catch (e) {
      console.warn('[rakuten] failed to write today.json', e);
    }
    try {
      await fs.mkdir(publicHistoryDir, { recursive: true });
      await fs.cp(historyDir, publicHistoryDir, { recursive: true });
    } catch (e) {
      console.warn('[rakuten] failed to mirror history', e);
    }
    return;
  }

  const status = successCount === skus.length ? 'ok' : 'partial';
  const out = { updatedAt: new Date().toISOString(), items, sourceStatus: { rakuten: status } };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log('[rakuten] wrote', outPath);

  const validated = items.filter(it => typeof it.bestPrice === 'number').length;
  const skipped = items.length - validated;
  console.log(`[rakuten] validated ${validated}, skipped ${skipped}`);

  await writeHistory(items);
}
