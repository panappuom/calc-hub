import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const skuPath = path.join(rootDir, 'src', 'data', 'skus.json');
const rakutenPath = path.join(rootDir, 'src', 'data', 'prices', 'rakuten.json');
const yahooPath = path.join(rootDir, 'src', 'data', 'prices', 'yahoo.json');
const outPath = path.join(rootDir, 'src', 'data', 'prices', 'today.json');

async function readJson(p) {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function chooseBest(list) {
  if (!list || list.length === 0) return null;
  return list.reduce((best, cur) => {
    const b = best.price - (best.price * (best.pointRate || 0)) / 100;
    const c = cur.price - (cur.price * (cur.pointRate || 0)) / 100;
    return c < b ? cur : best;
  });
}

export async function run() {
  let skus = [];
  try {
    const raw = await fs.readFile(skuPath, 'utf-8');
    skus = JSON.parse(raw);
  } catch (e) {
    console.error('[prices] merge failed to read skus.json', e);
    return;
  }

  const rakutenData = (await readJson(rakutenPath)) ?? { items: [], status: 'fail' };
  const yahooData = (await readJson(yahooPath)) ?? { items: [], status: 'fail' };

  const rakutenMap = Object.fromEntries(rakutenData.items.map(i => [i.skuId, i.list]));
  const yahooMap = Object.fromEntries(yahooData.items.map(i => [i.skuId, i.list]));

  const items = [];
  for (const sku of skus) {
    const listR = rakutenMap[sku.id] || [];
    const listY = yahooMap[sku.id] || [];
    const bestR = chooseBest(listR);
    const bestY = chooseBest(listY);

    let best = null;
    let bestSource = null;
    if (bestR && (!bestY || (bestR.price - (bestR.price * (bestR.pointRate || 0)) / 100) <= (bestY.price - (bestY.price * (bestY.pointRate || 0)) / 100))) {
      best = bestR;
      bestSource = 'rakuten';
    } else if (bestY) {
      best = bestY;
      bestSource = 'yahoo';
    }

    items.push({
      skuId: sku.id,
      bestPrice: best?.price ?? null,
      bestShop: best?.shopName ?? null,
      bestSource,
      list: { rakuten: listR, yahoo: listY },
    });
  }

  const out = {
    updatedAt: new Date().toISOString(),
    sourceStatus: {
      rakuten: rakutenData.status ?? 'fail',
      yahoo: yahooData.status ?? 'fail',
    },
    items,
  };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log('[prices] wrote', outPath);
}
