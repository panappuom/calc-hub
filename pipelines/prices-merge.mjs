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
const enableHistoryBackfill = ['1', 'true', 'yes'].includes(String(process.env.ENABLE_HISTORY_BACKFILL ?? '').toLowerCase());
const historyDryRun = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN ?? '').toLowerCase());
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

function quantile(sorted, q) {
  if (!Array.isArray(sorted) || sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const baseValue = sorted[base];
  const nextValue = sorted[Math.min(sorted.length - 1, base + 1)];
  return baseValue + rest * (nextValue - baseValue);
}

function cleanHistoryEntries(entries) {
  const normalized = Array.isArray(entries)
    ? entries.filter(it => typeof it?.date === 'string' && Number.isFinite(it?.price))
    : [];
  if (normalized.length <= 1) {
    return { history: normalized, removed: [] };
  }
  const prices = normalized.map(it => it.price).sort((a, b) => a - b);
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);
  const median = quantile(prices, 0.5);
  const iqr = q3 - q1;
  let lowerBound = q1 - 1.5 * iqr;
  let upperBound = q3 + 1.5 * iqr;
  if (!Number.isFinite(lowerBound)) lowerBound = 0;
  if (!Number.isFinite(upperBound)) upperBound = Number.POSITIVE_INFINITY;
  const positivePrices = prices.filter(price => price > 0);
  if (Number.isFinite(median) && median > 0) {
    const ratioLower = median / 4;
    const ratioUpper = median * 4;
    lowerBound = Math.min(lowerBound, ratioLower);
    upperBound = Math.max(upperBound, ratioUpper);
  } else if (positivePrices.length > 0) {
    const positiveQ1 = quantile(positivePrices, 0.25);
    const positiveQ3 = quantile(positivePrices, 0.75);
    const positiveIqr = positiveQ3 - positiveQ1;
    let positiveUpper = positiveQ3 + 1.5 * positiveIqr;
    if (!Number.isFinite(positiveUpper) || positiveUpper <= 0) {
      positiveUpper = positivePrices[positivePrices.length - 1];
    }
    const minPositive = positivePrices[0];
    const expandedUpper = Math.max(positiveUpper, minPositive * 4);
    upperBound = Math.max(upperBound, expandedUpper);
  }
  lowerBound = Math.max(0, lowerBound);
  const absoluteUpper = 5_000_000;
  upperBound = Math.min(upperBound, absoluteUpper);

  const removed = [];
  const cleaned = [];
  for (const entry of normalized) {
    const price = entry.price;
    if (!Number.isFinite(price)) {
      removed.push(entry);
      continue;
    }
    if (price < lowerBound || price > upperBound) {
      removed.push(entry);
      continue;
    }
    cleaned.push(entry);
  }
  return { history: cleaned, removed };
}

