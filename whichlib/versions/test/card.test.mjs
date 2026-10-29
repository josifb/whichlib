import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../build.mjs';
import { versionCards } from '../card.mjs';

const CHANGELOG = `# Changelog
## 4.1.0
### Features
- Added \`z.foo()\` helper.
- Removed \`z.bar()\`; use \`z.baz()\` instead.
## 4.0.0
### Breaking changes
- \`z.string().email()\` moved to \`z.email()\`.
- Dropped Node 16 support.
## 3.2.0
- Removed \`z.old()\` (#12).
`;
const BLOB = 'https://github.com/o/zlib/blob/abc1234567/CHANGELOG.md';

const LIBRARY = {
  package: 'zlib',
  ecosystem: 'npm',
  from: '3.2.0',
  to: '4.1.0',
  sources: [{ kind: 'changelog', repo: 'o/zlib', path: 'CHANGELOG.md' }],
};

/** Fake GitHub and registry: fixed versions, one changelog file. */
function fakeSources({ versions = ['3.1.0', '3.2.0', '4.0.0', '4.0.1', '4.1.0'], files = { 'o/zlib:CHANGELOG.md': CHANGELOG }, releases = {} } = {}) {
  return {
    versions: async () => versions,
    file: async (repo, path) => ({ text: files[`${repo}:${path}`], url: `https://github.com/${repo}/blob/abc1234567/${path}` }),
    releases: async (repo) => releases[repo] ?? [],
  };
}

const P = { foo: 0.1, bar: 0.6, email: 0.95, 'Node 16': 0.4, old: 0.99, adapter: 0.8 };
/** Fake Jev: probability by a word in the entry text; records every entry it judged. */
function fakeJudge(table = P) {
  const judged = [];
  const judge = async (pkg, entries) => {
    judged.push(...entries);
    return entries.map((e) => Object.entries(table).find(([word]) => e.text.includes(word))?.[1] ?? 0);
  };
  return { judge, judged };
}

test('card: lists exactly the breaking entries between the two versions, author-labelled breaking first, with source links', async () => {
  const index = await buildIndex(LIBRARY, { sources: fakeSources(), judge: fakeJudge().judge });
  const text = versionCards([{ package: 'zlib', version: '4.1.0' }], [index]);
  assert.equal(text, [
    '## zlib 4.1.0 installed (you likely know 3.2.0)',
    'Breaking changes since 3.2.0, most important first:',
    `- \`z.string().email()\` moved to \`z.email()\`. (4.0.0, ${BLOB}#L8)`,
    `- Dropped Node 16 support. (4.0.0, ${BLOB}#L9)`,
    `- Removed \`z.bar()\`; use \`z.baz()\` instead. (4.1.0, ${BLOB}#L5)`,
  ].join('\n'));
});

