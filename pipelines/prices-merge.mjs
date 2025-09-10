import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicOut = path.join(rootDir, 'public', 'data', 'prices', 'today.json');
const yahooPath = path.join(rootDir, 'public', 'data', 'prices', 'today.yahoo.json');
const dataOut = path.join(rootDir, 'data', 'prices', 'today.json');

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

export async function run() {
  const prev = await readJson(dataOut);
  const rakutenData = await readJson(publicOut);
  const yahooData = await readJson(yahooPath);
  const rakutenStatus = process.env.RAKUTEN_APP_ID ? (rakutenData?.sourceStatus?.rakuten ?? 'fail') : 'fail';
  const yahooStatus = yahooData?.sourceStatus?.yahoo ?? 'fail';

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
  console.log(`[merge] rakuten=${rakutenStatus}, yahoo=${yahooStatus}, merged=${out.items.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
