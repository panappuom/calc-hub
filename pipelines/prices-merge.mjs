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

async function readPrevToday() {
  try {
    const url = new URL('data/prices/today.json', publicBase);
    url.searchParams.set('t', Date.now().toString());
    const res = await fetch(url);
    if (res.ok) {
      console.log('[merge] prev: fetched from public URL', url.toString());
      return await res.json();
    }
    console.warn('[merge] prev: fetch failed', url.toString(), res.status);
  } catch (e) {
    console.warn('[merge] prev: fetch error', e);
  }
  const local = await readJson(dataOut);
  if (local) {
    console.log('[merge] prev: read from local file', dataOut);
  }
  return local;
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
  const prev = await readPrevToday();
  const rakutenData = await readJson(rakutenPath);
  const yahooEnabled = process.env.YAHOO_ENABLED !== 'false';
  const yahooData = yahooEnabled ? await readJson(yahooPath) : null;
  const rakutenStatus = process.env.RAKUTEN_APP_ID ? (rakutenData?.sourceStatus?.rakuten ?? 'fail') : 'fail';
  const yahooStatus = yahooEnabled ? (yahooData?.sourceStatus?.yahoo ?? 'fail') : 'disabled';
  const shouldUpdateHistory = rakutenStatus !== 'fail' || (yahooEnabled && yahooStatus !== 'fail');

  const map = new Map(prev?.items?.map(it => [it.skuId, it]) || []);
  const add = src => {
    for (const it of src.items || []) {
      const list = Array.isArray(it.list)
        ? it.list.filter(l => typeof l.price === 'number')
        : [];
      list.sort((a, b) => a.price - b.price);
      const best = list[0];
      map.set(it.skuId, {
        skuId: it.skuId,
        bestPrice: best?.price ?? null,
        bestShop: best?.shopName ?? null,
        list
      });
    }
  };
  if (rakutenStatus !== 'fail' && rakutenData) add(rakutenData);
  if (yahooEnabled && yahooStatus !== 'fail' && yahooData) add(yahooData);

  let out;
  if (map.size > 0 && (rakutenStatus !== 'fail' || (yahooEnabled && yahooStatus !== 'fail'))) {
    out = {
      updatedAt: new Date().toISOString(),
      items: Array.from(map.values()),
      sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus }
    };
  } else if (prev) {
    out = { ...prev, sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus } };
  } else {
    out = {
      updatedAt: new Date().toISOString(),
      items: [],
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
