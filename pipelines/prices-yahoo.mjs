import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const outPath = path.join(rootDir, 'public', 'data', 'prices', 'today.yahoo.json');

export async function run() {
  const appId = process.env.YAHOO_APP_ID;
  const present = Boolean(appId);
  console.log(`[yahoo] appId present=${present}`);
  if (!present) {
    console.log('[yahoo] skip: appId missing');
    try {
      await fs.unlink(outPath);
      console.log('[yahoo] removed', outPath);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn('[yahoo] failed to remove output', e);
      }
    }
    return;
  }

  let skus = [];
  try {
    const raw = await fs.readFile(skuPath, 'utf-8');
    skus = JSON.parse(raw);
  } catch (e) {
    console.error('[yahoo] failed to read skus.json', e);
    return;
  }

  const items = [];
  let successCount = 0;
  for (const sku of skus) {
    try {
      const url = new URL('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch');
      url.searchParams.set('appid', appId);
      url.searchParams.set('query', sku.q);
      url.searchParams.set('hits', '20');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const hits = data.hits || data.Items || data.items || [];
      const list = hits.map(it => ({
        title: it.name,
        shopName: it.seller?.name,
        itemUrl: it.url,
        price: Number(it.price) || null,
        pointRate: Number(it.point?.amount) || Number(it.point) || 0,
        imageUrl: it.image?.small || it.image?.medium || it.image,
        itemCode: it.code
      })).filter(it => typeof it.price === 'number');
      list.sort((a, b) => a.price - b.price);
      const best = list[0];
      if (best) successCount++;
      items.push({ skuId: sku.id, bestPrice: best?.price ?? null, bestShop: best?.shopName ?? null, list });
    } catch (e) {
      console.error('[yahoo] sku failed', sku.id, e);
      items.push({ skuId: sku.id, bestPrice: null, bestShop: null, list: [] });
    }
  }
  if (successCount === 0) {
    console.warn('[yahoo] all fetches failed, keep previous data');
    let out = { updatedAt: new Date().toISOString(), items: [] };
    try {
      const raw = await fs.readFile(outPath, 'utf-8');
      out = JSON.parse(raw);
    } catch {}
    out.sourceStatus = { ...(out.sourceStatus || {}), yahoo: 'fail' };
    try {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, JSON.stringify(out, null, 2));
    } catch (e) {
      console.warn('[yahoo] failed to write output', e);
    }
    return;
  }

  const status = successCount === skus.length ? 'ok' : 'partial';
  const out = { updatedAt: new Date().toISOString(), items, sourceStatus: { yahoo: status } };
  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(out, null, 2));
    console.log('[yahoo] wrote', outPath);
    console.log(`[yahoo] items: ${items.length}`);
  } catch (e) {
    console.error('[yahoo] failed to write output', e);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
