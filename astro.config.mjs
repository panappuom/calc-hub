import { defineConfig } from 'astro/config';

const deployTarget = process.env.PUBLIC_DEPLOY_TARGET;
const isProd = deployTarget === 'prod';

export default defineConfig({
  site: 'https://panappuom.github.io/calc-hub',
  base: isProd ? '/calc-hub/' : '/',
  output: 'static',
  trailingSlash: 'always',   // /calculators/ で出力させる
  srcDir: 'src',
  server: { port: 4321 }
});
