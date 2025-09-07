import { fileURLToPath } from 'url';
import path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execCb);
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
  try {
    await exec('git config user.name "github-actions[bot]"');
    await exec('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
    await exec('git add data src/data/prices/today.json');
    const { stdout } = await exec('git status --short data src/data/prices/today.json');
    if (stdout.trim()) {
      await exec('git commit -m "chore(history): update prices [skip ci]"');
      await exec('git push');
    }
  } catch (e) {
    console.warn('[pipeline] commit skipped', e);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
