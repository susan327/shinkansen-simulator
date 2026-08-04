# 新幹線ATCシミュレーター

GitHub Pages向け公開版  
`v74.4.3-alpha21-route-strip-step2x-mobile1`

## 起動

GitHub Pagesではルートの `index.html` を開き、30 FPSまたは60 FPSを選択します。
スマートフォン・タブレットでは横画面を推奨します。

## 公開用ファイル

- `index.html` — タイトル・描画モード選択
- `simulator.html` — シミュレーター本体
- `train-visual-viewer.html` — 本体からリンクされる車両3Dビュアー
- `css/` — 画面・運転台・レスポンシブ用CSS
- `js/` — ATC、物理、車両、駅、景観、UI
- `project.json` — バージョン情報
- `.nojekyll` — GitHub Pagesの不要なJekyll処理を無効化

## キャッシュ対策

ローカルCSS/JSのURLに、この公開版固有のクエリキーを付けています。
次回更新時は `mobile1` を `mobile2` のように変更すると、端末に古いCSS/JSが残りにくくなります。

## CDN

Three.jsは外部CDNから読み込みます。初回起動にはインターネット接続が必要です。
