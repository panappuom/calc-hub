import fs from 'fs/promises';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

const ROOT = process.cwd();
const SRC_FILE = path.join(ROOT, 'data-sources', 'rss.json');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'deals.json');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true
});

function stripHtml(s=''){
  return String(s).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
}
function toISO(d){
  try { return new Date(d).toISOString(); } catch { return new Date().toISOString(); }
}

function matchByRules(title, desc, include=[], exclude=[]){
  const text = `${title} ${desc}`;
  if (exclude.some(w => new RegExp(w, 'i').test(text))) return false;
  if (include?.length) return include.some(w => new RegExp(w, 'i').test(text));
  return true;
}

async function fetchXml(url){
  const res = await fetch(url, { headers: { 'user-agent': 'auto-factory/1.0' } });
  if(!res.ok) throw new Error(`fetch ${url} ${res.status}`);
  return await res.text();
}

async function loadFeeds(){
  const raw = await fs.readFile(SRC_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function writeJson(file, data){
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
}

export async function run(){
  try{
    const feeds = await loadFeeds();
    let all = [];

    for(const f of feeds){
      try{
        const xml = await fetchXml(f.url);
        const j = parser.parse(xml);
        const channel = j?.rss?.channel || j?.feed;
        let items = [];

        // RSS 2.0
        if (channel?.item) {
          items = Array.isArray(channel.item) ? channel.item : [channel.item];
          items = items.map(it => ({
            source: f.label,
            title: stripHtml(it.title ?? ''),
            link: String(it.link ?? it?.guid ?? '').trim(),
            date: toISO(it.pubDate ?? it.date ?? it['dc:date'] ?? Date.now()),
            description: stripHtml(it.description ?? it['content:encoded'] ?? '')
          }));
        }
        // Atom
        else if (channel?.entry) {
          const entries = Array.isArray(channel.entry) ? channel.entry : [channel.entry];
          items = entries.map(it => {
            let link = '';
            const l = it.link;
            if (Array.isArray(l)) {
              const alt = l.find(x => x['@_rel'] === 'alternate') || l[0];
              link = alt?.['@_href'] || '';
            } else if (typeof l === 'object') {
              link = l?.['@_href'] || '';
            }
            return {
              source: f.label,
              title: stripHtml(it.title ?? ''),
              link: String(link || it.id || '').trim(),
              date: toISO(it.updated ?? it.published ?? Date.now()),
              description: stripHtml(it.summary ?? it.content ?? '')
            };
          });
        }

        // フィルタ
        items = items.filter(it => it.link && matchByRules(it.title, it.description, f.include, f.exclude));
        // 限定
        if (f.limit) items = items.slice(0, f.limit);

        all.push(...items);
        console.log(`[rss] ${f.label}: ${items.length} items`);
      }catch(e){
        console.warn(`[rss] skip ${f.url}: ${e.message}`);
      }
    }

    // ソート＆上限
    all.sort((a,b)=> new Date(b.date) - new Date(a.date));
    const MAX = 200;
    all = all.slice(0, MAX);

    await writeJson(OUT_FILE, { updatedAt: new Date().toISOString(), items: all });
    console.log(`[rss] wrote ${OUT_FILE} (${all.length})`);
  }catch(e){
    console.error('[rss] failed', e);
  }
}
