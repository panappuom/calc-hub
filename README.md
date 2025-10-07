# calc-hub

## アクセシビリティチェックの実行手順

- ローカル開発では `npm run pretest:a11y` を実行すると、ビルドと Lighthouse 用の準備に加えて Playwright 経由で Chromium が取得されます。続けて `npm run test:a11y` を実行してください。
- GitHub Actions 上では `browser-actions/setup-chromium` が Chromium を提供するため、Playwright からのダウンロードは行われません。

## アクセス解析の有効化

Plausible を利用した Cookie レス計測をサポートしています。GitHub Pages へのデプロイ時に `PUBLIC_ANALYTICS_*` の各変数を確実に注入することが重要です。

### GitHub Actions での準備

1. リポジトリの **Settings → Actions → Variables** を開き、次の3変数を登録します。
   - `PUBLIC_ANALYTICS_PROVIDER`（通常は `plausible`）
   - `PUBLIC_ANALYTICS_DOMAIN`（Plausible 上で計測するドメイン。例: `panappuom.github.io`）
   - `PUBLIC_ANALYTICS_SRC`（任意。独自ホストしたスクリプトを使う場合のみ。既定は `https://plausible.io/js/script.js`）
2. `.github/workflows/deploy.yml` の `test-build` ジョブでは、上記の変数を `env` として Astro のビルドコマンドに渡しています。**Workflow に `env` を設定し忘れるとビルド済み HTML にスクリプトが挿入されないので注意してください。**

`PUBLIC_ANALYTICS_PROVIDER` を `none`（既定値）にすると計測は無効化され、スクリプトは読み込まれません。

### 動作確認のヒント

- ローカルビルドや Actions 上のビルド結果を確認すると、生成された HTML の `<head>` に `<script defer data-domain="..." src="..."></script>` が1回だけ出力されます。
- GitHub Pages では `/calc-hub/` のようなサブパス配信でも Plausible の計測が動作します。`Verify` ボタンはサブパス環境では失敗することがあるため、代わりに Plausible の **Realtime** ビューで PV/イベントが流れることを確認してください（AdBlock を無効化した状態でアクセスする）。

### 送信イベント一覧

| イベント名 | 発火タイミング | 送信プロパティ |
| --- | --- | --- |
| `deal_click` | `/deals/` のカードリンクをクリックしたとき | `url`, `source_domain`, `tags`（CSV）, `position`, `utm_source`, `utm_medium`, `utm_campaign` |
| `sku_card_click` | `/prices/` で SKU カードをクリックしたとき | `sku`, `rank`, `from_page` |
| `price_click` | `/prices/[sku]/` の「ショップで確認」ボタンをクリックしたとき | `sku`, `store`, `shop_name`, `price`, `effective_price`, `utm_source`, `utm_medium`, `utm_campaign` |

`PUBLIC_ANALYTICS_PROVIDER=plausible` が設定されていれば、各イベントは `window.plausible()` を通じて送信されます。

## 価格履歴のバックフィルとクリーニング

Rakuten/Yahoo の集計結果をマージする `pipelines/prices-merge.mjs` では、オプトインで既存の価格履歴をクリーンアップできます。

- `ENABLE_HISTORY_BACKFILL=true` を設定すると、`meta.valueType` が `effectivePrice` 以外のファイルでも当日以降は強制的に効果価格で上書きし、IQR ベースの外れ値を除外したうえで `meta.cleaned=true` を付与します。
- `DRY_RUN=true` を併用するとファイルへの書き込みは行わず、差分のみをログ出力します。

本番に適用する際はまず `DRY_RUN=true` を指定して差分を確認してから、問題がなければ `DRY_RUN` を外して再実行してください。
