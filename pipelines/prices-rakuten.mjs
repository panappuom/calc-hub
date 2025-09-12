import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { normalizeTitle, ACCESSORY_RE } from './normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const outPath = path.join(rootDir, 'public', 'data', 'prices', 'today.rakuten.json');
const SD128_CAPACITY_RE = /(128\s?GB|128G)\b/i;

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
    console.warn('[rakuten] RAKUTEN_APP_ID is missing');
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
      const url = new URL('https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601');
      url.searchParams.set('format', 'json');
      url.searchParams.set('applicationId', appId);
      url.searchParams.set('keyword', sku.q);
      url.searchParams.set('hits', '30');

      const res = await fetch(url);
      const data = await res.json();
      const candidates = (data.Items || []).map(it => it.Item);

      let hasFilterMismatch = false;
      let hasOutOfRange = false;
      const normalizedMap = new Map();
      for (const it of candidates) {
        const rawTitle = it.itemName || '';
        const title = rawTitle.toLowerCase();
        const caption = it.itemCaption?.toLowerCase() || '';
        const text = `${title} ${caption}`;
        if (sku.filters && sku.filters.some(f => !title.includes(f.toLowerCase()))) {
          hasFilterMismatch = true;
          skipReasons.filter_mismatch++;
          continue;
        }
        if (sku.id === 'sd_128') {
          if (!SD128_CAPACITY_RE.test(text)) {
            skipReasons.capacity_mismatch++;
            continue;
          }
          if (ACCESSORY_RE.test(text)) {
            skipReasons.accessory++;
            continue;
          }
        }
        const price = Number(it.itemPrice);
        if ((sku.minPrice && price < sku.minPrice) || (sku.maxPrice && price > sku.maxPrice)) {
          hasOutOfRange = true;
          continue;
        }
        const norm = normalizeTitle(rawTitle);
        const brandMatch = sku.brandHints && sku.brandHints.some(b => title.includes(b.toLowerCase()));
        const pointRate = Number(it.pointRate) || 0;
        const item = {
          title: it.itemName,
          shopName: it.shopName,
          itemUrl: it.itemUrl,
          price,
          pointRate,
          imageUrl: it.mediumImageUrls?.[0]?.imageUrl,
          itemCode: it.itemCode,
          brandMatch,
          norm
        };
        const eff = price - (price * pointRate) / 100;
        const key = `${norm}__${it.shopName}`;
        if (normalizedMap.has(key)) {
          const prev = normalizedMap.get(key);
          const prevEff = prev.price - (prev.price * prev.pointRate) / 100;
          skipReasons.dup_normalized++;
          if (eff < prevEff) {
            normalizedMap.set(key, item);
          }
        } else {
          normalizedMap.set(key, item);
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
      const seen = new Set();
      for (const it of list) {
        const key = `${it.norm}__${it.shopName}`;
        if (seen.has(key)) continue;
        seen.add(key);
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
      console.error('[rakuten] sku failed', sku.id, e);
      items.push({ skuId: sku.id, bestPrice: null, bestShop: null, list: [] });
      skipReasons.parse_error++;
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
    return;
  }

  const status = successCount === skus.length ? 'ok' : 'partial';
  const out = { updatedAt: new Date().toISOString(), items, sourceStatus: { rakuten: status } };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log('[rakuten] wrote', outPath);

  const validated = items.filter(it => typeof it.bestPrice === 'number').length;
  const skipped = items.length - validated;
  console.log(
    `[rakuten] validated ${validated}, skipped ${skipped} (price_null:${skipReasons.price_null}, filter_mismatch:${skipReasons.filter_mismatch}, brand_mismatch:${skipReasons.brand_mismatch}, capacity_mismatch:${skipReasons.capacity_mismatch}, accessory:${skipReasons.accessory}, dup_normalized:${skipReasons.dup_normalized}, out_of_range:${skipReasons.out_of_range}, parse_error:${skipReasons.parse_error})`
  );
}
