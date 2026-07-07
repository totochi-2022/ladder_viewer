// ladder-core.mjs — KVニーモニック → ラダー図SVG（ホスト非依存・依存ゼロ）
//
//   parse(source)            ニーモニック → ラング列（直並列木）
//   renderSVG(source, opts)  → SVG文字列（色は currentColor、テーマはホスト任せ）
//   hydrate(containerEl)     ホバーで同一デバイスを全ラング一斉ハイライト
//
// 命令仕様は記憶ベース（SPEC.md参照）。KV STUDIOリスト編集の実物出力が正なので、
// 相違が見つかったらここを直しテストケースに実物を追加する。

// 条件側として扱う応用命令（遅延追記用）。例: CONDITION_OPS.add('DIFU')
export const CONDITION_OPS = new Set();
// 描画しない命令
export const IGNORE_OPS = new Set(['END', 'ENDH', 'NOP']);

const RE_CMP = /^(LD|AND|OR)(<>|<=|>=|=|<|>)(\.[A-Z]+)?$/; // 比較（.L 等のサフィックス付き可）
const RE_COIL = /^(OUT|SET|RES|RST)$/;
// デバイスらしい引数（#100, +10, "文字列", 数値 は除外。日本語モジュール名は許容）
const RE_NOT_DEV = /^[#+\-"0-9]/;

// 接点命令 → [スタック動作, 修飾]（KV流: b接点は LDB/ANB/ORB、エッジは P/F）
const CT_OPS = {
  LD: ['LD', null], LDB: ['LD', 'B'], LDP: ['LD', 'p'], LDF: ['LD', 'f'],
  AND: ['AND', null], ANB: ['AND', 'B'], ANP: ['AND', 'p'], ANF: ['AND', 'f'],
  OR: ['OR', null], ORB: ['OR', 'B'], ORP: ['OR', 'p'], ORF: ['OR', 'f'],
};

// ---------------------------------------------------------------- 木の構築

function unwrap(n) {
  while (n && n.t === 'ser' && n.ch.length === 1) n = n.ch[0];
  return n;
}

function ser(children) {
  const ch = [];
  for (let c of children) {
    c = unwrap(c);
    if (c.t === 'ser') ch.push(...c.ch);
    else ch.push(c);
  }
  return ch.length === 1 ? ch[0] : { t: 'ser', ch };
}

function par(children) {
  const ch = [];
  for (let c of children) {
    c = unwrap(c);
    if (c.t === 'par') ch.push(...c.ch);
    else ch.push(c);
  }
  return ch.length === 1 ? ch[0] : { t: 'par', ch };
}

// ---------------------------------------------------------------- パーサ

export function parse(source) {
  const rungs = [];
  const labels = Object.create(null); // dev → インラインコメント（初出優先）
  const errors = [];

  const newCtx = () => ({ stack: [], outs: [], fork: null, forkClosing: false, conPending: false });
  let ctxs = [newCtx()];
  let title = null;

  const cur = () => ctxs[ctxs.length - 1];
  const joinStack = (stack) => (stack.length ? ser(stack) : null);
  const branchOf = (c) => ({ cond: joinStack(c.stack), fork: c.fork, outs: c.outs });
  const baseEmpty = () => {
    const b = ctxs[0];
    return ctxs.length === 1 && !b.stack.length && !b.outs.length && !b.fork;
  };

  function closeInnermost() {
    const c = ctxs.pop();
    cur().fork.br.push(branchOf(c));
    while (cur().forkClosing && ctxs.length > 1) {
      const p = ctxs.pop();
      p.forkClosing = false;
      cur().fork.br.push(branchOf(p));
    }
  }

  function endRung() {
    while (ctxs.length > 1) {
      const c = ctxs.pop();
      cur().fork.br.push(branchOf(c));
    }
    const b = ctxs[0];
    if (b.stack.length || b.outs.length || b.fork) {
      rungs.push({ title, ...branchOf(b) });
    }
    ctxs = [newCtx()];
    title = null;
  }

  const lines = String(source ?? '').split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    const ci = raw.indexOf(';');
    const cmt = ci >= 0 ? raw.slice(ci + 1).trim() || null : null;
    const code = (ci >= 0 ? raw.slice(0, ci) : raw).trim();

    if (!code) {
      // ラング直前の行コメント → タイトル（KVの ;MODULE: メタ行は除外、;<h1/> 見出しタグは剥がす）
      if (cmt !== null && baseEmpty() && !/^MODULE(_TYPE)?:/.test(cmt)) {
        title = cmt.replace(/^<h\d+\/>\s*/, '') || null;
      }
      continue;
    }

    const parts = code.split(/\s+/);
    const op = parts[0].toUpperCase();
    const args = parts.slice(1);

    if (IGNORE_OPS.has(op) || /^DEVICE:/.test(op)) { // DEVICE:53 はファイルヘッダ
      if (op === 'END' || op === 'ENDH') endRung();
      continue;
    }

    const mCmp = op.match(RE_CMP);
    const ct = mCmp ? null : CT_OPS[op];

    if (mCmp || ct) {
      // 出力確定後の LD は新しいラング（MPP後の最終分岐が開いたままでも区切る）
      const kind = mCmp ? mCmp[1] : ct[0];
      if (kind === 'LD' && cur().outs.length) endRung();
      let node;
      if (mCmp) {
        node = { t: 'cmp', op: mCmp[2] + (mCmp[3] || ''), args, cmt };
      } else {
        const dev = args[0] || '?';
        node = {
          t: 'ct', dev,
          neg: ct[1] === 'B',
          edge: ct[1] === 'p' || ct[1] === 'f' ? ct[1] : null,
          cmt,
        };
        if (cmt && labels[dev] === undefined) labels[dev] = cmt;
      }
      const c = cur();
      if (kind === 'LD' || !c.stack.length) {
        c.stack.push(node);
      } else if (kind === 'AND') {
        c.stack.push(ser([c.stack.pop(), node]));
      } else { // OR: 直前のLD以降のブロック全体と並列
        c.stack.push(par([c.stack.pop(), node]));
      }
      continue;
    }

    if (op === 'MEP' || op === 'MEF') { // 現在の演算結果をパルス化（条件側・オペランドなし）
      const node = { t: 'pulse', edge: op === 'MEP' ? 'p' : 'f' };
      const c = cur();
      c.stack.push(c.stack.length ? ser([c.stack.pop(), node]) : node);
      continue;
    }

    if (op === 'CON') { // 直前の出力ボックスと次の出力を直列接続（LDA→演算→STA 等）
      cur().conPending = true;
      continue;
    }

    if (op === 'LABEL') { // ジャンプ先ラベルは独立した1ラング
      endRung();
      cur().outs.push({ t: 'obox', op, args, dev: null, cmt });
      endRung();
      continue;
    }

    if (op === 'ANL' || op === 'ORL') { // ブロック結合（オペランドなし）
      const c = cur();
      if (c.stack.length >= 2) {
        const b = c.stack.pop(), a = c.stack.pop();
        c.stack.push(op === 'ANL' ? ser([a, b]) : par([a, b]));
      } else if (op === 'ANL' && c.stack.length === 1 && ctxs.length > 1) {
        // MPS保存値との直列結合（MPS → LD… → ANL → OUT の実機パターン）。
        // 保存値＝分岐プレフィックスは fork 側で描画されるので、ここでは何もしない
      } else {
        errors.push({ line: ln + 1, msg: `${op}: ブロックが2つ必要` });
      }
      continue;
    }

    if (op === 'MPS') {
      const c = cur();
      if (c.fork) {
        errors.push({ line: ln + 1, msg: 'MPS: この段の分岐は確定済み' });
      } else {
        c.fork = { t: 'fork', br: [] };
        ctxs.push(newCtx());
      }
      continue;
    }

    if (op === 'MRD' || op === 'MPP') {
      if (ctxs.length < 2) {
        errors.push({ line: ln + 1, msg: `${op}: 対応するMPSがない` });
        continue;
      }
      closeInnermost();
      if (op === 'MPP') cur().forkClosing = true;
      ctxs.push(newCtx());
      continue;
    }

    // CON 指定があれば直前の出力行に直列連結、なければ新しい並列行
    const pushOut = (item) => {
      const c = cur();
      if (c.conPending && c.outs.length) {
        const last = c.outs.pop();
        if (last.t === 'ochain') last.ch.push(item);
        c.outs.push(last.t === 'ochain' ? last : { t: 'ochain', ch: [last, item] });
      } else {
        c.outs.push(item);
      }
      c.conPending = false;
    };

    if (RE_COIL.test(op)) {
      const dev = args[0] || '?';
      pushOut({ t: 'coil', kind: op === 'RST' ? 'RES' : op, dev, cmt });
      if (cmt && labels[dev] === undefined) labels[dev] = cmt;
      continue;
    }

    if (CONDITION_OPS.has(op)) { // 分類表で条件側と指定された応用命令 → 直列ボックス
      const node = { t: 'cmp', op, args, cmt };
      const c = cur();
      c.stack.push(c.stack.length ? ser([c.stack.pop(), node]) : node);
      continue;
    }

    // 未知命令＋オペランドn個 → 出力側ボックス（汎用フォールバック）
    const dev = args.find((a) => !RE_NOT_DEV.test(a)) || null;
    pushOut({ t: 'obox', op, args, dev, cmt });
    if (cmt && dev && labels[dev] === undefined) labels[dev] = cmt;
  }
  endRung();

  return { rungs, labels, errors };
}

