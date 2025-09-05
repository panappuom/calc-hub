import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const outPath = path.join(rootDir, 'src', 'data', 'prices', 'today.json');

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

  const out = { updatedAt: new Date().toISOString(), items };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log('[prices] wrote', outPath);
}
