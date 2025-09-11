import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const rakutenPath = path.join(rootDir, 'public', 'data', 'prices', 'today.rakuten.json');
const yahooPath = path.join(rootDir, 'public', 'data', 'prices', 'today.yahoo.json');
const publicOut = path.join(rootDir, 'public', 'data', 'prices', 'today.json');
const dataOut = path.join(rootDir, 'data', 'prices', 'today.json');
const historyDir = path.join(rootDir, 'data', 'price-history');
const publicHistoryDir = path.join(rootDir, 'public', 'data', 'price-history');
const publicBase = process.env.PUBLIC_BASE_URL || 'https://panappuom.github.io/calc-hub/';

// Generate today's date in JST for consistent history keys
const todayJst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });

async function readJson(p) {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeItems(...sources) {
  const map = new Map();
  for (const src of sources) {
    if (!src) continue;
    for (const it of src.items || []) {
      if (!map.has(it.skuId)) {
        map.set(it.skuId, { skuId: it.skuId, list: [] });
      }
      const target = map.get(it.skuId);
      if (Array.isArray(it.list)) {
        target.list.push(...it.list.filter(l => typeof l.price === 'number'));
      }
    }
  }
  const items = Array.from(map.values()).map(it => {
    it.list.sort((a, b) => a.price - b.price);
    const best = it.list[0];
    return {
      skuId: it.skuId,
      bestPrice: best?.price ?? null,
      bestShop: best?.shopName ?? null,
      list: it.list
    };
  });
  return items;
}

async function updateHistory(items) {
  try {
    await fs.mkdir(historyDir, { recursive: true });
    await fs.mkdir(publicHistoryDir, { recursive: true });
    for (const item of items) {
      const histFile = path.join(historyDir, `${item.skuId}.json`);
      const publicFile = path.join(publicHistoryDir, `${item.skuId}.json`);
      let hist = [];
      try {
        const url = new URL(`data/price-history/${item.skuId}.json`, publicBase);
        const res = await fetch(url);
        if (res.ok) {
          hist = (await res.json()).filter(h => typeof h.price === 'number');
          console.log('[merge] history: fetched from public URL', url.toString());
        } else if (res.status === 404) {
          console.log('[merge] history: fetched from public URL', url.toString(), '(new file)');
        } else {
          throw new Error(`status ${res.status}`);
        }
      } catch (e) {
        console.warn('[merge] history: fetch failed', item.skuId, e);
        try {
          const raw = await fs.readFile(histFile, 'utf-8');
          hist = JSON.parse(raw).filter(h => typeof h.price === 'number');
          console.log('[merge] history: read from local file', `data/price-history/${item.skuId}.json`);
        } catch (e2) {
          console.warn('[merge] history: no local history', item.skuId, e2);
        }
      }

      if (typeof item.bestPrice === 'number') {
        const today = todayJst();
        const idx = hist.findIndex(h => h.date === today);
        if (idx >= 0) {
          hist[idx].price = item.bestPrice;
        } else {
          hist.push({ date: today, price: item.bestPrice });
        }
        hist.sort((a, b) => b.date.localeCompare(a.date));
        if (hist.length > 30) hist = hist.slice(0, 30);

        await fs.writeFile(histFile, JSON.stringify(hist, null, 2));
        await fs.writeFile(publicFile, JSON.stringify(hist, null, 2));
        console.log('[merge] history: merged', item.skuId);
        console.log('[merge] history: wrote', `public/data/price-history/${item.skuId}.json`);
      }
    }
  } catch (e) {
    console.warn('[merge] failed to update history', e);
  }
}

export async function run() {
  const prev = await readJson(dataOut);
  const rakutenData = await readJson(rakutenPath);
  const yahooData = await readJson(yahooPath);
  const rakutenStatus = process.env.RAKUTEN_APP_ID ? (rakutenData?.sourceStatus?.rakuten ?? 'fail') : 'fail';
  const yahooStatus = yahooData?.sourceStatus?.yahoo ?? 'fail';
  const shouldUpdateHistory = rakutenStatus !== 'fail' || yahooStatus !== 'fail';

  let out;
  if (rakutenStatus === 'fail' || yahooStatus === 'fail') {
    if (prev) {
      out = { ...prev, sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus } };
    } else {
      out = {
        updatedAt: new Date().toISOString(),
        items: mergeItems(rakutenStatus !== 'fail' ? rakutenData : null, yahooStatus !== 'fail' ? yahooData : null),
        sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus }
      };
    }
  } else {
    out = {
      updatedAt: new Date().toISOString(),
      items: mergeItems(rakutenData, yahooData),
      sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus }
    };
  }

  await fs.mkdir(path.dirname(publicOut), { recursive: true });
  await fs.mkdir(path.dirname(dataOut), { recursive: true });
  await fs.writeFile(publicOut, JSON.stringify(out, null, 2));
  await fs.writeFile(dataOut, JSON.stringify(out, null, 2));
  if (shouldUpdateHistory) {
    await updateHistory(out.items);
  }
  console.log(`[merge] rakuten=${rakutenStatus}, yahoo=${yahooStatus}, merged=${out.items.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
