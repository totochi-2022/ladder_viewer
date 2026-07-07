#!/bin/sh
# ladder-core.mjs から Vivify 用グルー (classic script) を生成する。
# Vivify の config.json "scripts" はページ末尾にインライン展開されるため ESM が使えない。
# コアの `export` を剥がして IIFE に包み、kvlist フェンス描画を後付けする。
#
# 使い方: sh vivify-glue.sh   → ~/.config/nvim/vivify/scripts/ladder.glue.js を再生成
set -eu
dir=$(dirname "$(realpath "$0")")
core="$dir/ladder-core.mjs"
out="$HOME/.config/nvim/vivify/scripts/ladder.glue.js"

{
  cat <<'HEADER'
/* GENERATED — 直接編集しない。
 * 生成元: ~/work/ladder_viewer/ladder-core.mjs
 * 再生成: sh ~/work/ladder_viewer/vivify-glue.sh
 *
 * ```kvlist フェンス(KVニーモニック)をラダー図SVGとして描画する Vivify glue。
 * highlight.ts パッチにより <pre class="language-kvlist"><code>… で来る。
 * 初期描画 + ws UPDATE(#body-content 差し替え)を MutationObserver で追従。 */
(function () {
    'use strict';
HEADER

  # ---- コア本体（export を剥がして埋め込み） ----
  sed 's/^export //' "$core"

  cat <<'GLUE'

    // ---------------- Vivify glue 部分 ----------------
    function fenceText(pre) {
        var code = pre.querySelector('code');
        return code ? code.textContent : pre.textContent;
    }

    function renderKvlist(pre) {
        try {
            var div = document.createElement('div');
            div.className = 'viv-ladder';
            div.innerHTML = renderSVG(fenceText(pre));
            pre.replaceWith(div);
            hydrate(div);
        } catch (e) {
            var p = document.createElement('pre');
            p.style.color = '#e06c75';
            p.style.whiteSpace = 'pre-wrap';
            p.textContent = 'kvlist render error: ' + (e && e.message ? e.message : e);
            pre.replaceWith(p);
        }
    }

    function processAll(root) {
        (root || document).querySelectorAll('pre.language-kvlist').forEach(renderKvlist);
    }

    function run() {
        processAll(document);
        var container = document.getElementById('body-content');
        if (!container) return;
        var pending = false;
        new MutationObserver(function () {
            if (pending) return;
            pending = true;
            setTimeout(function () { pending = false; processAll(container); }, 0);
        }).observe(container, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
GLUE
} > "$out"

node --check "$out"
echo "generated: $out"
