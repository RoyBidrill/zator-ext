import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CDN_HOST, QUEUE_CAP, SENT_CAP,
  basicHeader, buildPush, cdnHost, decide, enqueue, normalizeBase, passwordOk, rememberSent, sentKey,
} from '../src/core/zator-push.js';

const CDN = 'rr2---sn-oxuctoxu-axqe.googlevideo.com';

test('cdn host matches the zapret-go media pattern only', () => {
  assert.equal(cdnHost('RR2---SN-oxuctoxu-axqe.googlevideo.com.'), CDN);
  assert.equal(cdnHost('redirector.googlevideo.com'), '');
  assert.equal(cdnHost('sn-oxuctoxu-axqe.googlevideo.com'), '');
  assert.equal(CDN_HOST.test(CDN), true);
});

test('base is an http(s) origin without userinfo', () => {
  assert.deepEqual(normalizeBase('http://192.168.1.31:17682/'), { ok: true, base: 'http://192.168.1.31:17682' });
  assert.equal(normalizeBase('').ok, false);
  assert.equal(normalizeBase('ftp://192.168.1.31').ok, false);
  assert.equal(normalizeBase('http://user:secret@192.168.1.31:17682').ok, false);
});

test('password must be latin-1 so btoa cannot throw', () => {
  assert.equal(passwordOk(''), true);
  assert.equal(passwordOk('päss'), true);
  assert.equal(passwordOk('пароль'), false);
});

test('push body matches the captured zapret-go add request', () => {
  const push = buildPush('http://192.168.1.31:17682', 'googlevideo', CDN);
  assert.equal(push.url, 'http://192.168.1.31:17682/api/domains');
  assert.equal(push.body, 'list=googlevideo&action=add&domain=' + CDN + '&scope=default');
});

test('basic header uses an empty login and is omitted when unset', () => {
  assert.equal(basicHeader(''), null);
  assert.equal(basicHeader('secret'), 'Basic ' + btoa(':secret'));
});

test('decide skips delivered, cooled-down and exhausted hosts', () => {
  const key = sentKey('googlevideo', CDN);
  const base = { sent: [], fails: {}, key, now: 10_000, inFlight: false, lastDoneAt: 0 };
  assert.equal(decide(base), 'send');
  assert.equal(decide({ ...base, sent: [key] }), 'skip');
  assert.equal(decide({ ...base, fails: { [key]: { n: 1, at: 9_500 } } }), 'skip');
  assert.equal(decide({ ...base, fails: { [key]: { n: 5, at: 0 } } }), 'skip');
  assert.equal(decide({ ...base, inFlight: true }), 'wait');
  assert.equal(decide({ ...base, cooledUntil: 11_000 }), 'wait');
  assert.equal(decide({ ...base, cooledUntil: 11_000, manual: true }), 'send');
  assert.equal(decide({ ...base, lastDoneAt: 9_900 }), 'wait');
});

test('manual push jumps ahead and a full queue drops the oldest auto item', () => {
  const auto = (n) => ({ list: 'googlevideo', host: 'rr' + n + '---sn-a.googlevideo.com', manual: false });
  let queue = [];
  for (let n = 1; n <= QUEUE_CAP; n += 1) queue = enqueue(queue, auto(n));
  assert.equal(enqueue(queue, auto(QUEUE_CAP + 1)).length, QUEUE_CAP);
  const manual = { list: 'netrogat', host: 'example.com', manual: true };
  const next = enqueue(queue, manual);
  assert.equal(next.length, QUEUE_CAP);
  assert.equal(next[0], manual);
  assert.equal(next.some((item) => item.host === auto(1).host), false);
});

test('sent memory drops the oldest key past the cap', () => {
  const sent = rememberSent(Array.from({ length: SENT_CAP }, (_, i) => 'k' + i), 'fresh');
  assert.equal(sent.length, SENT_CAP);
  assert.equal(sent[0], 'k1');
  assert.equal(sent.at(-1), 'fresh');
});
