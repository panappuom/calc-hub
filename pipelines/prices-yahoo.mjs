import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { normalizeTitle, ACCESSORY_RE } from './normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const outPath = path.join(rootDir, 'public', 'data', 'prices', 'today.yahoo.json');
const SD128_CAPACITY_RE = /(128\s?GB|128G)\b/i;

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
  const skipReasons = {
    price_null: 0,
    filter_mismatch: 0,
    brand_mismatch: 0,
    capacity_mismatch: 0,
    accessory: 0,
    dup_normalized: 0,
    out_of_range: 0,
    parse_error: 0
  };
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

      let hasFilterMismatch = false;
      let hasOutOfRange = false;
      const normalizedMap = new Map();
      for (const it of hits) {
        const rawTitle = it.name || '';
        const title = rawTitle.toLowerCase();
        if (sku.filters && sku.filters.some(f => !title.includes(f.toLowerCase()))) {
          hasFilterMismatch = true;
          skipReasons.filter_mismatch++;
          continue;
        }
        if (sku.id === 'sd_128') {
          if (!SD128_CAPACITY_RE.test(title)) {
            skipReasons.capacity_mismatch++;
            continue;
          }
          if (ACCESSORY_RE.test(title)) {
            skipReasons.accessory++;
            continue;
          }
        }
        const price = Number(it.price);
        if ((sku.minPrice && price < sku.minPrice) || (sku.maxPrice && price > sku.maxPrice)) {
          hasOutOfRange = true;
          skipReasons.out_of_range++;
          continue;
        }
        const norm = normalizeTitle(rawTitle);
        const brandMatch = sku.brandHints && sku.brandHints.some(b => title.includes(b.toLowerCase()));
        const pointRate = Number(it.point?.amount) || Number(it.point) || 0;
        const item = {
          title: it.name,
          shopName: it.seller?.name,
          itemUrl: it.url,
          price,
          pointRate,
          imageUrl: it.image?.small || it.image?.medium || it.image,
          itemCode: it.code,
          brandMatch,
          norm
        };
        const eff = price - (price * pointRate) / 100;
        if (normalizedMap.has(norm)) {
          const prev = normalizedMap.get(norm);
          const prevEff = prev.price - (prev.price * prev.pointRate) / 100;
          skipReasons.dup_normalized++;
          if (eff < prevEff) {
            normalizedMap.set(norm, item);
          }
        } else {
          normalizedMap.set(norm, item);
        }
      }
      const list = Array.from(normalizedMap.values());
      list.sort(
        (a, b) =>
          b.brandMatch - a.brandMatch ||
          (a.price - (a.price * a.pointRate) / 100) -
            (b.price - (b.price * b.pointRate) / 100)
      );
      const deduped = [];
      const seenNorms = new Set();
      for (const it of list) {
        if (seenNorms.has(it.norm)) {
          skipReasons.dup_normalized++;
          continue;
        }
        seenNorms.add(it.norm);
        deduped.push(it);
      }
      const best = deduped[0];
      if (best) {
        successCount++;
      } else {
        let reason = 'price_null';
        if (hasFilterMismatch) reason = 'filter_mismatch';
        else if (hasOutOfRange) reason = 'out_of_range';
        skipReasons[reason]++;
      }
      items.push({
        skuId: sku.id,
        bestPrice: best?.price ?? null,
        bestShop: best?.shopName ?? null,
        list: deduped.map(({ brandMatch, norm, ...rest }) => rest)
      });
    } catch (e) {
      console.error('[yahoo] sku failed', sku.id, e);
      items.push({ skuId: sku.id, bestPrice: null, bestShop: null, list: [] });
      skipReasons.parse_error++;
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
    const validated = items.filter(it => typeof it.bestPrice === 'number').length;
    const skipped = items.length - validated;
    console.log(
      `[yahoo] validated ${validated}, skipped ${skipped} (price_null:${skipReasons.price_null}, filter_mismatch:${skipReasons.filter_mismatch}, brand_mismatch:${skipReasons.brand_mismatch}, capacity_mismatch:${skipReasons.capacity_mismatch}, accessory:${skipReasons.accessory}, dup_normalized:${skipReasons.dup_normalized}, out_of_range:${skipReasons.out_of_range}, parse_error:${skipReasons.parse_error})`
    );
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
