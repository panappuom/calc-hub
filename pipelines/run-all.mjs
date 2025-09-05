import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(){
  const tasks = [
    import(path.join(__dirname, 'rss.mjs')).then(m => m.run()),
    import(path.join(__dirname, 'prices-rakuten.mjs')).then(m => m.run()),
  ];
  const results = await Promise.allSettled(tasks);
  let hasFailure = false;
  results.forEach(r => {
    if (r.status === 'rejected') {
      hasFailure = true;
      console.error('[pipeline] task failed', r.reason);
    }
  });
  if (hasFailure) {
    throw new Error('[pipeline] one or more tasks failed');
  }
  console.log('[pipeline] all done');
}
main().catch(e => { console.error(e); process.exit(1); });
