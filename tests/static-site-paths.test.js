import test from 'node:test';
import assert from 'node:assert/strict';
import { mountStaticSource, staticBasePath } from '../scripts/static-site-paths.mjs';

test('static base paths accept a site root or subdirectory but not origins or traversal', () => {
  assert.equal(staticBasePath(), '');
  assert.equal(staticBasePath('/'), '');
  assert.equal(staticBasePath('/linkshot/'), '/linkshot');
  assert.equal(staticBasePath('/games/linkshot'), '/games/linkshot');
  for (const value of ['linkshot', '//linkshot', 'https://example.com', '/games/../linkshot', '/./linkshot', '/linkshot?q=1', '/%2e%2e/linkshot']) {
    assert.throws(() => staticBasePath(value), /APP_BASE_PATH/);
  }
});

test('project-site HTML and CSS keep document resources and home links under the mount', () => {
  const base = '/linkshot';
  const html = '<a href="/"><img src="/assets/card.png"></a><link href="/style.css"><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><script src="/app.js"></script><a href="//example.net/"></a>';
  assert.equal(mountStaticSource(html, '.html', base),
    '<a href="/linkshot/"><img src="/linkshot/assets/card.png"></a><link href="/linkshot/style.css"><script type="importmap">{"imports":{"three":"/linkshot/vendor/three.module.js"}}</script><script src="/linkshot/app.js"></script><a href="//example.net/"></a>');
  const css = `.hero{background:url(/assets/cover.png)}.icon{background:url("/favicon.svg")}`;
  assert.equal(mountStaticSource(css, '.css', base), `.hero{background:url(/linkshot/assets/cover.png)}.icon{background:url("/linkshot/favicon.svg")}`);
});

test('project-site scripts mount modules and assets but preserve sibling and backend URLs', () => {
  const source = [
    "import { MAPS } from '/shared/world.js';",
    "export { rankEmblem } from '../shared/ranks.js';",
    "new Worker(new URL('./solo-worker.js', import.meta.url));",
    'const sound = `/assets/sounds/${name}.wav`;',
    "fetch('/api/profile'); new WebSocket('/lan/play');",
  ].join('\n');
  assert.equal(mountStaticSource(source, '.js', '/linkshot', true), source
    .replace("'/shared/world.js'", "'/linkshot/shared/world.js'")
    .replace("'../shared/ranks.js'", "'/linkshot/shared/ranks.js'")
    .replace('`/assets/', '`/linkshot/assets/'));
  assert.equal(mountStaticSource("import './world.js'; return '/assets/ranks/unranked.svg';", '.js', '/linkshot'),
    "import './world.js'; return '/linkshot/assets/ranks/unranked.svg';");
  assert.equal(mountStaticSource(source, '.js', '', true), source);
});
