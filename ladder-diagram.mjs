// ladder-diagram.mjs — <ladder-diagram> Web Component アダプタ
//
// 使い方:
//   <script type="module" src="./ladder-diagram.mjs"></script>
//   <ladder-diagram>
//   LD    R000   ; 起動PB
//   OUT   MR000
//   </ladder-diagram>
//
// または JS から:
//   el.source = 'LD R000\nOUT MR000';
//   el.comments = { R000: '起動PB' };   // デバイスコメント辞書（インライン ; が優先）

import { renderSVG, hydrate } from './ladder-core.mjs';

export class LadderDiagram extends HTMLElement {
  connectedCallback() {
    if (this._source == null) this._source = this.textContent;
    this._render();
  }

  get source() {
    return this._source ?? '';
  }
  set source(s) {
    this._source = s;
    if (this.isConnected) this._render();
  }

  set comments(dict) {
    this._comments = dict;
    if (this.isConnected) this._render();
  }

  _render() {
    this.innerHTML = renderSVG(this._source ?? '', { comments: this._comments });
    this.__ladderHydrated = false;
    hydrate(this);
  }
}

if (!customElements.get('ladder-diagram')) {
  customElements.define('ladder-diagram', LadderDiagram);
}
