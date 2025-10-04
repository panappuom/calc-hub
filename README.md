# calc-hub

## アクセシビリティチェックの実行手順

- ローカル開発では `npm run pretest:a11y` を実行すると、ビルドと Lighthouse 用の準備に加えて Playwright 経由で Chromium が取得されます。続けて `npm run test:a11y` を実行してください。
- GitHub Actions 上では `browser-actions/setup-chromium` が Chromium を提供するため、Playwright からのダウンロードは行われません。

## アクセス解析の有効化

Plausible を利用した Cookie レス計測をサポートしています。計測を有効化するには以下の公開環境変数を設定してください。

```
PUBLIC_ANALYTICS_PROVIDER=plausible
PUBLIC_ANALYTICS_DOMAIN=<your-plausible-domain>
# 任意: 独自ホストしたスクリプトを使う場合のみ
PUBLIC_ANALYTICS_SRC=https://plausible.io/js/script.js
```

`PUBLIC_ANALYTICS_PROVIDER` を `none`（既定値）にすると計測は無効化され、スクリプトは読み込まれません。

### 送信イベント一覧

| イベント名 | 発火タイミング | 送信プロパティ |
| --- | --- | --- |
| `deal_click` | `/deals/` のカードリンクをクリックしたとき | `url`, `source_domain`, `tags`（CSV）, `position`, `utm_source`, `utm_medium`, `utm_campaign` |
| `sku_card_click` | `/prices/` で SKU カードをクリックしたとき | `sku`, `rank`, `from_page` |
| `price_click` | `/prices/[sku]/` の「ショップで確認」ボタンをクリックしたとき | `sku`, `store`, `shop_name`, `price`, `effective_price`, `utm_source`, `utm_medium`, `utm_campaign` |

`PUBLIC_ANALYTICS_PROVIDER=plausible` が設定されていれば、各イベントは `window.plausible()` を通じて送信されます。
