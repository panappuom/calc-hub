import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const outPath = path.join(rootDir, 'src', 'data', 'prices', 'today.json');
const historyDir = path.join(rootDir, 'data', 'price-history');
const publicHistoryDir = path.join(rootDir, 'public', 'data', 'price-history');

export async function run() {
  const appId = process.env.RAKUTEN_APP_ID;
  if (!appId) {
    console.warn('[prices] RAKUTEN_APP_ID is missing');
    return;
  }
  let skus = [];
  try {
    const raw = await fs.readFile(skuPath, 'utf-8');
    skus = JSON.parse(raw);
  } catch (e) {
    console.error('[prices] failed to read skus.json', e);
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
      console.error('[prices] sku failed', sku.id, e);
      items.push({ skuId: sku.id, bestPrice: null, bestShop: null, list: [] });
    }
  }

  if (successCount === 0) {
    console.warn('[prices] all fetches failed, keep previous data');
    return;
  }

  const out = { updatedAt: new Date().toISOString(), items };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log('[prices] wrote', outPath);

  try {
    await fs.mkdir(historyDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    for (const item of items) {
      if (typeof item.bestPrice !== 'number') continue;
      const histFile = path.join(historyDir, `${item.skuId}.json`);
      let hist = [];
      try {
        const raw = await fs.readFile(histFile, 'utf-8');
        hist = JSON.parse(raw);
      } catch {}
      const idx = hist.findIndex(h => h.date === today);
      if (idx >= 0) {
        hist[idx].price = item.bestPrice;
      } else {
        hist.push({ date: today, price: item.bestPrice });
      }
      hist.sort((a, b) => a.date.localeCompare(b.date));
      if (hist.length > 30) hist = hist.slice(-30);
      await fs.writeFile(histFile, JSON.stringify(hist, null, 2));
    }
    await fs.mkdir(publicHistoryDir, { recursive: true });
    await fs.cp(historyDir, publicHistoryDir, { recursive: true });
  } catch (e) {
    console.warn('[prices] failed to update history', e);
  }
}
