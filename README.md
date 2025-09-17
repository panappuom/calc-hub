# calc-hub

## アクセシビリティチェックの実行手順

- ローカル開発では `npm run pretest:a11y` を実行すると、ビルドと Lighthouse 用の準備に加えて Playwright 経由で Chromium が取得されます。続けて `npm run test:a11y` を実行してください。
- GitHub Actions 上では `browser-actions/setup-chromium` が Chromium を提供するため、Playwright からのダウンロードは行われません。
