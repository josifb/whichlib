// Splits release notes, changelogs and migration guides into changelog
// entries: one per list item, plus one per section for its prose (paragraphs
// between two headings). Each entry keeps its section heading and the line it
// starts on, for the source link. Markdown (and MDX), or reStructuredText.

import { parseVersion } from './version.mjs';

const VERSION_HEADING = /^\[?v?(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.]+|(?:a|b|rc|\.post)\d+)?)\]?(?:\s|$|\(|:)/;

/** Inline markdown to plain text: links to their text, no images, html tags, emphasis, PR and commit refs. */
export function cleanText(s) {
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/(`[^`]*`)/) // html tags and escapes only outside code spans
    .map((part, i) => (i % 2 ? part : part.replace(/<\/[A-Za-z][^>]*>|(^|[^\w])<[A-Za-z][^>]*>/g, (_, before) => before ?? '').replace(/\\([\\`*_{}[\]()#+\-.!<>|])/g, '$1')))
    .join('')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^`?(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}`?:?\s+/, '') // commit or changeset hash: "986c6fd: feat(ai): ...", "`413cce9a` fix: ..."
    .replace(/\s+by @[\w-]+(?: in https?:\/\/\S+)?$/, '') // GitHub generated notes
    .replace(/\s*\((?:#\d+|(?=[0-9a-f]*[a-f])[0-9a-f]{7,40})\)/g, '') // "(#123)", "(71d0797)"
    .replace(/:?\s+#\d+$/, '') // "...: #83656"
    .replace(/\s+/g, ' ')
    .trim();
}

/** reStructuredText inline markup: ``x`` -> `x`, :role:`Text <target>` -> `Text`, :meth:`_orm.Session.query` -> `Session.query`. */
function rstInline(s) {
  return String(s)
    .replace(/:[\w:-]+:`([^`<]*?)\s*<[^>]*>`/g, (_, t) => '`' + t.trim() + '`')
    .replace(/:[\w:-]+:`~?\.?([^`]*)`/g, (_, t) => '`' + t.replace(/^_?\w+\./, '') + '`')
    .replace(/``([^`]+)``/g, '`$1`')
    .replace(/`([^`]+?) <[^>]+>`_+/g, '$1');
}

const UNDERLINE = /^([=\-~^"'*+#`:.])\1{2,}\s*$/;

/** reStructuredText lines -> the same blocks as markdown. Directives, comments and literal blocks are skipped. */
function rstBlocks(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  const styles = []; // heading levels in order of first use
  let cur = null;
  let skipIndented = false;
  const close = () => { if (cur) { cur.text = rstInline(cur.text); out.push(cur); } cur = null; };
  const heading = (title, style, n) => {
    close();
    if (!styles.includes(style)) styles.push(style);
    out.push({ kind: 'heading', level: styles.indexOf(style) + 1, text: cleanText(rstInline(title)), line: n });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    if (!line.trim()) { if (cur?.kind === 'prose') close(); else if (cur) cur.blank = true; continue; }
    const indented = /^\s/.test(line);
    if (skipIndented) { if (indented) continue; skipIndented = false; }
    if (UNDERLINE.test(line) && lines[i + 1]?.trim() && UNDERLINE.test(lines[i + 2] ?? '')) { heading(lines[i + 1].trim(), `over${line.trim()[0]}`, i + 2); i += 2; continue; }
    if (!indented && UNDERLINE.test(lines[i + 1] ?? '') && lines[i + 1].trim().length >= line.trim().length) { heading(line.trim(), lines[i + 1].trim()[0], n); i++; continue; }
    if (/^\.\.(\s|$)/.test(line)) { close(); skipIndented = true; continue; }
    const item = /^(?:[-*+]|#\.|\d+\.)\s+(.*)$/.exec(line);
    if (item) { close(); cur = { kind: 'item', text: item[1], line: n }; }
    else if (cur?.kind === 'item' && indented && !cur.blank) cur.text += ' ' + line.trim();
    else if (indented) { close(); continue; } // block quote or literal block
    else if (cur?.kind === 'prose') cur.text += ' ' + line.trim();
    else { close(); cur = { kind: 'prose', text: line.trim(), line: n }; }
    // "text::" opens a literal block: keep one colon ("text:"), drop it after a space ("text ::")
    if (/::\s*$/.test(cur.text)) { cur.text = cur.text.replace(/(\s?)::\s*$/, (_, sp) => (sp ? '' : ':')); skipIndented = true; }
  }
  close();
  return out;
}

/**
 * Markdown lines -> headings, list items and prose paragraphs, with 1-based start lines.
 * lines: every prose line is a block of its own (GitHub release notes keep line breaks).
 */
function blocks(text, { lines: byLine = false } = {}) {
  // MDX comments may span paragraphs: blank them out first, keeping line numbers
  const lines = String(text ?? '').replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, '')).split(/\r?\n/);
  const out = [];
  let cur = null; // open item or prose block
  let fence = null;
  const close = () => { if (cur) out.push(cur); cur = null; };
  let i = 0;
  if (/^---\s*$/.test(lines[0] ?? '')) { // frontmatter
    const end = lines.findIndex((l, j) => j > 0 && /^---\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    const f = /^\s*(```|~~~)/.exec(line);
    if (fence) { if (f && f[1] === fence) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (!line.trim()) { if (cur?.kind === 'prose') close(); else if (cur) cur.blank = true; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { close(); out.push({ kind: 'heading', level: h[1].length, text: cleanText(h[2]), line: n }); continue; }
    if (/^\s*\|/.test(line) || /^\s*<\/?[A-Za-z][^>]*>\s*$/.test(line) || /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line) || /^\s*(import|export)\s/.test(line)) continue;
    const item = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (item && item[1].length < 2) { close(); cur = { kind: 'item', text: item[2], line: n }; continue; }
    const body = line.replace(/^\s*>\s?/, '');
    if (cur?.kind === 'item' && (!cur.blank || /^\s{2,}/.test(line))) { cur.text += ' ' + body.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''); cur.blank = false; continue; }
    if (cur?.kind === 'item') close();
    if (byLine) { close(); out.push({ kind: 'line', text: body, line: n }); continue; }
    if (cur?.kind === 'prose') cur.text += ' ' + body;
    else cur = { kind: 'prose', text: body, line: n };
  }
  close();
  return out;
}

/** Blocks -> entries. Without a fixed version, a heading that starts with a version opens that version. Prose is one entry per section. */
function toEntries(list, { version: fixed = null } = {}) {
  const entries = [];
  let version = fixed;
  let versionLevel = 0;
  let section = '';
  let prose = null; // the open section's prose entry
  for (const b of list) {
    if (b.kind === 'heading') {
      prose = null;
      const v = fixed ? null : VERSION_HEADING.exec(b.text)?.[1];
      if (v && parseVersion(v)) { version = v; versionLevel = b.level; section = ''; continue; }
      if (!fixed && b.level <= versionLevel) { version = null; versionLevel = 0; }
      section = b.text;
      continue;
    }
    if (!version) continue;
    const text = cleanText(b.text);
    if (!text) continue;
    if (b.kind === 'item') { entries.push({ version, section, text, line: b.line }); continue; }
    if (b.kind === 'line') { entries.push({ version, section, text, line: b.line, prose: true }); continue; }
    if (prose) { prose.text += ' ' + text; continue; }
    prose = { version, section, text, line: b.line, prose: true };
    entries.push(prose);
  }
  return entries;
}

const reader = (format, opts) => (text) => (format === 'rst' ? rstBlocks(text) : blocks(text, opts));

/** A changelog file: entries belong to the version heading above them. format: 'md' (default) or 'rst'. */
export const changelogEntries = (text, { format } = {}) => toEntries(reader(format)(text));

/** Release notes or a migration guide: every entry belongs to `version`. lines: one entry per prose line (markdown only). */
export const notesEntries = (text, version, { format, lines = false } = {}) => toEntries(reader(format, { lines })(text), { version });
