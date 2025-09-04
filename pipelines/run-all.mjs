import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(){
  const tasks = [
    import(path.join(__dirname, 'rss.mjs')).then(m => m.run())
  ];
  await Promise.all(tasks);
  console.log('[pipeline] all done');
}
main().catch(e => { console.error(e); process.exit(1); });
