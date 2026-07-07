#!/bin/sh
# ladder-core.mjs から Obsidian プラグイン一式を生成する。
# Obsidian は vault/.obsidian/plugins/<id>/ の manifest.json + main.js(CommonJS) を読む。
# コアの `export` を剥がして main.js に埋め込むので、ビルドツールは不要。
#
# 使い方: sh obsidian-plugin.sh
#   → dist/obsidian/kvlist-ladder/ が完成品。丸ごと vault の .obsidian/plugins/ にコピーし、
#     Obsidian の設定 → Community plugins で "KV Ladder Viewer" を有効化する。
set -eu
dir=$(dirname "$(realpath "$0")")
out="$dir/dist/obsidian/kvlist-ladder"
mkdir -p "$out"
cp "$dir/obsidian/manifest.json" "$out/manifest.json"

{
  cat <<'HEADER'
/* GENERATED — 直接編集しない。
 * 生成元: ladder_viewer/ladder-core.mjs
 * 再生成: sh ladder_viewer/obsidian-plugin.sh
 *
 * ```kvlist コードブロック(KVニーモニック)をラダー図SVGとして描画する Obsidian プラグイン。
 * ホバーで同一デバイスをノート内の全ブロック横断でハイライト(クロスリファレンス)。 */
'use strict';
const { Plugin } = require('obsidian');

// ---------------- ladder-core (埋め込み) ----------------
HEADER

  sed 's/^export //' "$dir/ladder-core.mjs"

  cat <<'PLUGIN'

// ---------------- Obsidian アダプタ ----------------
class KvlistLadderPlugin extends Plugin {
  onload() {
    this.registerMarkdownCodeBlockProcessor('kvlist', (source, el) => {
      try {
        el.innerHTML = renderSVG(source);
        hydrate(el);
      } catch (e) {
        el.createEl
          ? el.createEl('pre', { text: 'kvlist render error: ' + (e && e.message ? e.message : e) })
          : (el.textContent = 'kvlist render error: ' + e);
      }
    });
  }
}
module.exports = KvlistLadderPlugin;
PLUGIN
} > "$out/main.js"

node --check "$out/main.js"
echo "generated: $out/"
ls "$out"
