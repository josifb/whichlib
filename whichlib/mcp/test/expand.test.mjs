import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, expandTerms, topicCandidates, expandNeed } from '../expand.mjs';

test('tokenize: lower-case, drops stop words and punctuation, keeps hyphens and dots inside words', () => {
  assert.deepEqual(tokenize('A fast PDF parser for the CLI!'), ['fast', 'pdf', 'parser', 'cli']);
  assert.deepEqual(tokenize('command-line socket.io C++'), ['command-line', 'socket.io', 'c++']);
});

test('expandTerms: known synonyms are OR-ed in, others pass through, at most two groups', () => {
  assert.equal(expandTerms('async runtime'), 'async OR asynchronous runtime');
  assert.equal(expandTerms('image processing'), 'image OR imaging processing');
  assert.equal(expandTerms('pdf parser'), 'pdf OR pdfs parser');
  assert.equal(expandTerms('state management'), 'state management');
  assert.equal(expandTerms('async cli image tool'), 'async OR asynchronous cli OR command-line OR "command line" image tool', 'third synonym group is not expanded');
});

test('topicCandidates: hyphenated phrase first, then the head word skipping generic words', () => {
  assert.deepEqual(topicCandidates('image processing'), ['image-processing', 'image']);
  assert.deepEqual(topicCandidates('pdf parser'), ['pdf-parser', 'pdf']);
  assert.deepEqual(topicCandidates('cli framework'), ['cli-framework', 'cli']);
  assert.deepEqual(topicCandidates('async runtime'), ['async-runtime', 'async']);
  assert.deepEqual(topicCandidates('orm'), ['orm']);
  assert.deepEqual(topicCandidates('state management'), ['state-management', 'state']);
  assert.deepEqual(topicCandidates('web framework for python'), ['web-framework-python', 'web']);
});

test('topicCandidates: nothing usable when only generic words remain', () => {
  assert.deepEqual(topicCandidates('framework'), []);
  assert.deepEqual(topicCandidates('a good library'), []);
});

test('expandNeed: bundles terms, topic candidates and the picked topic', () => {
  assert.deepEqual(expandNeed('async runtime'), { terms: 'async OR asynchronous runtime', topics: ['async-runtime', 'async'], topic: 'async' });
});

test('pickTopic: head word when specific, hyphenated phrase when the head is broad, null when nothing usable', async () => {
  const { pickTopic } = await import('../expand.mjs');
  assert.equal(pickTopic('pdf parser'), 'pdf');
  assert.equal(pickTopic('cli framework'), 'cli');
  assert.equal(pickTopic('async runtime'), 'async');
  assert.equal(pickTopic('orm'), 'orm');
  assert.equal(pickTopic('markdown parser'), 'markdown');
  assert.equal(pickTopic('image processing'), 'image-processing');
  assert.equal(pickTopic('state management'), 'state-management');
  assert.equal(pickTopic('web framework'), 'web-framework');
  assert.equal(pickTopic('http client'), 'http-client');
  assert.equal(pickTopic('framework'), null);
});

test('subjectTokens: drops kind, stop and generic words', async () => {
  const { subjectTokens } = await import('../expand.mjs');
  assert.deepEqual(subjectTokens('cli framework'), ['cli']);
  assert.deepEqual(subjectTokens('pdf parser'), ['pdf']);
  assert.deepEqual(subjectTokens('image processing'), ['image']);
  assert.deepEqual(subjectTokens('react state management'), ['state']);
  assert.deepEqual(subjectTokens('framework'), []);
});

test('mentionsNeed: matches subject tokens, synonyms and plurals in name/description/topics, as whole words', async () => {
  const { mentionsNeed } = await import('../expand.mjs');
  const repo = (fullName, description, topics = []) => ({ fullName, description, topics });
  assert.equal(mentionsNeed(repo('pallets/click', 'Python composable command line interface toolkit'), 'cli framework'), true);
  assert.equal(mentionsNeed(repo('fastapi/typer', 'Typer, build great CLIs. Easy to code.'), 'cli framework'), true);
  assert.equal(mentionsNeed(repo('sherlock-project/sherlock', 'Hunt down social media accounts by username'), 'cli framework'), false);
  assert.equal(mentionsNeed(repo('x/click-house', 'A client for ClickHouse'), 'cli framework'), false, '"cli" must be a whole word, not a prefix of click/client');
  assert.equal(mentionsNeed(repo('python-pillow/Pillow', 'Python Imaging Library (Fork)'), 'image processing'), true);
  assert.equal(mentionsNeed(repo('roboflow/supervision', 'We write your reusable computer vision tools.'), 'image processing'), false);
  assert.equal(mentionsNeed(repo('opendatalab/MinerU', 'Transforms complex documents like PDFs and Office docs'), 'pdf parser'), true);
  assert.equal(mentionsNeed(repo('a/b', 'anything', ['pdf']), 'pdf parser'), true, 'topics count');
  assert.equal(mentionsNeed(repo('a/b', 'anything'), 'framework'), true, 'no subject tokens means no constraint');
});

test('mentionLevel: text beats topic beats none', async () => {
  const { mentionLevel } = await import('../expand.mjs');
  assert.equal(mentionLevel({ fullName: 'python-pillow/Pillow', description: 'Python Imaging Library (Fork)', topics: ['image-processing'] }, 'image processing'), 'text');
  assert.equal(mentionLevel({ fullName: 'roboflow/supervision', description: 'We write your reusable computer vision tools.', topics: ['image-processing'] }, 'image processing'), 'topic');
  assert.equal(mentionLevel({ fullName: 'sherlock-project/sherlock', description: 'Hunt down social media accounts', topics: ['osint'] }, 'cli framework'), 'none');
  assert.equal(mentionLevel({ fullName: 'scikit-image/scikit-image', description: 'Processing in Python', topics: [] }, 'image processing'), 'text', 'the repo name counts as text');
  assert.equal(mentionLevel({ fullName: 'a/b', description: '', topics: [] }, 'framework'), 'text');
});

test('asksForLibrary and looksLikeLibrary', async () => {
  const { asksForLibrary, looksLikeLibrary } = await import('../expand.mjs');
  assert.equal(asksForLibrary('cli framework'), true);
  assert.equal(asksForLibrary('pdf parser'), true);
  assert.equal(asksForLibrary('image processing'), false);
  assert.equal(looksLikeLibrary({ fullName: 'pallets/click', description: 'Python composable command line interface toolkit', topics: [] }), true);
  assert.equal(looksLikeLibrary({ fullName: 'yt-dlp/yt-dlp', description: 'A feature-rich command-line audio/video downloader', topics: [] }), false);
  assert.equal(looksLikeLibrary({ fullName: 'a/b', description: '', topics: ['sdk'] }), true);
});
