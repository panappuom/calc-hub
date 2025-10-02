import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const ROOT = process.cwd();
const SRC_FILE = path.join(ROOT, 'data-sources', 'rss.json');
const OUT_SRC_FILE = path.join(ROOT, 'src', 'data', 'deals.json');
const OUT_PUBLIC_FILE = path.join(ROOT, 'public', 'data', 'deals.json');
const CACHE_FILE = path.join(ROOT, '.cache', 'rss-cache.json');

const CACHE_VERSION = 1;
const RATE_LIMIT_MS = 800;
const MAX_ITEMS = 100;
const WINDOW_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false
});

const DELAY = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripHtml(s = '') {
  return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function cleanWhitespace(str = '') {
  return str.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
}

const TITLE_PREFIXES = [/^PR[:：]/i, /^広告[:：]/i, /^Sponsored[:：]/i, /^AD[:：]/i, /^\[PR\]/i, /^\[AD\]/i];

function decodeEntities(str = '') {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function removeEmoji(str = '') {
  return str.replace(/\p{Extended_Pictographic}/gu, '').replace(/[\uFE0F\uFE0E]/g, '');
}

function cleanTitle(title = '') {
  let t = cleanWhitespace(decodeEntities(title));
  TITLE_PREFIXES.forEach((pattern) => {
    t = t.replace(pattern, '').trim();
  });
  t = removeEmoji(t);
  return t.trim();
}

function cleanSummary(summary = '') {
  const text = cleanWhitespace(removeEmoji(decodeEntities(stripHtml(summary))))
    .replace(/\s{2,}/g, ' ');
  const MAX_LEN = 220;
  if (text.length <= MAX_LEN) return text;
  return `${text.slice(0, MAX_LEN - 1)}…`;
}

function canonicalizeUrl(url = '') {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.hostname === 'news.google.com') {
      const original = u.searchParams.get('url');
      if (original) {
        return canonicalizeUrl(original);
      }
      const parts = u.pathname.split('/').filter(Boolean);
      const id = parts.pop();
      if (id) {
        return `https://news.google.com/articles/${id}`;
      }
    }
    const blocked = ['ref', 'ref_', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'yclid', 'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'igshid'];
    blocked.forEach((param) => u.searchParams.delete(param));
    [...u.searchParams.keys()].forEach((key) => {
      if (/^utm_/i.test(key) || /^spm$/i.test(key)) {
        u.searchParams.delete(key);
      }
    });
    return u.toString();
  } catch (e) {
    return String(url || '').trim();
  }
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function parseDate(rawDate) {
  const d = rawDate ? new Date(rawDate) : new Date();
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function toJstISOString(dateInput) {
  const d = parseDate(dateInput);
  const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
  const jstTime = utcTime + 9 * 60 * 60000;
  const jstDate = new Date(jstTime);
  return jstDate.toISOString().replace('Z', '+09:00');
}

function hostnameFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function matchByRules(title, desc, include = [], exclude = []) {
  const text = `${title} ${desc}`;
  if (exclude.some((w) => new RegExp(w, 'i').test(text))) return false;
  if (include?.length) return include.some((w) => new RegExp(w, 'i').test(text));
  return true;
}

function buildTitleHash(title) {
  return crypto.createHash('md5').update(title, 'utf8').digest('hex');
}

function buildId(canonicalUrl, titleHash) {
  return crypto
    .createHash('sha256')
    .update(canonicalUrl, 'utf8')
    .update('|')
    .update(titleHash, 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function pickImage(it) {
  const candidates = [];
  const push = (value) => {
    if (!value) return;
    const v = String(value).trim();
    if (!v) return;
    if (/^https?:\/\//i.test(v)) {
      candidates.push(v);
    }
  };

  const enclosure = it.enclosure;
  if (Array.isArray(enclosure)) {
    enclosure.forEach((e) => push(e?.['@_url'] || e?.url));
  } else if (typeof enclosure === 'object' && enclosure !== null) {
    push(enclosure['@_url'] || enclosure.url);
  }

  const media = it['media:content'] || it['media:thumbnail'];
  if (Array.isArray(media)) {
    media.forEach((m) => push(m?.['@_url'] || m?.url));
  } else if (typeof media === 'object' && media !== null) {
    push(media['@_url'] || media.url);
  }

  if (it.image && typeof it.image === 'object') {
    push(it.image.url || it.image.link);
  }

  return candidates.find(Boolean);
}

function extractKeywordTags(text) {
  const lower = text.toLowerCase();
  const tags = new Set();
  const rules = [
    { tag: 'ゲーム', keywords: ['ゲーム', 'playstation', 'ps5', 'switch', 'steam', 'xbox', '任天堂'] },
    { tag: 'PC', keywords: ['pc', 'ノート', 'デスクトップ', 'gpu', 'cpu'] },
    { tag: 'モバイル', keywords: ['スマホ', 'iphone', 'android', '携帯', 'モバイル'] },
    { tag: '家電', keywords: ['テレビ', '冷蔵庫', '洗濯機', '家電', 'イヤホン', 'ヘッドホン', 'スピーカー'] },
    { tag: '旅行', keywords: ['旅行', 'ツアー', '航空券', 'ホテル', '宿泊', '新幹線'] },
    { tag: '動画', keywords: ['配信', 'サブスク', 'ストリーミング', '動画'] },
    { tag: 'クーポン', keywords: ['クーポン', 'コード', 'プロモ', 'coupon'] },
    { tag: '無料', keywords: ['無料', '0円', '無償', 'フリー'] }
  ];
  for (const { tag, keywords } of rules) {
    if (keywords.some((kw) => lower.includes(kw))) {
      tags.add(tag);
    }
  }
  return [...tags];
}

function extractCategories(it) {
  const categories = [];
  const cat = it.category ?? it['dc:subject'];
  toArray(cat).forEach((c) => {
    if (!c) return;
    if (typeof c === 'string') {
      categories.push(stripHtml(c));
    } else if (typeof c === 'object') {
      categories.push(stripHtml(c['#text'] || c['@_term'] || ''));
    }
  });
  return categories.filter(Boolean);
}

function normalizeItem(rawItem, feed) {
  const title = cleanTitle(rawItem.title || '');
  if (!title) {
    return null;
  }
  const summary = cleanSummary(rawItem.summary || rawItem.description || '');
  const canonicalUrl = canonicalizeUrl(rawItem.link || rawItem.id || '');
  if (!canonicalUrl) {
    return null;
  }
  const date = parseDate(rawItem.date || rawItem.updated || rawItem.published || Date.now());
  const publishedAt = toJstISOString(date);
  const titleHash = buildTitleHash(title);
  const id = buildId(canonicalUrl, titleHash);
  let source = hostnameFromUrl(canonicalUrl) || hostnameFromUrl(feed.url) || feed.label;
  if (source === 'news.google.com') {
    const rawSource = rawItem.source;
    if (rawSource) {
      if (typeof rawSource === 'string') {
        source = hostnameFromUrl(rawSource) || cleanWhitespace(stripHtml(rawSource));
      } else if (typeof rawSource === 'object') {
        source = hostnameFromUrl(rawSource['@_url']) || cleanWhitespace(stripHtml(rawSource['#text'] || '')) || source;
      }
    }
  }
  const categories = extractCategories(rawItem);
  const tags = new Set([
    ...(feed.tags || []),
    ...categories,
    ...extractKeywordTags(`${title} ${summary}`)
  ]);
  const image = pickImage(rawItem);

  const data = {
    id,
    title,
    summary,
    url: canonicalUrl,
    publishedAt,
    tags: [...tags].filter(Boolean),
    source
  };
  if (image) {
    data.image = image;
  }

  return {
    data,
    meta: {
      canonicalUrl,
      titleHash,
      timestamp: date.getTime()
    }
  };
}

function parseFeedItems(feed, xml) {
  const json = parser.parse(xml);
  const channel = json?.rss?.channel || json?.feed;
  let items = [];

  if (!channel) return [];

  if (channel?.item) {
    items = toArray(channel.item).map((it) => ({
      ...it,
      sourceLabel: feed.label,
      title: stripHtml(it.title ?? ''),
      link: String(it.link ?? it?.guid ?? '').trim(),
      date: it.pubDate ?? it.date ?? it['dc:date'],
      description: it['content:encoded'] ?? it.description ?? '',
      summary: it.description ?? '',
      id: it.guid?.['#text'] || it.guid || it.link
    }));
  } else if (channel?.entry) {
    const entries = toArray(channel.entry);
    items = entries.map((it) => {
      let link = '';
      const l = it.link;
      if (Array.isArray(l)) {
        const alt = l.find((x) => x['@_rel'] === 'alternate') || l[0];
        link = alt?.['@_href'] || alt?.href || '';
      } else if (typeof l === 'object' && l !== null) {
        link = l['@_href'] || l.href || '';
      }
      return {
        ...it,
        sourceLabel: feed.label,
        title: stripHtml(it.title ?? ''),
        link: String(link || it.id || '').trim(),
        date: it.updated ?? it.published,
        description: it.content?.['#text'] ?? it.content ?? it.summary ?? '',
        summary: it.summary ?? it.content ?? '',
        id: it.id || link
      };
    });
  }

  return items;
}

async function fetchFeed(feed, cacheEntry) {
  const headers = {
    'user-agent': 'calc-hub/1.0 (+https://github.com/)'
  };
  if (cacheEntry?.etag) {
    headers['if-none-match'] = cacheEntry.etag;
  }
  if (cacheEntry?.lastModified) {
    headers['if-modified-since'] = cacheEntry.lastModified;
  }

  const res = await undiciFetch(feed.url, { headers, dispatcher });
  if (res.status === 304) {
    return {
      status: 304,
      etag: cacheEntry?.etag,
      lastModified: cacheEntry?.lastModified,
      xml: null
    };
  }
  if (!res.ok) {
    throw new Error(`fetch ${feed.url} ${res.status}`);
  }
  const xml = await res.text();
  return {
    status: res.status,
    etag: res.headers.get('etag') || undefined,
    lastModified: res.headers.get('last-modified') || undefined,
    xml
  };
}

async function loadFeeds() {
  const raw = await fs.readFile(SRC_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function processFeed(feed, cache) {
  const cacheEntry = cache[feed.url];
  await DELAY(RATE_LIMIT_MS);
  const response = await fetchFeed(feed, cacheEntry);

  if (response.status === 304 && cacheEntry?.version === CACHE_VERSION && Array.isArray(cacheEntry.items)) {
    console.log(`[rss] ${feed.label}: use cache (${cacheEntry.items.length} items)`);
    return { items: cacheEntry.items, cacheEntry }; // already normalized
  }

  if (!response.xml) {
    throw new Error(`missing XML for ${feed.url}`);
  }

  const parsedItems = parseFeedItems(feed, response.xml);
  const filtered = parsedItems.filter((it) => matchByRules(it.title, it.description || it.summary || '', feed.include, feed.exclude));
  const limited = feed.limit ? filtered.slice(0, feed.limit) : filtered;
  const normalized = limited.map((it) => normalizeItem(it, feed)).filter(Boolean);

  cache[feed.url] = {
    etag: response.etag,
    lastModified: response.lastModified,
    fetchedAt: new Date().toISOString(),
    items: normalized,
    version: CACHE_VERSION
  };

  console.log(`[rss] ${feed.label}: fetched ${parsedItems.length}, matched ${filtered.length}, normalized ${normalized.length}`);

  return { items: normalized, cacheEntry: cache[feed.url] };
}

export async function run() {
  const stats = {
    fetched: 0,
    matched: 0,
    normalized: 0,
    duplicates: 0,
    stale: 0
  };

  try {
    const [feeds, cache] = await Promise.all([loadFeeds(), loadCache()]);
    const aggregated = [];

    for (const feed of feeds) {
      try {
        const { items } = await processFeed(feed, cache);
        aggregated.push(...items);
        stats.fetched += items.length;
      } catch (e) {
        console.warn(`[rss] skip ${feed.url}: ${e.message}`);
      }
    }

    await saveCache(cache);

    const now = Date.now();
    const threshold = now - WINDOW_MS;
    const seen = new Set();
    const sorted = aggregated
      .filter(Boolean)
      .sort((a, b) => b.meta.timestamp - a.meta.timestamp);

    const finalItems = [];
    for (const item of sorted) {
      stats.matched += 1;
      if (!item?.meta) continue;
      if (item.meta.timestamp < threshold) {
        stats.stale += 1;
        continue;
      }
      const key = `${item.meta.canonicalUrl}|${item.meta.titleHash}`;
      if (seen.has(key)) {
        stats.duplicates += 1;
        continue;
      }
      seen.add(key);
      finalItems.push(item.data);
      stats.normalized += 1;
      if (finalItems.length >= MAX_ITEMS) break;
    }

    const payload = {
      updatedAt: toJstISOString(new Date()),
      items: finalItems
    };

    await writeJson(OUT_SRC_FILE, payload);
    await writeJson(OUT_PUBLIC_FILE, payload);

    console.log(`[rss] summary: total ${aggregated.length}, recent ${finalItems.length}, duplicates ${stats.duplicates}, stale ${stats.stale}`);
    console.log(`[rss] wrote ${OUT_SRC_FILE}`);
    console.log(`[rss] wrote ${OUT_PUBLIC_FILE}`);
  } catch (e) {
    console.error('[rss] failed', e);
    throw e;
  }
}
