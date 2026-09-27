// Query expansion for recommend_repos. Pure functions.
//
// GitHub repository search matches words in name, description and README,
// so vocabulary decides recall: "async runtime" misses tokio ("asynchronous"),
// "image processing" misses Pillow ("Python Imaging Library"). Two remedies,
// verified against the API on 2026-09-27:
//   1. `a OR b` works inside the text query, so known synonyms are OR-ed in.
//   2. `topic:x` sorted by stars surfaces the canonical libraries maintainers
//      tagged themselves; the hyphenated phrase and the head word both help.

const SYNONYMS = {
  async: ['asynchronous'],
  asynchronous: ['async'],
  cli: ['command-line', '"command line"'],
  'command-line': ['cli', '"command line"'],
  image: ['imaging'],
  imaging: ['image'],
  orm: ['object-relational'],
  db: ['database'],
  database: ['db'],
  auth: ['authentication'],
  authentication: ['auth'],
  authz: ['authorization'],
  config: ['configuration'],
  configuration: ['config'],
  js: ['javascript'],
  ts: ['typescript'],
  k8s: ['kubernetes'],
  kubernetes: ['k8s'],
  http: ['https'],
  ws: ['websocket'],
  websocket: ['websockets'],
  websockets: ['websocket'],
  i18n: ['internationalization'],
  internationalization: ['i18n'],
  l10n: ['localization'],
  localization: ['l10n'],
  regex: ['regexp'],
  regexp: ['regex'],
  ml: ['machine-learning'],
  ai: ['llm'],
  llm: ['ai'],
  pdf: ['pdfs'],
  csv: ['spreadsheet'],
  yaml: ['yml'],
  yml: ['yaml'],
  env: ['dotenv'],
  dotenv: ['env'],
  gui: ['desktop'],
  tui: ['terminal'],
  terminal: ['tui'],
  chart: ['charting'],
  charting: ['chart'],
  charts: ['charting'],
  test: ['testing'],
  testing: ['test'],
  log: ['logging'],
  logging: ['log'],
  logger: ['logging'],
  queue: ['job-queue'],
  cache: ['caching'],
  caching: ['cache'],
  crypto: ['cryptography'],
  cryptography: ['crypto'],
  jwt: ['json-web-token'],
  oauth: ['oauth2'],
  oauth2: ['oauth'],
  markdown: ['md'],
  html: ['dom'],
  scrape: ['scraping'],
  scraper: ['scraping'],
  scraping: ['scraper'],
  crawler: ['crawling'],
  ocr: ['text-recognition'],
  stt: ['speech-to-text'],
  tts: ['text-to-speech'],
  'speech-to-text': ['stt'],
  'text-to-speech': ['tts'],
  mq: ['message-queue'],
  grpc: ['rpc'],
  s3: ['object-storage'],
  sql: ['database'],
  nosql: ['database'],
  vector: ['embeddings'],
  embeddings: ['vector'],
};

// Words that describe the kind of thing, not the subject. They never become the
// head topic ("pdf parser" -> topic:pdf, not topic:parser).
const GENERIC = new Set([
  'framework', 'frameworks', 'library', 'libraries', 'lib', 'libs', 'parser', 'parsers', 'parsing', 'client', 'clients',
  'server', 'servers', 'runtime', 'tool', 'tools', 'toolkit', 'processing', 'management', 'manager', 'engine', 'sdk',
  'api', 'wrapper', 'helper', 'helpers', 'utility', 'utilities', 'utils', 'package', 'module', 'plugin', 'system',
  'service', 'app', 'application', 'solution', 'implementation', 'binding', 'bindings', 'kit', 'stack', 'platform',
  'generator', 'builder', 'handler', 'middleware', 'driver', 'connector', 'adapter', 'loader', 'validator', 'validation',
  'for', 'and', 'or', 'the', 'a', 'an', 'in', 'of', 'to', 'with', 'on', 'best', 'good', 'simple', 'fast', 'small', 'modern',
  'lightweight', 'minimal', 'python', 'javascript', 'typescript', 'rust', 'go', 'golang', 'java', 'node', 'nodejs', 'react',
]);

const STOP = new Set(['for', 'and', 'or', 'the', 'a', 'an', 'in', 'of', 'to', 'with', 'on', 'best', 'good', 'i', 'need', 'want', 'some', 'any']);

