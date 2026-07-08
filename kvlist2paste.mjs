#!/usr/bin/env node
// kvlist(;= スクリプト記法) → KV STUDIO 貼り戻しキット
//
// KV STUDIO はリスト編集へのテキスト貼り付け不可(GUI内クリップボードは独自形式)、
// .mnm 読み込みは上書き不可。よって戻し経路は:
//   .mnm 生成 → KV STUDIO でモジュール削除 → 読み込み → スクリプトはGUIで手貼り
//
// 使い方:
//   node kvlist2paste.mjs ノート.kvlist                 # ①②を stdout に表示
//   node kvlist2paste.mjs --mnm 出力.mnm ノート.kvlist  # KV STUDIO 読み込み用 .mnm を生成
//        --module 名前   モジュール名 (省略時は出力ファイル名から)
//        --device 53     DEVICE ヘッダ値 (機種コード、既定 53)
//        --dummy MR9999  スクリプトラングの右側を埋めるダミー出力先 (要・空きデバイス)
//   node kvlist2paste.mjs --clip ノート.kvlist          # ①を Windows クリップボードへ
//        (KV STUDIO には貼れない。チャット等へ渡す用)
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportForPaste } from './ladder-core.mjs';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const useClip = argv.includes('--clip');
const mnmPath = opt('--mnm');
const device = opt('--device') ?? '53';
const dummy = opt('--dummy') ?? 'MR9999';
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--mnm', '--module', '--device', '--dummy'].includes(argv[i - 1]));
const file = positional[0];

const src = readFileSync(file ?? 0, 'utf8');
const { ladder, scripts, errors } = exportForPaste(src, { dummy });

for (const e of errors) {
  console.error(`⚠ ${e.line ? `L${e.line}: ` : ''}${e.msg}`);
}

if (mnmPath) {
  // KV STUDIO エクスポート互換の .mnm (CP932 + CRLF + ヘッダ)
  const moduleName = opt('--module') ?? basename(mnmPath).replace(/\.[^.]*$/, '');
  const body = [`DEVICE:${device}`, `;MODULE:${moduleName}`, ';MODULE_TYPE:0', ladder, 'END', 'ENDH'].join('\n');
  const crlf = body.split('\n').join('\r\n') + '\r\n';
  const r = spawnSync('iconv', ['-f', 'UTF-8', '-t', 'CP932'], { input: Buffer.from(crlf, 'utf8') });
  if (r.error || r.status !== 0) {
    writeFileSync(mnmPath, crlf);
    console.error('⚠ iconv が使えないため UTF-8 のまま出力しました (KV STUDIO は CP932 想定)');
  } else {
    writeFileSync(mnmPath, r.stdout);
  }
  console.log(`.mnm 生成: ${mnmPath} (モジュール名: ${moduleName}, DEVICE:${device}, CP932+CRLF)`);
  console.log('KV STUDIO: 既存モジュールを削除 → 読み込み で取り込み');
} else if (useClip) {
  // Windows クリップボードは内部 UTF-16。BOM 付き UTF-16LE + CRLF なら文字化けしない
  const text = ladder.split('\n').join('\r\n') + '\r\n';
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const r = spawnSync('clip.exe', [], { input: buf });
  if (r.error || r.status !== 0) {
    console.error('clip.exe に渡せませんでした (WSL 以外?)。--clip なしで実行してください');
    process.exit(1);
  }
  console.log(`① ラダー部 ${ladder.split('\n').length} 行をクリップボードに入れました`);
} else {
  console.log('======== ① ラダー部 ========');
  console.log(ladder);
}

if (scripts.length) {
  console.log('');
  console.log('======== ② スクリプトボックス（GUIで配置して本文を貼る） ========');
  scripts.forEach((s, k) => {
    console.log(`--- ${k + 1}個目: 条件↓のラングのダミー OUT を削除し、スクリプトボックスに置き換え ---`);
    console.log(s.cond ?? '(条件なし: 左レール直結)');
    console.log('--- ボックス本文 ---');
    console.log(s.lines.join('\n'));
    console.log('');
  });
}
