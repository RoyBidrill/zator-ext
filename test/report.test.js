import assert from 'node:assert/strict';
import test from 'node:test';
import { LIST_ROLE } from '../src/core/contract.js';
import { buildSuffixIndex, parseHostlist } from '../src/core/matcher.js';
import { buildReport, nextListCopy } from '../src/core/report.js';

function context(extra = {}) {
  return {
    sinkholes: ['0.0.0.0'],
    hidden: [],
    suffixIndex: buildSuffixIndex([{
      id: 'tcp-rkn', role: LIST_ROLE.BYPASS, entries: parseHostlist('youtube.com\n'),
    }]),
    substringLists: [],
    ...extra,
  };
}

test('a host that answered 400 stays in ok and is marked from the list', () => {
  const hosts = new Map([['www.youtube.com', {
    host: 'www.youtube.com',
    requests: [{ statusCode: 400, type: 'main_frame', startedAt: 0, endedAt: 40 }],
  }]]);
  const report = buildReport(hosts, context());
  assert.equal(report.ok[0].host, 'www.youtube.com');
  assert.deepEqual(report.ok[0].bypass, ['tcp-rkn']);
  assert.equal(report.problem.length, 0);
});

test('a sinkhole ip goes to ignored even after a timeout', () => {
  const hosts = new Map([['blocked.test', {
    host: 'blocked.test',
    requests: [{ error: 'net::ERR_CONNECTION_TIMED_OUT', ip: '0.0.0.0', startedAt: 0, endedAt: 3000 }],
  }]]);
  const report = buildReport(hosts, context());
  assert.equal(report.ignored[0].ignoreReason, 'sinkhole');
  assert.equal(report.problem.length, 0);
});

test('a hidden host stays ignored and a problem keeps its wait', () => {
  const hosts = new Map([
    ['hidden.test', { host: 'hidden.test', requests: [{ error: 'net::ERR_CONNECTION_RESET' }] }],
    ['slow.test', { host: 'slow.test', requests: [{ error: 'net::ERR_TIMED_OUT', startedAt: 10, endedAt: 3010 }] }],
  ]);
  const report = buildReport(hosts, context({ hidden: ['hidden.test'] }));
  assert.equal(report.ignored[0].ignoreReason, 'hidden');
  assert.equal(report.ignored[0].timing, null);
  assert.equal(report.problem[0].timing.count, 1);
  assert.equal(report.problem[0].timing.min, 3000);
  assert.equal(report.problem[0].timing.avg, 3000);
  assert.equal(report.problem[0].timing.p99, 3000);
  assert.equal(report.problem[0].speed, null);
  assert.equal(report.problem[0].reason, 'net::ERR_TIMED_OUT');
});

test('a host that answered and was cancelled stays in ok with a cancel count', () => {
  const hosts = new Map([['rr3---sn-xxx.googlevideo.com', {
    host: 'rr3---sn-xxx.googlevideo.com',
    requests: [
      { statusCode: 200, type: 'xmlhttprequest', startedAt: 0, endedAt: 800 },
      { statusCode: 200, type: 'xmlhttprequest', startedAt: 0, endedAt: 900 },
      { error: 'net::ERR_ABORTED', type: 'xmlhttprequest', startedAt: 100, endedAt: 400 },
      { error: 'net::ERR_ABORTED', type: 'xmlhttprequest', startedAt: 100, endedAt: 500 },
    ],
  }]]);
  const report = buildReport(hosts, context());
  assert.equal(report.ok[0].host, 'rr3---sn-xxx.googlevideo.com');
  assert.equal(report.ok[0].canceled, 2);
  assert.equal(report.ok[0].finished, 2);
  assert.equal(report.problem.length, 0);
});

test('a failed refresh keeps the previous copy', () => {
  const previous = { text: 'youtube.com\n', fetchedAt: 1, error: false };
  const kept = nextListCopy(previous, { ok: false, text: '' });
  assert.equal(kept.text, 'youtube.com\n');
  assert.equal(kept.error, true);

  const replaced = nextListCopy(previous, { ok: true, text: 'youtu.be\n' });
  assert.equal(replaced.text, 'youtu.be\n');
  assert.equal(replaced.error, false);
});
