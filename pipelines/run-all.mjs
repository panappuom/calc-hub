import { run as runRss } from './rss.mjs';
import { run as runPrices } from './prices-rakuten.mjs';

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
  const tasks = [
    runWithLog('rss', runRss),
  ];
  if (process.env.RAKUTEN_APP_ID) {
    tasks.push(runWithLog('prices-rakuten', runPrices));
  } else {
    console.log('[pipeline] skip prices-rakuten: RAKUTEN_APP_ID not set');
  }
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