test('card: a card set over the size cap keeps the most important changes and says it was trimmed', async () => {
  const items = Array.from({ length: 120 }, (_, i) => `- Removed the old option number ${i} from the configuration file; set the new option instead.`);
  const changelog = `## 4.0.0\n${items.join('\n')}\n`;
  const judge = async (pkg, entries) => entries.map((e) => 0.31 + Number(/number (\d+) /.exec(e.text)[1]) / 200);
  const index = await buildIndex(LIBRARY, { sources: fakeSources({ files: { 'o/zlib:CHANGELOG.md': changelog } }), judge });
  const text = versionCards([{ package: 'zlib', version: '4.1.0' }, { package: 'other', version: '1.0.0' }], [index]);
  assert.ok(text.length / 4 <= 1500, `about ${Math.round(text.length / 4)} tokens`);
  const shown = text.split('\n').filter((l) => l.startsWith('- Removed'));
  assert.ok(shown.length > 10 && shown.length < 120);
  assert.match(shown[0], /number 119 /);
  assert.match(text, new RegExp(`trimmed: ${120 - shown.length} more breaking changes not shown`));
  assert.match(text, /## other 1\.0\.0: not covered/);
});

test('card: unknown package or version is said plainly, never an empty card', async () => {
  const index = await buildIndex(LIBRARY, { sources: fakeSources(), judge: fakeJudge().judge });
  const text = versionCards([{ package: 'nope', version: '1.0.0' }, { package: 'zlib', version: '9.9.9' }], [index]);
  assert.equal(text, [
    '## nope 1.0.0: not covered by whichlib, no version card. This does not mean nothing changed.',
    '',
    '## zlib 9.9.9: unknown version (whichlib covers 3.2.0 to 4.1.0). This does not mean nothing changed; check the release notes.',
  ].join('\n'));
});

test('card: an installed version with no breaking changes says so', async () => {
  const index = await buildIndex(LIBRARY, { sources: fakeSources(), judge: fakeJudge({}).judge });
  assert.equal(versionCards([{ package: 'zlib', version: '4.0.1' }], [index]),
    '## zlib 4.0.1 installed (you likely know 3.2.0)\nNo breaking changes found since 3.2.0.');
});

test('index: the judge sees each entry once; a rebuild with the same cache makes no new calls', async () => {
  const cache = {};
  const first = fakeJudge();
  const a = await buildIndex(LIBRARY, { sources: fakeSources(), judge: first.judge, cache });
  assert.deepEqual(first.judged.map((e) => e.text).sort(), [
    'Added `z.foo()` helper.',
    'Dropped Node 16 support.',
    'Removed `z.bar()`; use `z.baz()` instead.',
    '`z.string().email()` moved to `z.email()`.',
  ]);
  const second = fakeJudge();
  const b = await buildIndex(LIBRARY, { sources: fakeSources(), judge: second.judge, cache });
  assert.equal(second.judged.length, 0);
  assert.deepEqual(b, a);
});

test('index: GitHub releases by tag pattern, prereleases skipped, linked to the release page, each entry with its section', async () => {
  const library = { ...LIBRARY, sources: [{ kind: 'releases', repo: 'o/zlib', tag: 'zlib=={version}' }] };
  const releases = { 'o/zlib': [
    { tag: 'zlib==4.0.0', url: 'https://github.com/o/zlib/releases/tag/zlib%3D%3D4.0.0', prerelease: false, body: '## Schema and config file updates:\n* `adapter` has been removed by @dev in https://github.com/o/zlib/pull/7\n' },
    { tag: 'zlib==4.1.0rc1', url: 'https://x/rc', prerelease: true, body: '- adapter moved' },
    { tag: 'zlib-core==4.0.0', url: 'https://x/core', prerelease: false, body: '- adapter moved' },
  ] };
  const index = await buildIndex(library, { sources: fakeSources({ releases }), judge: fakeJudge().judge });
  assert.equal(versionCards([{ package: 'zlib', version: '4.1.0' }], [index]), [
    '## zlib 4.1.0 installed (you likely know 3.2.0)',
    'Breaking changes since 3.2.0, most important first:',
    '- Schema and config file updates: `adapter` has been removed (4.0.0, https://github.com/o/zlib/releases/tag/zlib%3D%3D4.0.0)',
  ].join('\n'));
});

test('index: a migration guide counts for its version; prose is one entry per section, code skipped', async () => {
  const guide = '---\ntitle: Upgrade\n---\n# Upgrade to 4\n## Email\nThe `email` check moved\nto a top-level function.\n\n```ts\nz.email()\n```\n\nUpdate your imports.\n<Note>\n';
  const library = { ...LIBRARY, sources: [{ kind: 'guide', repo: 'o/docs', path: 'v4.mdx', version: '4.0.0' }] };
  const index = await buildIndex(library, { sources: fakeSources({ files: { 'o/docs:v4.mdx': guide } }), judge: fakeJudge().judge });
  assert.deepEqual(index.entries.map(({ section, text, source }) => ({ section, text, source })), [
    { section: 'Email', text: 'The `email` check moved to a top-level function. Update your imports.', source: 'https://github.com/o/docs/blob/abc1234567/v4.mdx#L6' },
  ]);
  assert.match(versionCards([{ package: 'zlib', version: '4.0.0' }], [index]), /^- Email: The `email` check moved to a top-level function\. Update your imports\. \(4\.0\.0, /m);
});

test('index: a reStructuredText guide (SQLAlchemy style): headings, roles and literals cleaned, directives and code skipped', async () => {
  const rst = [
    '=============================', 'SQLAlchemy 2.0 migration', '=============================', '',
    '.. contents::', '    :local:', '',
    'Overview', '========', '', 'Some intro paragraph.', '',
    '``Session.query`` is legacy', '---------------------------', '',
    'The :meth:`_orm.Session.query` method is legacy; use', ':func:`_sql.select` with :meth:`Session.execute() <.Session.execute>`::', '',
    '.. sourcecode:: python', '', '    session.query(User).all()', '',
    '* Removed ``engine.execute()``; use a connection.', '* ``create_engine(future=True)``', '  is the default.', '',
  ].join('\n');
  const library = { ...LIBRARY, sources: [{ kind: 'guide', repo: 'o/sa', path: 'doc/migration_20.rst', version: '4.0.0' }] };
  const index = await buildIndex(library, { sources: fakeSources({ files: { 'o/sa:doc/migration_20.rst': rst } }), judge: fakeJudge().judge });
  const url = 'https://github.com/o/sa/blob/abc1234567/doc/migration_20.rst';
  assert.deepEqual(index.entries.map(({ section, text, source }) => ({ section, text, source })), [
    { section: 'Overview', text: 'Some intro paragraph.', source: `${url}#L11` },
    { section: '`Session.query` is legacy', text: 'The `Session.query` method is legacy; use `select` with `Session.execute()`:', source: `${url}#L16` },
    { section: '`Session.query` is legacy', text: 'Removed `engine.execute()`; use a connection.', source: `${url}#L23` },
    { section: '`Session.query` is legacy', text: '`create_engine(future=True)` is the default.', source: `${url}#L24` },
  ]);
});

test('index: release notes give one entry per line (GitHub keeps line breaks); code spans keep their tags', async () => {
  const library = { ...LIBRARY, sources: [{ kind: 'releases', repo: 'o/zlib', tag: 'zlib=={version}' }] };
  const body = 'Changes since zlib==3.2.0\n\nfeat: add foo (#1)\nfix!: remove `<Bar>` component, use \#baz (#2)\n<b>Note</b> nothing else\n';
  const releases = { 'o/zlib': [{ tag: 'zlib==4.0.0', url: 'https://r', prerelease: false, body }] };
  const index = await buildIndex(library, { sources: fakeSources({ releases }), judge: fakeJudge().judge });
  assert.deepEqual(index.entries.map((e) => e.text), [
    'Changes since zlib==3.2.0',
    'feat: add foo',
    'fix!: remove `<Bar>` component, use #baz',
    'Note nothing else',
  ]);
});

test('index: leading commit hashes, trailing authors and MDX comments are not part of an entry', async () => {
  const changelog = '## 4.0.0\n- 98ff675c313c15d3fa18b2bd01f844b1e817ee79 Drop stringToBoolean\n- `413cce9a` fix(v4)!: require seconds by @colinhacks\n- Deprecates `.addIssue()`. {/* ## `.and()` dropped */} Push to `err.issues`.\n';
  const index = await buildIndex(LIBRARY, { sources: fakeSources({ files: { 'o/zlib:CHANGELOG.md': changelog } }), judge: fakeJudge().judge });
  assert.deepEqual(index.entries.map((e) => e.text), ['Drop stringToBoolean', 'fix(v4)!: require seconds', 'Deprecates `.addIssue()`. Push to `err.issues`.']);
});

test('card: an installed version written differently ("2.0" vs "2.0.0") is still known', async () => {
  const index = await buildIndex(LIBRARY, { sources: fakeSources({ versions: ['3.2', '4.0', '4.1'] }), judge: fakeJudge().judge });
  assert.match(versionCards([{ package: 'zlib', version: '4.1.0' }], [index]), /^## zlib 4\.1\.0 installed/);
});

test('index: generics and plain numbers survive cleaning; MDX comments spanning paragraphs are dropped', async () => {
  const changelog = '## 4.0.0\n- `parse()` returns Promise<void> instead\n- 1000000 rows are now streamed\n{/* ## Old\n\nhidden text */}\n- Visible\n';
  const index = await buildIndex(LIBRARY, { sources: fakeSources({ files: { 'o/zlib:CHANGELOG.md': changelog } }), judge: fakeJudge().judge });
  assert.deepEqual(index.entries.map((e) => e.text), ['`parse()` returns Promise<void> instead', '1000000 rows are now streamed', 'Visible']);
});

test('card: migration-guide entries come before release-note entries, whatever their probability', async () => {
  const library = { ...LIBRARY, sources: [
    { kind: 'releases', repo: 'o/zlib', tag: 'v{version}' },
    { kind: 'guide', repo: 'o/docs', path: 'v4.md', version: '4.0.0' },
  ] };
  const releases = { 'o/zlib': [{ tag: 'v4.0.0', url: 'https://r', prerelease: false, body: 'Removed `z.old()`\n' }] };
  const files = { 'o/docs:v4.md': '# Upgrade\n- Use `z.email()` instead of `z.string().email()`.\n' };
  const index = await buildIndex(library, { sources: fakeSources({ files, releases }), judge: fakeJudge({ email: 0.4, old: 0.9 }).judge });
  const bullets = versionCards([{ package: 'zlib', version: '4.1.0' }], [index]).split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(bullets, [
    '- Use `z.email()` instead of `z.string().email()`. (4.0.0, https://github.com/o/docs/blob/abc1234567/v4.md#L2)',
    '- Removed `z.old()` (4.0.0, https://r)',
  ]);
});

test('card: entries under a breaking heading come first, whatever the heading style', async () => {
  const changelog = ['## 4.0.0', '### Patch Changes', '- Renamed `x` to `y` (high)', '### Major Changes', '- Dropped `a`', '### ⚠ BREAKING CHANGES', '- Dropped `b`',
    '### Removed', '- Dropped `c`', '### Async APIs (Breaking change)', '- Dropped `d`', '### Removed Client Engines:', '- Dropped `e`', '### Non-breaking changes', '- Kept `f` (high)', '### Features', '- Removed nothing (high)'].join('\n');
  const judge = async (pkg, entries) => entries.map((e) => (e.text.includes('high') ? 0.9 : 0.5));
  const index = await buildIndex(LIBRARY, { sources: fakeSources({ files: { 'o/zlib:CHANGELOG.md': changelog } }), judge });
  const bullets = versionCards([{ package: 'zlib', version: '4.1.0' }], [index]).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.replace(/ \(4\.0\.0.*$/, ''));
  assert.deepEqual(bullets, ['- Dropped `a`', '- Dropped `b`', '- Dropped `c`', '- Dropped `d`', '- Dropped `e`', '- Renamed `x` to `y` (high)', '- Kept `f` (high)', '- Removed nothing (high)']);
});
