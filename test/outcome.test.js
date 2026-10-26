import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTCOME } from '../src/core/contract.js';
import { classifyError, foldHost, isSinkhole } from '../src/core/outcome.js';

test('an HTTP 500 is ok, not a problem', () => {
  const folded = foldHost([{ statusCode: 500, type: 'main_frame' }]);
  assert.equal(folded.outcome, OUTCOME.OK);
  assert.equal(folded.documentFailed, false);
});

test('a timeout with no later answer is a problem and keeps the wait', () => {
  assert.equal(classifyError('net::ERR_CONNECTION_TIMED_OUT'), OUTCOME.PROBLEM);
  assert.equal(classifyError('net::ERR_CONNECTION_RESET'), OUTCOME.PROBLEM);
  const folded = foldHost([{ error: 'net::ERR_CONNECTION_TIMED_OUT', type: 'main_frame' }]);
  assert.equal(folded.outcome, OUTCOME.PROBLEM);
});

test('a name that does not resolve is dropped', () => {
  assert.equal(classifyError('net::ERR_NAME_NOT_RESOLVED'), OUTCOME.DROPPED);
  assert.equal(foldHost([{ error: 'net::ERR_NAME_NOT_RESOLVED' }]).outcome, OUTCOME.DROPPED);
});

test('a later answer moves the host to ok but remembers a dead document', () => {
  const folded = foldHost([
    { error: 'net::ERR_CONNECTION_RESET', type: 'main_frame' },
    { statusCode: 200, type: 'image' },
  ]);
  assert.equal(folded.outcome, OUTCOME.OK);
  assert.equal(folded.documentFailed, true);
});

test('a reset after a 200 is a problem and keeps the later error', () => {
  const folded = foldHost([
    { statusCode: 200, type: 'main_frame' },
    { error: 'net::ERR_CONNECTION_RESET', type: 'image' },
  ]);
  assert.equal(folded.outcome, OUTCOME.PROBLEM);
  assert.equal(folded.documentFailed, false);
  assert.equal(folded.reason, 'net::ERR_CONNECTION_RESET');
});

test('an abort after a 200 stays ok', () => {
  assert.equal(foldHost([
    { statusCode: 200 },
    { error: 'net::ERR_ABORTED' },
  ]).outcome, OUTCOME.OK);
});

test('two resets with no answer are a problem', () => {
  assert.equal(foldHost([
    { error: 'net::ERR_CONNECTION_RESET' },
    { error: 'net::ERR_TIMED_OUT' },
  ]).outcome, OUTCOME.PROBLEM);
});

test('a reset after a later 200 is a problem', () => {
  assert.equal(foldHost([
    { error: 'net::ERR_CONNECTION_RESET' },
    { statusCode: 200 },
    { error: 'net::ERR_CONNECTION_RESET' },
  ]).outcome, OUTCOME.PROBLEM);
});

test('an ip from the ignore list is a sinkhole; a missing ip is not', () => {
  assert.equal(isSinkhole('0.0.0.0', ['0.0.0.0', '::']), true);
  assert.equal(isSinkhole('', ['0.0.0.0']), false);
  assert.equal(isSinkhole('1.2.3.4', ['0.0.0.0']), false);
});
