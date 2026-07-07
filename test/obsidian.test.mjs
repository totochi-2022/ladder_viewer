// 生成された Obsidian プラグイン (dist/obsidian/kvlist-ladder/main.js) のスモークテスト。
// Obsidian 本体なしで require('obsidian') をスタブしてロードし、
// kvlist プロセッサが登録され SVG を出力することを確認する。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

before(() => {
  execSync('sh obsidian-plugin.sh', { cwd: root, stdio: 'pipe' });
});

function loadPlugin() {
  const code = readFileSync(join(root, 'dist/obsidian/kvlist-ladder/main.js'), 'utf8');
  const fakeRequire = (name) => {
    assert.equal(name, 'obsidian');
    return { Plugin: class Plugin {} };
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(fakeRequire, mod, mod.exports);
  return mod.exports;
}

test('main.js: ロードして kvlist プロセッサが登録される', () => {
  const PluginClass = loadPlugin();
  const plugin = new PluginClass();
  const registered = {};
  plugin.registerMarkdownCodeBlockProcessor = (lang, cb) => { registered[lang] = cb; };
  plugin.onload();
  assert.ok(typeof registered.kvlist === 'function');

  // 疑似 el でプロセッサ本体を実行
  const el = {
    _html: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    addEventListener() {},
    ownerDocument: { querySelectorAll: () => [] },
  };
  registered.kvlist('LD R000 ; 起動PB\nOUT MR000', el);
  assert.ok(el._html.startsWith('<svg'));
  assert.ok(el._html.includes('data-dev="R000"'));
  assert.ok(el._html.includes('起動PB'));
});

test('manifest.json: 必須フィールド', () => {
  const m = JSON.parse(readFileSync(join(root, 'dist/obsidian/kvlist-ladder/manifest.json'), 'utf8'));
  for (const key of ['id', 'name', 'version', 'minAppVersion', 'description']) {
    assert.ok(m[key], `manifest に ${key} がない`);
  }
  assert.equal(m.id, 'kvlist-ladder');
});
