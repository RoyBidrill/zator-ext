import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTEMPT_OUTCOME, PROBE_VERDICT, STORAGE_KEY } from '../src/core/contract.js';
import { classifyAttempt, readSettings, summarize } from '../src/core/probe.js';

test('two greens of three pass, a tie does not', () => {
  const hosts = ['cdn.example'];
  const twoOfThree = summarize([
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.PROBLEM),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
  ], hosts);
  assert.equal(twoOfThree.hosts[0].verdict, PROBE_VERDICT.PASS);

  const oneOne = summarize([
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.PROBLEM),
  ], hosts);
  assert.equal(oneOne.hosts[0].verdict, PROBE_VERDICT.FAIL);

  const twoTwo = summarize([
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.PROBLEM),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.PROBLEM),
  ], hosts);
  assert.equal(twoTwo.hosts[0].verdict, PROBE_VERDICT.FAIL);
});

test('an absence beside a green is not a pass', () => {
  const summary = summarize([
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.ABSENT),
  ], ['cdn.example']);
  assert.equal(summary.hosts[0].verdict, PROBE_VERDICT.FAIL);
  assert.equal(summary.hosts[0].absent, 1);
  assert.equal(summary.verdict, PROBE_VERDICT.FAIL);
});

test('zero scored attempts are not green', () => {
  const summary = summarize([
    attempt(ATTEMPT_OUTCOME.INVALID, ATTEMPT_OUTCOME.INVALID),
    attempt(ATTEMPT_OUTCOME.INVALID, ATTEMPT_OUTCOME.ABSENT),
  ], ['cdn.example']);
  assert.equal(summary.document.verdict, PROBE_VERDICT.FAIL);
  assert.equal(summary.hosts[0].verdict, PROBE_VERDICT.FAIL);
  assert.equal(summary.verdict, PROBE_VERDICT.FAIL);
});

test('a dead document stays red when a subresource answered', () => {
  const classified = classifyAttempt(
    { statusCode: 200 },
    [{
      host: 'cdn.example',
      requests: [
        { error: 'net::ERR_CONNECTION_RESET', type: 'main_frame' },
        { statusCode: 200, type: 'image' },
      ],
    }],
  );
  assert.equal(classified.hosts[0].outcome, ATTEMPT_OUTCOME.PROBLEM);
});

test('an aborted document is invalid and stays out of the majority', () => {
  const classified = classifyAttempt({ error: 'net::ERR_ABORTED' }, [
    { host: 'cdn.example', requests: [] },
  ]);
  assert.equal(classified.document, ATTEMPT_OUTCOME.INVALID);
  assert.equal(classified.hosts[0].outcome, ATTEMPT_OUTCOME.ABSENT);

  const summary = summarize([
    attempt(ATTEMPT_OUTCOME.INVALID, ATTEMPT_OUTCOME.OK),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
    attempt(ATTEMPT_OUTCOME.OK, ATTEMPT_OUTCOME.OK),
  ], ['cdn.example']);
  assert.equal(summary.document.invalid, 1);
  assert.equal(summary.document.verdict, PROBE_VERDICT.PASS);
  assert.equal(summary.verdict, PROBE_VERDICT.PASS);
});

test('a timeout with no document is a red document', () => {
  const classified = classifyAttempt(null, [{ host: 'cdn.example', requests: [{ statusCode: 200 }] }]);
  assert.equal(classified.document, ATTEMPT_OUTCOME.PROBLEM);
  assert.equal(classified.hosts[0].outcome, ATTEMPT_OUTCOME.OK);
});

test('an empty mark set is a refusal, not a verdict', () => {
  assert.deepEqual(summarize([], []), { ok: false, error: 'empty' });
});

test('a broken settings key is not replaced by the default', () => {
  assert.deepEqual(readSettings({}), { ok: true, attempts: 2, pauseSec: 5, timeoutSec: 20 });
  const broken = readSettings({ [STORAGE_KEY.PROBE_PAUSE_SEC]: 61 });
  assert.equal(broken.ok, false);
  assert.equal(broken.error, 'pauseSec');
  assert.equal(readSettings({ [STORAGE_KEY.PROBE_ATTEMPTS]: 0 }).ok, false);
});

function attempt(document, host) {
  return { document, hosts: [{ host: 'cdn.example', outcome: host }] };
}
