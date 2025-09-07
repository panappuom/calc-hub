import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { run as runRss } from './rss.mjs';
import { run as runPrices, HISTORY_COMMIT_MESSAGE } from './prices-rakuten.mjs';
const exec = promisify(execCb);

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
  try {
    await exec('git config user.name "github-actions[bot]"');
    await exec('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
    await exec('git add data public');
    const { stdout } = await exec('git status --short data public');
    if (stdout.trim()) {
      await exec(`git commit -m "${HISTORY_COMMIT_MESSAGE}"`);
      await exec('git push');
    }
  } catch (e) {
    console.warn('[pipeline] commit skipped', e);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