// ---------------------------------------------------------------- レイアウト

const CW = 100;  // セル幅 px
const RH = 60;   // 行高 px
const PAD = 14;
const TITLE_H = 20;
const GAP = 10;  // ラング間

function width(n) { // セル数
  switch (n.t) {
    case 'ct': case 'coil': case 'pulse': return 1;
    case 'cmp': return 2;
    case 'obox': return n.args.length ? 2 : 1; // EXT 等の引数なしボックスは幅1
    case 'ser': case 'ochain': return n.ch.reduce((s, c) => s + width(c), 0);
    case 'par': return Math.max(...n.ch.map(width));
    default: return 1;
  }
}

function height(n) { // 行数
  switch (n.t) {
    case 'ser': case 'ochain': return Math.max(...n.ch.map(height));
    case 'par': return n.ch.reduce((s, c) => s + height(c), 0);
    default: return 1;
  }
}

function groupSize(g) { // g = {cond, fork, outs}
  const condW = g.cond ? width(g.cond) : 0;
  const condH = g.cond ? height(g.cond) : 1;
  if (g.fork) {
    const brs = g.fork.br.map(groupSize);
    const forkW = Math.max(1, ...brs.map((b) => b.w));
    const forkH = brs.reduce((s, b) => s + b.h, 0) || 1;
    return { w: condW + forkW, h: Math.max(condH, forkH + g.outs.length) };
  }
  const outsW = g.outs.length ? Math.max(...g.outs.map(width)) : 0;
  return { w: condW + outsW, h: Math.max(condH, g.outs.length, 1) };
}

