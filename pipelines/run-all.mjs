import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { run as runRss } from './rss.mjs';
import { run as runPrices, HISTORY_COMMIT_MESSAGE } from './prices-rakuten.mjs';
const exec = promisify(execCb);

async function main(){
  const tasks = [
    runRss(),
    runPrices(),
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