async function logHistoryDiff(filePath, nextJson) {
  try {
    const prevJson = await fs.readFile(filePath, 'utf-8');
    if (prevJson === nextJson) {
      console.log('[merge] history: dry-run no changes for', filePath);
      return;
    }
    console.log('[merge] history: dry-run diff for', filePath);
    console.log('--- before');
    console.log(prevJson);
    console.log('--- after');
    console.log(nextJson);
  } catch (e) {
    console.log('[merge] history: dry-run new file for', filePath);
    console.log('--- after');
    console.log(nextJson);
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

function calculateEffectivePrice(entry) {
  const price = Number(entry?.price);
  if (!Number.isFinite(price)) return null;
  const pointRateRaw = entry?.pointRate ?? entry?.point?.amount ?? entry?.point;
  const pointRate = Number(pointRateRaw ?? 0);
  const safePointRate = Number.isFinite(pointRate) ? pointRate : 0;
  const base = Math.floor(price * (100 - safePointRate) / 100);
  const couponDiscountRaw = entry?.couponDiscount ?? entry?.coupon?.discount ?? 0;
  const couponDiscount = Number(couponDiscountRaw);
  const discount = Number.isFinite(couponDiscount) ? couponDiscount : 0;
  const effective = base - discount;
  if (!Number.isFinite(effective)) return null;
  const normalized = Math.floor(effective);
  return normalized < 0 ? 0 : normalized;
}

function getEntryKey(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.shopId != null) {
    return `shop:${String(entry.shopId)}`;
  }
  if (entry.itemUrl) {
    return `url:${entry.itemUrl}`;
  }
  if (entry.url) {
    return `url:${entry.url}`;
  }
  return null;
}

function createItemState(prevItem) {
  const state = {
    skuId: prevItem?.skuId,
    entries: new Map(),
    nextId: 0
  };
  const list = Array.isArray(prevItem?.list) ? prevItem.list : [];
  for (const rawEntry of list) {
    addEntryToState(state, rawEntry, { isToday: false });
  }
  return state;
}

function addEntryToState(state, entry, { isToday }) {
  if (!state || !entry || typeof entry !== 'object') return;
  const key = getEntryKey(entry);
  const enriched = { ...entry };
  const effectivePrice = Number.isFinite(enriched.effectivePrice)
    ? Number(enriched.effectivePrice)
    : calculateEffectivePrice(enriched);
  if (Number.isFinite(effectivePrice)) {
    enriched.effectivePrice = effectivePrice;
  } else {
    delete enriched.effectivePrice;
  }
  const internalEntry = { ...enriched, __isToday: Boolean(isToday) };
  const targetKey = key ?? `legacy:${state.nextId++}`;
  const existing = state.entries.get(targetKey);
  if (!existing) {
    state.entries.set(targetKey, internalEntry);
    return;
  }

  const existingToday = existing.__isToday ? 1 : 0;
  const incomingToday = internalEntry.__isToday ? 1 : 0;
  if (incomingToday > existingToday) {
    state.entries.set(targetKey, internalEntry);
    return;
  }
  if (incomingToday < existingToday) {
    return;
  }

  const existingEff = Number.isFinite(existing.effectivePrice)
    ? existing.effectivePrice
    : calculateEffectivePrice(existing);
  const incomingEff = Number.isFinite(internalEntry.effectivePrice)
    ? internalEntry.effectivePrice
    : calculateEffectivePrice(internalEntry);

  const existingValue = Number.isFinite(existingEff) ? existingEff : Number.POSITIVE_INFINITY;
  const incomingValue = Number.isFinite(incomingEff) ? incomingEff : Number.POSITIVE_INFINITY;
  if (incomingValue < existingValue) {
    state.entries.set(targetKey, internalEntry);
  }
}

function finalizeItemState(state) {
  if (!state) return null;
  const list = [];
  for (const value of state.entries.values()) {
    const { __isToday, ...rest } = value;
    const effective = Number.isFinite(rest.effectivePrice)
      ? rest.effectivePrice
      : calculateEffectivePrice(rest);
    if (Number.isFinite(effective)) {
      rest.effectivePrice = effective;
    } else {
      delete rest.effectivePrice;
    }
    list.push(rest);
  }

  const compareValue = entry => {
    const eff = Number.isFinite(entry.effectivePrice)
      ? entry.effectivePrice
      : calculateEffectivePrice(entry);
    if (Number.isFinite(eff)) return eff;
    const price = Number(entry.price);
    return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
  };

  list.sort((a, b) => {
    const diff = compareValue(a) - compareValue(b);
    if (diff !== 0) return diff;
    const priceA = Number(a.price);
    const priceB = Number(b.price);
    const normalizedA = Number.isFinite(priceA) ? priceA : Number.POSITIVE_INFINITY;
    const normalizedB = Number.isFinite(priceB) ? priceB : Number.POSITIVE_INFINITY;
    return normalizedA - normalizedB;
  });

  const bestEntryCandidate = list.find(it => Number.isFinite(it.effectivePrice)) || list[0] || null;
  const bestEffectiveValue = bestEntryCandidate
    ? (Number.isFinite(bestEntryCandidate.effectivePrice)
        ? bestEntryCandidate.effectivePrice
        : calculateEffectivePrice(bestEntryCandidate))
    : null;
  const bestEffective = Number.isFinite(bestEffectiveValue) ? bestEffectiveValue : null;
  const bestShop = bestEntryCandidate?.shopName ?? null;

  const normalizedBest = Number.isFinite(bestEffective) ? bestEffective : null;

  return {
    skuId: state.skuId,
    bestPrice: normalizedBest,
    bestPriceEffective: normalizedBest,
    bestEntryEffective: bestEntryCandidate ?? null,
    bestShop,
    list
  };
}

function parseHistoryPayload(payload) {
  if (!payload) {
    return { meta: {}, history: [] };
  }
  if (Array.isArray(payload)) {
    return { meta: {}, history: payload };
  }
  if (typeof payload === 'object') {
    const values = Object.values(payload);
    const history = Array.isArray(payload.history)
      ? payload.history
      : values.find(Array.isArray) || [];
    const meta = typeof payload.meta === 'object' && payload.meta !== null ? payload.meta : {};
    return { meta, history };
  }
  return { meta: {}, history: [] };
}

async function updateHistory(items) {
  try {
    await fs.mkdir(historyDir, { recursive: true });
    await fs.mkdir(publicHistoryDir, { recursive: true });
    for (const item of items) {
      const histFile = path.join(historyDir, `${item.skuId}.json`);
      const publicFile = path.join(publicHistoryDir, `${item.skuId}.json`);
      let hist = [];
      let meta = {};
      try {
        const url = new URL(`data/price-history/${item.skuId}.json`, publicBase);
        const res = await fetch(url);
        if (res.ok) {
          const parsed = parseHistoryPayload(await res.json());
          meta = parsed.meta;
          hist = parsed.history.filter(h => typeof h?.price === 'number');
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
          const parsed = parseHistoryPayload(JSON.parse(raw));
          meta = parsed.meta;
          hist = parsed.history.filter(h => typeof h?.price === 'number');
          console.log('[merge] history: read from local file', `data/price-history/${item.skuId}.json`);
        } catch (e2) {
          console.warn('[merge] history: no local history', item.skuId, e2);
        }
      }

      const today = todayJst();
      const requiresBackfill = enableHistoryBackfill && (meta?.valueType !== 'effectivePrice');
      if (requiresBackfill) {
        const beforeCount = hist.length;
        hist = hist.filter(h => typeof h?.date === 'string' && h.date <= today);
        const removedFuture = beforeCount - hist.length;
        if (removedFuture > 0) {
          console.log('[merge] history: trimmed future/raw entries for', item.skuId, removedFuture);
        }
      }
      const bestEffective = Number.isFinite(item.bestPriceEffective)
        ? item.bestPriceEffective
        : Number.isFinite(item.bestPrice)
          ? item.bestPrice
          : null;
      if (Number.isFinite(bestEffective)) {
        const idx = hist.findIndex(h => h.date === today);
        if (idx >= 0) {
          hist[idx].price = bestEffective;
        } else {
          hist.push({ date: today, price: bestEffective });
        }
      }
      hist = hist
        .filter(h => typeof h?.date === 'string' && typeof h?.price === 'number')
        .sort((a, b) => b.date.localeCompare(a.date));

      if (enableHistoryBackfill) {
        const { history: cleanedHist, removed } = cleanHistoryEntries(hist);
        if (removed.length > 0) {
          console.log('[merge] history: removed outliers for', item.skuId, removed.map(r => `${r.date}:${r.price}`).join(', '));
        }
        hist = cleanedHist;
      }

      if (hist.length > 30) hist = hist.slice(0, 30);

      const nextMeta = { ...meta, valueType: 'effectivePrice' };
      if (enableHistoryBackfill) {
        nextMeta.cleaned = true;
      }

      const output = { meta: nextMeta, history: hist };
      const outputJson = JSON.stringify(output, null, 2);

      const dryRunEnabled = enableHistoryBackfill && historyDryRun;
      if (dryRunEnabled) {
        await logHistoryDiff(histFile, outputJson);
        console.log('[merge] history: dry-run skipped write for', item.skuId);
      } else {
        await fs.writeFile(histFile, outputJson);
        await fs.writeFile(publicFile, outputJson);
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

  const map = new Map();
  for (const prevItem of prev?.items || []) {
    if (!prevItem?.skuId) continue;
    map.set(prevItem.skuId, createItemState(prevItem));
  }

  const add = (src, isToday) => {
    for (const it of src?.items || []) {
      if (!it?.skuId) continue;
      let state = map.get(it.skuId);
      if (!state) {
        state = createItemState({ skuId: it.skuId });
        map.set(it.skuId, state);
      }
      const list = Array.isArray(it.list)
        ? it.list.filter(l => Number.isFinite(Number(l?.price)) || Number.isFinite(Number(l?.effectivePrice)))
        : [];
      for (const entry of list) {
        addEntryToState(state, entry, { isToday });
      }
    }
  };

  if (prev && prev.items) {
    // ensure previous items are represented even if no new data
    for (const item of prev.items) {
      if (!map.has(item?.skuId)) {
        map.set(item?.skuId, createItemState(item));
      }
    }
  }

  if (rakutenStatus !== 'fail' && rakutenData) add(rakutenData, true);
  if (yahooEnabled && yahooStatus !== 'fail' && yahooData) add(yahooData, true);

  let out;
  const finalizedItems = Array.from(map.values())
    .map(finalizeItemState)
    .filter(Boolean);

  if (map.size > 0 && (rakutenStatus !== 'fail' || (yahooEnabled && yahooStatus !== 'fail'))) {
    out = {
      updatedAt: new Date().toISOString(),
      items: finalizedItems,
      sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus },
      meta: { valueType: 'effectivePrice', tz: 'Asia/Tokyo', version: 2 }
    };
  } else if (prev) {
    out = {
      ...prev,
      items: finalizedItems,
      sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus }
    };
    out.meta = { ...(prev.meta || {}), valueType: 'effectivePrice', tz: 'Asia/Tokyo', version: 2 };
  } else {
    out = {
      updatedAt: new Date().toISOString(),
      items: finalizedItems,
      sourceStatus: { rakuten: rakutenStatus, yahoo: yahooStatus },
      meta: { valueType: 'effectivePrice', tz: 'Asia/Tokyo', version: 2 }
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
