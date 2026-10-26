import assert from 'node:assert/strict';
import test from 'node:test';
import { LIST_ROLE } from '../src/core/contract.js';
import {
  buildSuffixIndex, copyBare, copyChoices, copyExact, matchHost, matchSubstrings, parseHostlist, parseSubstrings, splitMarks,
} from '../src/core/matcher.js';
import { netrogat, substrings, youtube } from './fixtures/lists.js';

function indexOf(entries, id, role) {
  return buildSuffixIndex([{ id, role, entries }]);
}

test('www.youtube.com matches a bare youtube.com entry', () => {
  const index = indexOf(parseHostlist(youtube), 'yt', LIST_ROLE.BYPASS);
  const hits = matchHost('www.youtube.com', index);
  assert.deepEqual(splitMarks(hits).bypass, ['yt']);
});

test('notyoutube.com does not match youtube.com', () => {
  const index = indexOf(parseHostlist(youtube), 'yt', LIST_ROLE.BYPASS);
  assert.equal(matchHost('notyoutube.com', index).length, 0);
});

test('a caret entry matches only that host', () => {
  const index = indexOf(parseHostlist(youtube), 'yt', LIST_ROLE.BYPASS);
  assert.equal(matchHost('ytimg.l.google.com', index).length, 1);
  assert.equal(matchHost('a.ytimg.l.google.com', index).length, 0);
});

test('an exclude hit is reported apart from a bypass hit', () => {
  const index = buildSuffixIndex([
    { id: 'rkn', role: LIST_ROLE.BYPASS, entries: parseHostlist('pinterest.com\n') },
    { id: 'netrogat', role: LIST_ROLE.EXCLUDE, entries: parseHostlist(netrogat) },
  ]);
  const marks = splitMarks(matchHost('www.pinterest.com', index));
  assert.deepEqual(marks.bypass, ['rkn']);
  assert.deepEqual(marks.exclude, ['netrogat']);
});

test('a disabled list is simply absent from the index', () => {
  const index = buildSuffixIndex([]);
  assert.equal(matchHost('youtube.com', index).length, 0);
});

test('substring lists match inside the name', () => {
  const hits = matchSubstrings('static.cdn.example', [
    { id: 'sub', role: LIST_ROLE.BYPASS, needles: ['cdn'] },
  ]);
  assert.equal(hits[0].entry, 'cdn');
  assert.equal(matchSubstrings('example.com', [
    { id: 'sub', role: LIST_ROLE.BYPASS, needles: parseSubstrings(substrings) },
  ]).length, 0);
});

test('copy buttons speak zapret, not a glob', () => {
  assert.equal(copyBare('Example.COM.'), 'example.com');
  assert.equal(copyExact('example.com'), '^example.com');
});

test('copy menu walks suffixes and never offers a star or a single label', () => {
  assert.deepEqual(copyChoices('00.img.avito.st').map((choice) => choice.text), [
    '^00.img.avito.st',
    '00.img.avito.st',
    'img.avito.st',
    'avito.st',
  ]);
  assert.equal(copyChoices('00.img.avito.st').at(-1).cover, 'subdomains');
  assert.deepEqual(copyChoices('YouTube.com').map((choice) => choice.text), [
    '^youtube.com',
    'youtube.com',
  ]);
  assert.deepEqual(copyChoices('localhost').map((choice) => choice.text), [
    '^localhost',
    'localhost',
  ]);
  assert.deepEqual(copyChoices('1.2.3.4').map((choice) => choice.text), [
    '^1.2.3.4',
    '1.2.3.4',
  ]);
  assert.deepEqual(copyChoices('2001:db8::1'), [
    { text: '^2001:db8::1', cover: 'exact' },
    { text: '2001:db8::1', cover: 'subdomains' },
  ]);
  assert.deepEqual(copyChoices('  '), []);
  assert.equal(copyChoices('00.img.avito.st').some((choice) => choice.text.includes('*')), false);
});
