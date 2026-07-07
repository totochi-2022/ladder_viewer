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
