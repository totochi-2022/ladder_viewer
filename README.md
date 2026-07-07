# ladder_viewer

KV STUDIO のニーモニックリスト（リスト編集 Ctrl+D でコピペできるテキスト）を
ラダー図 SVG として描画する、依存ゼロ・ビルド不要の JS ライブラリ。

markdown の ```` ```kvlist ```` コードブロックに貼ったニーモニックをそのまま図にする用途。
**ニーモニックが正、図は派生**（Claude との会話→図で目視確認→KV STUDIO へ貼り戻し、が
テキストで閉じる）。設計の詳細と対応命令は [SPEC.md](SPEC.md)。

## ファイル

| ファイル | 役割 |
|---|---|
| `ladder-core.mjs` | コア（ホスト非依存 ESM・依存ゼロ）: `parse` / `renderSVG` / `hydrate` |
| `ladder-diagram.mjs` | `<ladder-diagram>` Web Component アダプタ |
| `demo.html` | デモ（テキストエリア→即描画） |

## 試す

```sh
python3 -m http.server 8763   # ESM import のため file:// 不可
# → http://localhost:8763/demo.html
```

テスト:

```sh
node --test
```

## 使い方

### Web Component

```html
<script type="module" src="./ladder-diagram.mjs"></script>
<ladder-diagram>
LD    R000   ; 起動PB
OR    MR000
ANB   R001   ; 停止PB
OUT   MR000  ; 運転保持
</ladder-diagram>
```

JS から: `el.source = '...'`、デバイスコメント辞書は `el.comments = { R000: '起動PB' }`
（インライン `;` コメントが優先）。

### Vivify（このマシンの markdown プレビュー）

組み込み済み。```` ```kvlist ```` フェンスを書けばラダー図になる。
Vivify の `scripts` はインライン展開の classic script で ESM が使えないため、
コアから生成した `~/.config/nvim/vivify/scripts/ladder.glue.js` を注入している:

```sh
sh vivify-glue.sh   # ladder-core.mjs を変更したら再生成
```

### Obsidian プラグイン

配布物を生成して vault にコピーするだけ（ビルドツール不要）:

```sh
sh obsidian-plugin.sh
# → dist/obsidian/kvlist-ladder/ (manifest.json + main.js) が完成品
```

1. `dist/obsidian/kvlist-ladder/` フォルダを丸ごと vault の `.obsidian/plugins/` へコピー
2. Obsidian 設定 → コミュニティプラグイン → 「KV Ladder Viewer」を有効化
3. ノートの ```` ```kvlist ```` コードブロックが閲覧モードでラダー図になる

コアは main.js に埋め込まれるので、渡すのはこのフォルダ2ファイルだけでよい。
ダーク/ライトテーマは `currentColor` 経由で自動追従。

### コア API 直叩き（自作ホスト等）

```js
import { renderSVG, hydrate } from './ladder-core.mjs';

this.registerMarkdownCodeBlockProcessor('kvlist', (src, el) => {
  el.innerHTML = renderSVG(src, { comments: myDict });
  hydrate(el);   // ホバーで同一デバイスを全ブロック横断ハイライト
});
```

### テーマ / 色

線と文字はすべて `currentColor` — ホスト側の文字色に自動追従する。
ハイライト色だけ CSS 変数で上書き可能:

```css
:root { --ladder-hl: #0a84ff; --ladder-err: #e5484d; }
```

## 注意

命令仕様（ANB=b接点、ANL/ORL=ブロック結合、MPS/MRD/MPP=分岐 等）は記憶ベースの実装。
**KV STUDIO のリスト編集の実物出力が正**なので、実物のエクスポートで検証するまでは
細部が違う可能性がある。相違を見つけたら `ladder-core.mjs` を直して実物を
`test/` にテストケースとして追加する。
