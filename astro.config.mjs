import { defineConfig } from 'astro/config';
export default defineConfig({
  output: 'static',
  srcDir: 'src',
  server: { port: 4321 }
});
