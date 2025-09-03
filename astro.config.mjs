import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://panappuom.github.io/calc-hub',
  base: '/calc-hub',
  output: 'static',
  trailingSlash: 'always',   // /calculators/ で出力させる
  srcDir: 'src',
  server: { port: 4321 }
});
