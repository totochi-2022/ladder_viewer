// 実機ニーモニック（KV STUDIO エクスポート）由来の仕様のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, renderSVG } from '../ladder-core.mjs';

test('DEVICE: ヘッダと ;MODULE: メタ行は無視', () => {
  const { rungs } = parse('DEVICE:53\n;MODULE:テスト\n;MODULE_TYPE:0\nLD MR3013\nOUT MR2013\nEND\nENDH');
  assert.equal(rungs.length, 1);
  assert.equal(rungs[0].title, null); // MODULE: がタイトルにならない
  assert.equal(rungs[0].outs.length, 1); // DEVICE:53 が出力ボックスにならない
});

test(';<h1/> 見出しはタグを剥がしてタイトルに', () => {
  const { rungs } = parse(';<h1/>運転選択\nLD T4\nOUT MR5000');
  assert.equal(rungs[0].title, '運転選択');
});

test('CON: 出力ボックスの直列連結 (LDA→EXT→ADD→STA)', () => {
  const { rungs, errors } = parse(`
LD CR2002
LDA DM501
CON
EXT
CON
ADD.L +2
CON
STA DM501
`);
  assert.equal(errors.length, 0);
  assert.equal(rungs.length, 1);
  const outs = rungs[0].outs;
  assert.equal(outs.length, 1); // 縦積みでなく1行
  assert.equal(outs[0].t, 'ochain');
  assert.deepEqual(outs[0].ch.map((o) => o.op), ['LDA', 'EXT', 'ADD.L', 'STA']);
});

test('CON なしの連続出力は並列行のまま', () => {
  const { rungs } = parse('LD CR2002\nMOV.L W08 DM1000\nMOV W02C DM1002');
  assert.equal(rungs[0].outs.length, 2);
});

test('MEP: 演算結果のパルス化は条件側', () => {
  const { rungs } = parse('LD MR6013\nAND<>.L DM2500 W028\nMEP\nOUT Y0');
  const cond = rungs[0].cond;
  assert.equal(cond.t, 'ser');
  assert.equal(cond.ch[1].t, 'cmp');
  assert.equal(cond.ch[1].op, '<>.L'); // .L サフィックス保持
  assert.equal(cond.ch[2].t, 'pulse');
  assert.equal(cond.ch[2].edge, 'p');
});

test('LABEL は独立ラング（前のラングに合流しない）', () => {
  const { rungs } = parse('LD CR2002\nSTA DM501\nLABEL #1001\nLD A\nOUT Y0');
  assert.equal(rungs.length, 3);
  assert.equal(rungs[1].outs[0].op, 'LABEL');
  assert.equal(rungs[1].cond, null);
});

test('MDSTRT/MDSTOP はモジュール名オペランドの出力ボックス', () => {
  const { rungs } = parse('LD T4\nOUT MR5000\nMDSTRT 手動操作\nMDSTOP 自動運転');
  assert.equal(rungs[0].outs.length, 3);
  assert.equal(rungs[0].outs[1].dev, '手動操作');
});

test('数値・#・+・" はデバイス扱いしない', () => {
  const { rungs } = parse('LD A\n@SUB.L +10\nTMH T1 #100');
  assert.equal(rungs[0].outs[0].dev, null);
  assert.equal(rungs[0].outs[1].dev, 'T1');
});

// テスト1.mnm 由来: 1行スクリプト入りモジュールのエクスポート形式
const SCRIPT_EXPORT = `;SCRIPT_TYPE:
LD MR3013
OUT MR2013
;MR3012 =  1
LD MR3013
NCJ #1000
;MR3012 =  1
LD CR2002
OUT MR3012
LABEL #1000
;
END`;

test('スクリプトボックス: NCJ〜LABEL のコンパイル済みコードを原文ボックスに折り畳む', () => {
  const { rungs, errors } = parse(SCRIPT_EXPORT);
  assert.equal(errors.length, 0);
  assert.equal(rungs.length, 2); // [OUT MR2013] [MR3013→sbox] (LABEL/コンパイル済みは消える)
  const r = rungs[1];
  assert.equal(r.cond.dev, 'MR3013');
  assert.equal(r.outs[0].t, 'sbox');
  assert.deepEqual(r.outs[0].lines, ['MR3012 =  1']);
  assert.equal(r.title, null); // 原文の重複表示なし
});

