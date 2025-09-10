import { run as runRss } from './rss.mjs';
import { run as runPrices } from './prices-rakuten.mjs';
import { run as runYahooPrices } from './prices-yahoo.mjs';
import { run as runMergePrices } from './prices-merge.mjs';

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
  tasks.push(['prices-merge', runMergePrices]);

  const results = [];
  for (const [name, fn] of tasks) {
    try {
      await runWithLog(name, fn);
      results.push({ status: 'fulfilled' });
    } catch (e) {
      results.push({ status: 'rejected', reason: e });
    }
  }

  const failures = results.filter(r => r.status === 'rejected');
  failures.forEach(r => {
    console.error('[pipeline] task failed', r.reason);
  });
  if (failures.length) {
    throw new Error(`${failures.length} pipeline task(s) failed`);
  }
  console.log('[pipeline] all done');
}
main().catch(e => { console.error(e); process.exit(1); });
