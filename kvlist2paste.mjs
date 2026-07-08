#!/usr/bin/env node
// kvlist(;= スクリプト記法) → KV STUDIO 貼り戻しキット
//
// 使い方:
//   node kvlist2paste.mjs ノート.kvlist     # ファイルから
//   ... | node kvlist2paste.mjs            # stdin から (md の kvlist フェンス中身を渡す)
//
// 出力: ①リスト編集へペーストする純ラダー部 ②スクリプトボックス設置チェックリスト
import { readFileSync } from 'node:fs';
import { exportForPaste } from './ladder-core.mjs';

const src = readFileSync(process.argv[2] ?? 0, 'utf8');
const { ladder, scripts, errors } = exportForPaste(src);

for (const e of errors) {
  console.error(`⚠ ${e.line ? `L${e.line}: ` : ''}${e.msg}`);
}

console.log('======== ① リスト編集へペースト（Ctrl+D → 貼り付け → ブロック置換） ========');
console.log(ladder);
if (scripts.length) {
  console.log('');
  console.log('======== ② スクリプトボックス（GUIで配置して本文を貼る） ========');
  scripts.forEach((s, k) => {
    console.log(`--- ${k + 1}個目: 条件↓のラングを作成し、右にスクリプトボックスを配置 ---`);
    console.log(s.cond ?? '(条件なし: 左レール直結)');
    console.log('--- ボックス本文 ---');
    console.log(s.lines.join('\n'));
    console.log('');
  });
}