test('foldScripts:false で生のコンパイル済みラダーを見られる', () => {
  const { rungs } = parse(SCRIPT_EXPORT, { foldScripts: false });
  assert.equal(rungs.length, 4);
  assert.equal(rungs[1].title, 'MR3012 =  1'); // 原文がNCJラングの見出しに
  assert.equal(rungs[2].outs[0].dev, 'MR3012');
});

test('複数ステートメントのスクリプトは1ボックスに集約', () => {
  const { rungs } = parse(`
LD CR2002
NCJ #1001
;DM501 = DM501+2
LD CR2002
LDA DM501
CON
ADD.L +2
CON
STA DM501
;DM501 = DM501+4
LD CR2002
LDA DM501
CON
ADD.L +4
CON
STA DM501
LABEL #1001`);
  assert.equal(rungs.length, 1);
  assert.deepEqual(rungs[0].outs[0].lines, ['DM501 = DM501+2', 'DM501 = DM501+4']);
});

test('原文コメントの無い手書き NCJ/LABEL は折り畳まない', () => {
  const { rungs } = parse('LD A\nNCJ #1\nLD B\nOUT Y0\nLABEL #1');
  assert.equal(rungs.length, 3);
});

test(';= 記法でスクリプトボックスを手書きできる', () => {
  const { rungs } = parse('LD MR3013\n;= IF DM100 > 0 THEN\n;=   DM102 = 0\n;= ENDIF');
  const o = rungs[0].outs[0];
  assert.equal(o.t, 'sbox');
  assert.deepEqual(o.lines, ['IF DM100 > 0 THEN', '  DM102 = 0', 'ENDIF']);
  const svg = renderSVG('LD MR3013\n;= DM102 = DM100 + 1');
  assert.ok(svg.includes('data-dev="DM102"')); // スクリプト内デバイスもクロスリファレンス対象
  assert.ok(svg.includes('data-dev="DM100"'));
});

test('連続コメント行は複数行タイトルに蓄積（インデントはtrimされる）', () => {
  const { rungs } = parse(';IF DM0 > 100 THEN\n;  DM2 = 0\n;ENDIF\nLD CR2002\nOUT Y0');
  assert.equal(rungs[0].title, 'IF DM0 > 100 THEN\nDM2 = 0\nENDIF');
});

test('1ラングにスクリプト2個は警告 (KV STUDIO の制約)', () => {
  const { errors } = parse('LD MR3013\n;= MR3012 = 1\n;\nOUT Y0\n;= MR3012 = 0');
  assert.ok(errors.some((e) => e.msg.includes('スクリプトボックスが2個')));
});

test('exportForPaste: スクリプトラング除外＋チェックリスト生成', async () => {
  const { exportForPaste } = await import('../ladder-core.mjs');
  const { ladder, scripts, errors } = exportForPaste(`; 自己保持
LD R000
OR MR000
ANB R001
OUT MR000
LD MR3013
AND MR3014
;= MR3012 = 1
LD MR3013
ANB MR3014
;= MR3012 = 0
LD MR3014
OUT Y001`);
  assert.equal(errors.length, 0);
  // スクリプトのみのラングはラダー部から除外される
  assert.ok(!ladder.includes('MR3013'));
  assert.ok(!ladder.includes(';='));
  assert.ok(ladder.includes('OUT MR000'));
  assert.ok(ladder.includes('OUT Y001'));
  // チェックリスト: 2ボックス、条件と本文が対応
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0].cond, 'LD MR3013\nAND MR3014');
  assert.deepEqual(scripts[0].lines, ['MR3012 = 1']);
  assert.equal(scripts[1].cond, 'LD MR3013\nANB MR3014');
  assert.deepEqual(scripts[1].lines, ['MR3012 = 0']);
});

// sample/ は実機由来の非公開データなのでリポジトリに無いことがある（その場合スキップ）
test('実機サンプル全ファイル: エラーゼロで parse + renderSVG が通る', (t) => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample');
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.mnm'));
  } catch {
    files = [];
  }
  if (!files.length) return t.skip('sample/*.mnm なし');
  const dec = new TextDecoder('shift_jis');
  for (const f of files) {
    const src = dec.decode(readFileSync(join(dir, f)));
    const { rungs, errors } = parse(src);
    assert.equal(errors.length, 0, `${f}: ${JSON.stringify(errors)}`);
    assert.ok(rungs.length > 0, `${f}: ラングが1つもない`);
    const svg = renderSVG(src);
    assert.ok(svg.startsWith('<svg'), `${f}: SVGが生成されない`);
  }
});