/** Lower-case word tokens, keeping internal hyphens and dots (e.g. "command-line", "socket.io"). */
export function tokenize(text) {
  return String(text).toLowerCase().split(/[^a-z0-9.+#-]+/).map((t) => t.replace(/^[-.]+|[-.]+$/g, '')).filter((t) => t && !STOP.has(t));
}

/**
 * Text query terms with synonyms OR-ed in, at most `maxGroups` groups so the
 * query stays readable to GitHub's parser. Words without synonyms pass through.
 */
export function expandTerms(text, { maxGroups = 2 } = {}) {
  let groups = 0;
  return tokenize(text).map((tok) => {
    const syn = SYNONYMS[tok];
    if (!syn || groups >= maxGroups) return tok;
    groups += 1;
    return [tok, ...syn].join(' OR ');
  }).join(' ');
}

/**
 * Topic names worth querying, most specific first: the hyphenated phrase when
 * the need has several words, then the head word (first non-generic token).
 * Returns [] when nothing usable remains (e.g. "framework").
 */
export function topicCandidates(text) {
  const toks = tokenize(text).filter((t) => /^[a-z0-9][a-z0-9.+#-]*$/.test(t));
  const out = [];
  if (toks.length >= 2 && toks.length <= 4) out.push(toks.join('-'));
  const head = toks.find((t) => !GENERIC.has(t));
  if (head && !out.includes(head)) out.push(head);
  return out.map((t) => t.replace(/[^a-z0-9-]/g, '')).filter((t) => t.length >= 2);
}

// Head words too broad to be a useful topic on their own ("topic:image" is
// anything with pictures; "topic:image-processing" is the libraries). For these
// the hyphenated phrase wins; otherwise the head word wins (topic:pdf beats
// topic:pdf-parser, topic:cli beats topic:cli-framework). Verified 2026-09-27.
const BROAD_HEADS = new Set([
  'image', 'images', 'state', 'web', 'data', 'file', 'files', 'text', 'time', 'date', 'string', 'object', 'event', 'events',
  'task', 'tasks', 'job', 'jobs', 'user', 'users', 'form', 'forms', 'table', 'tables', 'graph', 'network', 'machine', 'deep',
  'natural', 'computer', 'real', 'static', 'dynamic', 'game', 'video', 'audio', 'code', 'source', 'message', 'messages',
  'model', 'models', 'schema', 'type', 'types', 'unit', 'end', 'load', 'rate', 'feature', 'dependency', 'package', 'error',
  'http', 'rest', 'json', 'xml', 'color', 'colour', 'number', 'math', 'query', 'search', 'input', 'output', 'stream', 'streams',
]);

/**
 * The one topic to query (GitHub rejects `topic:a OR topic:b`, so one per
 * request). Null when the need has no usable topic.
 */
export function pickTopic(text) {
  const [phrase, head] = topicCandidates(text).length === 2 ? topicCandidates(text) : [null, topicCandidates(text)[0] ?? null];
  if (!head) return phrase;
  return phrase && BROAD_HEADS.has(head) ? phrase : head;
}

/** Full expansion: { terms, topics, topic }. */
export function expandNeed(text) {
  return { terms: expandTerms(text), topics: topicCandidates(text), topic: pickTopic(text) };
}

// ---- Fit signals read from a candidate's own name, description and topics ----
// Text search also matches README bodies and the topic query returns every
// application tagged with the topic, so a candidate can arrive without ever
// saying what the user asked for. These checks bring the need back into it.

// Words a need uses to say "I want a building block, not an application".
const KIND_WORDS = new Set(['framework', 'frameworks', 'library', 'libraries', 'lib', 'libs', 'parser', 'parsers', 'client', 'clients', 'sdk', 'toolkit', 'orm', 'runtime', 'driver', 'wrapper', 'bindings', 'binding', 'engine', 'router', 'logger', 'validator', 'middleware', 'module', 'package', 'plugin', 'adapter', 'connector']);
// Words a repository uses to describe itself as a building block.
const LIBRARY_WORDS = ['framework', 'library', 'lib', 'toolkit', 'sdk', 'module', 'package', 'wrapper', 'bindings', 'binding', 'client', 'parser', 'driver', 'engine', 'api', 'runtime', 'orm', 'plugin', 'middleware', 'router', 'logger', 'validator', 'adapter', 'connector', 'components', 'primitives', 'utilities', 'utils', 'helpers'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay, word) => new RegExp(`(^|[^a-z0-9])${escapeRe(word)}(?=$|[^a-z0-9])`, 'i').test(hay);

/** The need's subject tokens: everything that is not a kind, stop or generic word. */
export function subjectTokens(text) {
  return tokenize(text).filter((t) => !GENERIC.has(t) && !KIND_WORDS.has(t));
}

/** Lower-case text a candidate says about itself. */
export const repoText = (repo) => `${repo.fullName ?? ''} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`.toLowerCase();

const variantsOf = (t) => [...new Set([t, `${t}s`, t.replace(/s$/, ''), ...(SYNONYMS[t] ?? []).map((s) => s.replace(/"/g, ''))])].filter(Boolean);
const mentionsAny = (hay, subjects) => subjects.some((t) => variantsOf(t).some((v) => hasWord(hay, v)));

/**
 * How strongly the candidate says it is about the need's subject:
 *   'text'  named in the repo name or description (strongest),
 *   'topic' only in its topic tags (every result of a topic query has this, and tagging is loose),
 *   'none'  nowhere.
 * Synonyms and simple plurals count. 'text' when the need has no subject tokens.
 */
export function mentionLevel(repo, text) {
  const subjects = subjectTokens(text);
  if (subjects.length === 0) return 'text';
  if (mentionsAny(`${repo.fullName ?? ''} ${repo.description ?? ''}`.toLowerCase(), subjects)) return 'text';
  if (mentionsAny((repo.topics ?? []).join(' ').toLowerCase(), subjects)) return 'topic';
  return 'none';
}

/** Convenience: anything better than 'none'. */
export const mentionsNeed = (repo, text) => mentionLevel(repo, text) !== 'none';

/** Did the user ask for a building block (framework, library, parser...)? */
export const asksForLibrary = (text) => tokenize(text).some((t) => KIND_WORDS.has(t));

/** Does the candidate describe itself as a building block rather than an application? */
export const looksLikeLibrary = (repo) => { const hay = repoText(repo); return LIBRARY_WORDS.some((w) => hasWord(hay, w)); };
