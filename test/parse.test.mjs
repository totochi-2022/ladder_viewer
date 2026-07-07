import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, renderSVG } from '../ladder-core.mjs';

test('自己保持回路: (R000∥MR000)・¬R001 → OUT MR000', () => {
  const { rungs, labels, errors } = parse(`
LD    R000   ; 起動PB
OR    MR000
ANB   R001   ; 停止PB
OUT   MR000  ; 運転保持
`);
  assert.equal(errors.length, 0);
  assert.equal(rungs.length, 1);
  const r = rungs[0];
  assert.equal(r.cond.t, 'ser');
  assert.equal(r.cond.ch.length, 2);
  const [p, b] = r.cond.ch;
  assert.equal(p.t, 'par');
  assert.deepEqual(p.ch.map((c) => c.dev), ['R000', 'MR000']);
  assert.equal(b.t, 'ct');
  assert.equal(b.dev, 'R001');
  assert.equal(b.neg, true);
  assert.deepEqual(r.outs, [{ t: 'coil', kind: 'OUT', dev: 'MR000', cmt: '運転保持' }]);
  assert.equal(labels.R000, '起動PB');
  assert.equal(labels.MR000, '運転保持');
});

test('OR は直前の LD 以降のブロック全体と並列 (IL意味論)', () => {
  const { rungs } = parse('LD A\nAND B\nOR C\nOUT Y');
  const cond = rungs[0].cond;
  assert.equal(cond.t, 'par');
  assert.equal(cond.ch[0].t, 'ser'); // A・B
  assert.equal(cond.ch[1].dev, 'C');
});

test('ANL: ブロック直列結合', () => {
  const { rungs, errors } = parse('LD A\nLD B\nOR C\nANL\nOUT Y');
  assert.equal(errors.length, 0);
  const cond = rungs[0].cond;
  assert.equal(cond.t, 'ser');
  assert.equal(cond.ch[0].dev, 'A');
  assert.equal(cond.ch[1].t, 'par');
});

test('ORL: ブロック並列結合', () => {
  const { rungs } = parse('LD A\nAND B\nLD C\nAND D\nORL\nOUT Y');
  const cond = rungs[0].cond;
  assert.equal(cond.t, 'par');
  assert.equal(cond.ch[0].t, 'ser');
  assert.equal(cond.ch[1].t, 'ser');
});

test('MPS/MRD/MPP: 3分岐の fork', () => {
  const { rungs, errors } = parse(`
LD A
MPS
AND B
OUT Y0
MRD
AND C
OUT Y1
MPP
OUT Y2
`);
  assert.equal(errors.length, 0);
  const r = rungs[0];
  assert.equal(r.cond.dev, 'A');
  assert.equal(r.fork.br.length, 3);
  assert.equal(r.fork.br[0].cond.dev, 'B');
  assert.equal(r.fork.br[0].outs[0].dev, 'Y0');
  assert.equal(r.fork.br[1].cond.dev, 'C');
  assert.equal(r.fork.br[2].cond, null);
  assert.equal(r.fork.br[2].outs[0].dev, 'Y2');
});

test('ネストした MPS', () => {
  const { rungs, errors } = parse(`
LD A
MPS
AND B
MPS
AND C
OUT Y0
MPP
AND D
OUT Y1
MRD
AND E
OUT Y2
`);
  assert.equal(errors.length, 0);
  const r = rungs[0];
  assert.equal(r.fork.br.length, 2);
  const b1 = r.fork.br[0]; // B の枝、その中に内側 fork
  assert.equal(b1.cond.dev, 'B');
  assert.equal(b1.fork.br.length, 2);
  assert.equal(b1.fork.br[0].cond.dev, 'C');
  assert.equal(b1.fork.br[1].cond.dev, 'D');
  assert.equal(r.fork.br[1].cond.dev, 'E');
});

test('未知命令 → 出力ボックスにフォールバック', () => {
  const { rungs, errors } = parse('LD A\nTMR T000 #100');
  assert.equal(errors.length, 0);
  const o = rungs[0].outs[0];
  assert.equal(o.t, 'obox');
  assert.equal(o.op, 'TMR');
  assert.equal(o.dev, 'T000'); // # 付きはデバイスとみなさない
});

test('比較命令は条件側ボックス', () => {
  const { rungs } = parse('LD= DM0 #5\nAND< DM1 DM2\nOUT Y');
  const cond = rungs[0].cond;
  assert.equal(cond.t, 'ser');
  assert.equal(cond.ch[0].t, 'cmp');
  assert.equal(cond.ch[0].op, '=');
  assert.equal(cond.ch[1].op, '<');
});

test('新しい LD でラング区切り / 行コメントはタイトル', () => {
  const { rungs } = parse('; ポンプ起動\nLD A\nOUT Y0\nLD B\nOUT Y1');
  assert.equal(rungs.length, 2);
  assert.equal(rungs[0].title, 'ポンプ起動');
  assert.equal(rungs[1].title, null);
});

test('連続 OUT は並列コイル', () => {
  const { rungs } = parse('LD A\nOUT Y0\nOUT Y1');
  assert.equal(rungs.length, 1);
  assert.equal(rungs[0].outs.length, 2);
});

test('エッジ接点 LDP/ANF', () => {
  const { rungs } = parse('LDP A\nANF B\nOUT Y');
  const cond = rungs[0].cond;
  assert.equal(cond.ch[0].edge, 'p');
  assert.equal(cond.ch[1].edge, 'f');
});

test('壊れた入力でも例外を投げない (レニエント)', () => {
  const { errors } = parse('ANL\nMPP\nORL\nMRD\nOUT');
  assert.ok(errors.length >= 3);
  assert.doesNotThrow(() => renderSVG('ANL\nMPP\nゴミ 入力 ;;;'));
});

test('renderSVG スモーク', () => {
  const svg = renderSVG('LD R000 ; 起動PB\nOR MR000\nANB R001\nOUT MR000');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('data-dev="R000"'));
  assert.ok(svg.includes('起動PB'));
  assert.ok((svg.match(/data-dev="MR000"/g) || []).length === 2); // 接点+コイル
});

test('renderSVG: opts.comments はインラインより弱い', () => {
  const svg = renderSVG('LD R000 ; インライン\nAND R001\nOUT Y0', {
    comments: { R000: 'CSV側', R001: 'CSVのみ' },
  });
  assert.ok(svg.includes('インライン'));
  assert.ok(!svg.includes('CSV側'));
  assert.ok(svg.includes('CSVのみ'));
});

test('空入力', () => {
  const { rungs } = parse('');
  assert.equal(rungs.length, 0);
  assert.ok(renderSVG('').includes('(empty)'));
});
