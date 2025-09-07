import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(){
  const rss = import(path.join(__dirname, 'rss.mjs')).then(m => m.run());
  const priceTasks = [
    import(path.join(__dirname, 'prices-rakuten.mjs')).then(m => m.run()),
    import(path.join(__dirname, 'prices-yahoo.mjs')).then(m => m.run()),
  ];
  const rssRes = await Promise.allSettled([rss]);
  if (rssRes[0]?.status === 'rejected') {
    throw new Error('[pipeline] rss task failed');
  }
  const priceResults = await Promise.allSettled(priceTasks);
  priceResults.forEach(r => {
    if (r.status === 'rejected') {
      console.error('[pipeline] price task failed', r.reason);
    }
  });
  await import(path.join(__dirname, 'prices-merge.mjs')).then(m => m.run());
  console.log('[pipeline] all done');
}
main().catch(e => { console.error(e); process.exit(1); });