// ---------------------------------------------------------------- SVG生成

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
.ladder-svg{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ladder-svg text{fill:currentColor;stroke:none}
.ladder-svg .lad-wire{stroke:currentColor;stroke-width:1.3;fill:none}
.ladder-svg .lad-sym{stroke:currentColor;stroke-width:1.6;fill:none}
.ladder-svg .lad-rail{stroke:currentColor;stroke-width:2.2;fill:none}
.ladder-svg .lad-dev{font-size:12px;text-anchor:middle}
.ladder-svg .lad-cmt{font-size:10px;opacity:.72;text-anchor:middle}
.ladder-svg .lad-boxtext{font-size:11px;text-anchor:middle}
.ladder-svg .lad-mark{font-size:10px;text-anchor:middle}
.ladder-svg .lad-title{font-size:11px;opacity:.8}
.ladder-svg .lad-err{font-size:11px;fill:var(--ladder-err,#e5484d)}
.ladder-svg .lad-hl{color:var(--ladder-hl,#e5484d)}
.ladder-svg .lad-hl .lad-sym{stroke-width:2.6}
`.trim();

export function renderSVG(source, opts = {}) {
  const { rungs, labels, errors } = parse(source);
  const label = (n) =>
    n.cmt || (n.dev != null && (labels[n.dev] ?? opts.comments?.[n.dev])) || null;

  const sizes = rungs.map(groupSize);
  const totalCols = Math.max(3, ...sizes.map((s) => s.w));
  const railL = PAD + 4;
  const railR = railL + totalCols * CW;
  const out = [];

  const hline = (x1, x2, y, cls = 'lad-wire') => {
    if (x2 > x1) out.push(`<line class="${cls}" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`);
  };
  const vline = (x, y1, y2, cls = 'lad-wire') => {
    if (y2 > y1) out.push(`<line class="${cls}" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>`);
  };
  const text = (x, y, cls, s) => {
    if (s) out.push(`<text class="${cls}" x="${x}" y="${y}">${esc(s)}</text>`);
  };
  const openEl = (cls, dev, titleText) => {
    out.push(`<g class="lad-el ${cls}"${dev != null ? ` data-dev="${esc(dev)}"` : ''}>`);
    if (titleText) out.push(`<title>${esc(titleText)}</title>`);
  };
  const hitRect = (x, y, w) => {
    out.push(`<rect x="${x}" y="${y - RH / 2}" width="${w}" height="${RH}" fill="none" pointer-events="all"/>`);
  };

  function drawContact(n, x, y) {
    const cx = x + CW / 2;
    const lbl = label(n);
    openEl('lad-contact', n.dev, lbl ? `${n.dev}: ${lbl}` : n.dev);
    hitRect(x, y, CW);
    hline(x, cx - 7, y);
    hline(cx + 7, x + CW, y);
    vline(cx - 7, y - 11, y + 11, 'lad-sym');
    vline(cx + 7, y - 11, y + 11, 'lad-sym');
    if (n.neg) out.push(`<line class="lad-sym" x1="${cx - 9}" y1="${y + 11}" x2="${cx + 9}" y2="${y - 11}"/>`);
    if (n.edge) text(cx, y + 4, 'lad-mark', n.edge === 'p' ? '↑' : '↓');
    text(cx, y - 17, 'lad-dev', n.dev);
    text(cx, y + 25, 'lad-cmt', lbl);
    out.push('</g>');
  }

  function drawBox(n, x, y, w, boxCls) {
    const bw = w - 16;
    const lbl = label(n);
    const body = `${n.op} ${n.args.join(' ')}`.trim();
    openEl(boxCls, n.dev ?? n.args?.[0], lbl ? `${body}: ${lbl}` : body);
    hitRect(x, y, w);
    hline(x, x + 8, y);
    hline(x + w - 8, x + w, y);
    out.push(`<rect class="lad-sym" x="${x + 8}" y="${y - 14}" width="${bw}" height="28" rx="2"/>`);
    text(x + w / 2, y + 4, 'lad-boxtext', body);
    text(x + w / 2, y + 25, 'lad-cmt', lbl);
    out.push('</g>');
  }

  function drawCoil(n, x, y) {
    const cx = x + CW / 2;
    const lbl = label(n);
    openEl('lad-coil', n.dev, lbl ? `${n.dev}: ${lbl}` : n.dev);
    hitRect(x, y, CW);
    hline(x, cx - 9, y);
    hline(cx + 9, x + CW, y);
    out.push(`<circle class="lad-sym" cx="${cx}" cy="${y}" r="9"/>`);
    if (n.kind !== 'OUT') text(cx, y + 4, 'lad-mark', n.kind === 'SET' ? 'S' : 'R');
    text(cx, y - 17, 'lad-dev', n.dev);
    text(cx, y + 25, 'lad-cmt', lbl);
    out.push('</g>');
  }

  function drawPulse(n, x, y) { // MEP/MEF: 演算結果のパルス化
    const cx = x + CW / 2;
    out.push('<g class="lad-el lad-pulse">');
    hline(x, cx - 7, y);
    hline(cx + 7, x + CW, y);
    vline(cx - 7, y - 11, y + 11, 'lad-sym');
    vline(cx + 7, y - 11, y + 11, 'lad-sym');
    text(cx, y + 4, 'lad-mark', n.edge === 'p' ? '↑' : '↓');
    text(cx, y - 17, 'lad-dev', n.edge === 'p' ? 'MEP' : 'MEF');
    out.push('</g>');
  }

  function drawNode(n, x, y) {
    switch (n.t) {
      case 'ct': return drawContact(n, x, y);
      case 'pulse': return drawPulse(n, x, y);
      case 'cmp': return drawBox(n, x, y, width(n) * CW, 'lad-cmp');
      case 'ser': {
        let cx = x;
        for (const c of n.ch) {
          drawNode(c, cx, y);
          cx += width(c) * CW;
        }
        return;
      }
      case 'par': {
        const pw = width(n) * CW;
        let ry = y, lastY = y;
        for (const c of n.ch) {
          drawNode(c, x, ry);
          const cw = width(c) * CW;
          hline(x + cw, x + pw, ry);
          lastY = ry;
          ry += height(c) * RH;
        }
        vline(x, y, lastY);
        vline(x + pw, y, lastY);
        return;
      }
    }
  }

  function drawOut(o, x, y) {
    if (o.t === 'coil') drawCoil(o, x, y);
    else if (o.t === 'ochain') { // CON で直列連結された出力ボックス列
      let cx = x;
      for (const item of o.ch) {
        drawOut(item, cx, y);
        cx += width(item) * CW;
      }
    } else drawBox(o, x, y, width(o) * CW, 'lad-obox');
  }

  function drawGroup(g, x, y) { // g = {cond, fork, outs}
    let cx = x;
    if (g.cond) {
      drawNode(g.cond, cx, y);
      cx += width(g.cond) * CW;
    }
    if (g.fork) {
      const brs = g.fork.br.slice();
      if (g.outs.length) brs.push({ cond: null, fork: null, outs: g.outs }); // レニエント
      let by = y, lastY = y;
      for (const br of brs) {
        drawGroup(br, cx, by);
        lastY = by;
        by += groupSize(br).h * RH;
      }
      vline(cx, y, lastY);
      return;
    }
    if (g.outs.length) {
      const outsW = Math.max(...g.outs.map(width)) * CW;
      const outsX = railR - outsW;
      hline(cx, outsX, y);
      let oy = y, lastY = y;
      for (const o of g.outs) {
        const ow = width(o) * CW;
        hline(outsX, railR - ow, oy);
        drawOut(o, railR - ow, oy);
        lastY = oy;
        oy += RH;
      }
      vline(outsX, y, lastY);
    } else if (g.cond) {
      hline(cx, railR, y); // 出力なし: 右レールまでワイヤ
    }
  }

  // 本体
  let y = PAD;
  const body = [];
  for (let i = 0; i < rungs.length; i++) {
    const r = rungs[i];
    out.length = 0;
    if (r.title) {
      text(railL + 2, y + 12, 'lad-title', `; ${r.title}`);
      y += TITLE_H;
    }
    drawGroup(r, railL, y + RH / 2);
    body.push(out.join(''));
    y += sizes[i].h * RH + GAP;
  }
  out.length = 0;
  for (const e of errors) {
    text(railL + 2, y + 12, 'lad-err', `⚠ L${e.line}: ${e.msg}`);
    y += 16;
  }
  if (!rungs.length && !errors.length) {
    text(railL + 2, y + 12, 'lad-cmt', '(empty)');
    y += 16;
  }
  body.push(out.join(''));

  const H = y + PAD;
  const W = railR + PAD + 4;
  const rails = rungs.length
    ? `<line class="lad-rail" x1="${railL}" y1="${PAD}" x2="${railL}" y2="${H - PAD}"/>` +
      `<line class="lad-rail" x1="${railR}" y1="${PAD}" x2="${railR}" y2="${H - PAD}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" class="ladder-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<style>${STYLE}</style>${rails}${body.join('')}</svg>`;
}

// ---------------------------------------------------------------- hydrate

// ホバーで同一デバイスの接点・コイルを文書内の全ラダーで一斉ハイライト。
// スコープは document 全体（複数の kvlist ブロック間でも効く）。
export function hydrate(el) {
  if (el.__ladderHydrated) return;
  el.__ladderHydrated = true;
  const doc = el.ownerDocument || document;
  const setHL = (dev, on) => {
    for (const g of doc.querySelectorAll('.ladder-svg [data-dev]')) {
      if (g.getAttribute('data-dev') === dev) g.classList.toggle('lad-hl', on);
    }
  };
  const devOf = (e) => {
    const g = e.target.closest && e.target.closest('[data-dev]');
    return g && el.contains(g) ? g.getAttribute('data-dev') : null;
  };
  el.addEventListener('mouseover', (e) => {
    const dev = devOf(e);
    if (dev) setHL(dev, true);
  });
  el.addEventListener('mouseout', (e) => {
    const dev = devOf(e);
    if (dev) setHL(dev, false);
  });
}
