import { run as runRss } from './rss.mjs';
import { run as runPrices } from './prices-rakuten.mjs';
import { run as runYahooPrices } from './prices-yahoo.mjs';

async function runWithLog(name, fn) {
  console.log(`[pipeline] start ${name}`);
  try {
    await fn();
    console.log(`[pipeline] end ${name}`);
  } catch (e) {
    console.error(`[pipeline] ${name} failed`, e);
    throw e;
  }
}

async function main(){
  const tasks = [ ['rss', runRss] ];

  if (process.env.RAKUTEN_APP_ID) {
    tasks.push(['prices-rakuten', runPrices]);
  } else {
    console.log('[pipeline] skip prices-rakuten: RAKUTEN_APP_ID not set');
  }

  tasks.push(['prices-yahoo', runYahooPrices]);

  try {
    const { run: runMerge } = await import('./merge.mjs');
    tasks.push(['merge', runMerge]);
  } catch {
    console.log('[pipeline] skip merge: merge.mjs not found');
  }

  const results = [];
  for (const [name, fn] of tasks) {
    try {
      await runWithLog(name, fn);
      results.push({ status: 'fulfilled' });
    } catch (e) {
      results.push({ status: 'rejected', reason: e });
    }
  }
  results.forEach(r => {
    if (r.status === 'rejected') {
      console.error('[pipeline] task failed', r.reason);
    }
  });
  console.log('[pipeline] all done');
}
main().catch(e => { console.error(e); process.exit(1); });
