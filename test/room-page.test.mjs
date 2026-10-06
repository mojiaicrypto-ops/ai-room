import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { mentionAtCaret, matchingMembers, insertMention, viewerHtml } from '../src/room-page.js';

test('mention context follows caret and word boundary; selections and email are excluded', () => {
  assert.deepEqual(mentionAtCaret('你好 @Co 后文', 6), { start: 3, end: 6, query: 'Co' });
  assert.deepEqual(mentionAtCaret('@Codex', 3), { start: 0, end: 6, query: 'Co' });
  assert.deepEqual(mentionAtCaret('第一行\n@小助手', 8), { start: 4, end: 8, query: '小助手' });
  assert.equal(mentionAtCaret('me@example.com', 4), null);
  assert.equal(mentionAtCaret('@Codex ', 7), null);
  assert.equal(mentionAtCaret('@Codex', 1, 3), null);
});

test('filter includes Unicode and case-insensitive substrings but excludes self', () => {
  const members = [{ name: 'Codex', role: 'ai' }, { name: 'Human', role: 'human' }, { name: '设计助手', role: 'ai' }];
  assert.deepEqual(matchingMembers(members, 'DEX', 'Human'), [members[0]]);
  assert.deepEqual(matchingMembers(members, '助手', 'Human'), [members[2]]);
  assert.equal(matchingMembers(members, '', 'Human').length, 2);
  assert.deepEqual(matchingMembers(members, '不存在', 'Human'), []);
});

test('choosing replaces whole active fragment and preserves surrounding text/caret', () => {
  const value = '前文 @Code 后文';
  const range = mentionAtCaret(value, 6);
  assert.deepEqual(insertMention(value, range, 'Codex_2'), { value: '前文 @Codex_2 后文', caret: 12 });
  assert.deepEqual(insertMention('@Co', { start: 0, end: 3 }, 'AI Reviewer'), { value: '@AI Reviewer ', caret: 13 });
  assert.deepEqual(insertMention('你好', { start: 2, end: 2 }, '小助手'), { value: '你好 @小助手 ', caret: 8 });
});

test('room template escapes identifiers and embeds syntactically valid client code', () => {
  const html = viewerHtml('r_<img "bad">');
  assert.ok(html.includes('r_&lt;img &quot;bad&quot;&gt;'));
  assert.equal(html.includes('r_<img'), false);
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Script(source));
  assert.ok(html.includes('aria-controls="mention-options"'));
  assert.ok(html.includes('maxlength="16384"'));
});
