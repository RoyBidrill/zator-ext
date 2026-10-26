import { ATTEMPT_OUTCOME, CONNECTION_ERRORS, PROBE_DEFAULTS, PROBE_LIMITS, PROBE_VERDICT, STORAGE_KEY } from './contract.js';

const connectionErrors = new Set(CONNECTION_ERRORS);

const FIELDS = Object.freeze([
  { key: STORAGE_KEY.PROBE_ATTEMPTS, name: 'attempts', fallback: PROBE_DEFAULTS.ATTEMPTS, ...PROBE_LIMITS.ATTEMPTS },
  { key: STORAGE_KEY.PROBE_PAUSE_SEC, name: 'pauseSec', fallback: PROBE_DEFAULTS.PAUSE_SEC, ...PROBE_LIMITS.PAUSE_SEC },
  { key: STORAGE_KEY.PROBE_TIMEOUT_SEC, name: 'timeoutSec', fallback: PROBE_DEFAULTS.TIMEOUT_SEC, ...PROBE_LIMITS.TIMEOUT_SEC },
]);

/**
 * Fold one reload into a document outcome and one outcome per marked host.
 * A timed-out attempt passes document: null. An empty requests array is absence.
 * @param {{statusCode?: number, error?: string} | null} document
 * @param {Array<{host: string, requests: Array<{statusCode?: number, error?: string, type?: string}>}>} hosts
 */
export function classifyAttempt(document, hosts) {
  return {
    document: documentOutcome(document),
    hosts: hosts.map((host) => ({ host: host.host, outcome: hostOutcome(host.requests) })),
  };
}

/**
 * Majority over attempts. A host passes only with scored attempts, more ok than
 * problem, and zero absences. A tie, a zero score, or one absence is a fail.
 * @param {Array<{document: string, hosts: Array<{host: string, outcome: string}>}>} attempts
 * @param {readonly string[]} markedHosts
 */
export function summarize(attempts, markedHosts) {
  if (!markedHosts.length) return { ok: false, error: 'empty' };

  const document = tally(attempts.map((attempt) => attempt.document), false);
  const hosts = markedHosts.map((host) => {
    const outcomes = attempts.map((attempt) => outcomeOf(attempt, host));
    return { host, ...tally(outcomes, true) };
  });
  const pass = document.verdict === PROBE_VERDICT.PASS && hosts.every((host) => host.verdict === PROBE_VERDICT.PASS);

  return { ok: true, verdict: pass ? PROBE_VERDICT.PASS : PROBE_VERDICT.FAIL, document, hosts };
}

/**
 * Missing key → default. Present but out of range → refuse, do not substitute.
 * @param {Record<string, unknown>} stored
 */
export function readSettings(stored) {
  const value = {};
  for (const field of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(stored, field.key) || stored[field.key] == null) {
      value[field.name] = field.fallback;
      continue;
    }
    if (!inRange(stored[field.key], field.min, field.max)) {
      return { ok: false, error: field.name };
    }
    value[field.name] = stored[field.key];
  }
  return { ok: true, ...value };
}

function documentOutcome(document) {
  if (!document || typeof document.statusCode !== 'number') {
    if (document && connectionErrors.has(document.error)) return ATTEMPT_OUTCOME.PROBLEM;
    if (!document) return ATTEMPT_OUTCOME.PROBLEM;
    return ATTEMPT_OUTCOME.INVALID;
  }
  return ATTEMPT_OUTCOME.OK;
}

function hostOutcome(requests) {
  if (!requests.length) return ATTEMPT_OUTCOME.ABSENT;

  let answered = false;
  let connectionFailed = false;
  let documentFailed = false;
  let documentAnswered = false;

  for (const request of requests) {
    if (typeof request.statusCode === 'number') {
      answered = true;
      if (request.type === 'main_frame') documentAnswered = true;
      continue;
    }
    if (connectionErrors.has(request.error)) {
      connectionFailed = true;
      if (request.type === 'main_frame') documentFailed = true;
    }
  }

  if (documentFailed && !documentAnswered) return ATTEMPT_OUTCOME.PROBLEM;
  if (answered) return ATTEMPT_OUTCOME.OK;
  if (connectionFailed) return ATTEMPT_OUTCOME.PROBLEM;
  return ATTEMPT_OUTCOME.INVALID;
}

function tally(outcomes, countAbsence) {
  let ok = 0;
  let problem = 0;
  let invalid = 0;
  let absent = 0;
  for (const outcome of outcomes) {
    if (outcome === ATTEMPT_OUTCOME.OK) ok += 1;
    else if (outcome === ATTEMPT_OUTCOME.PROBLEM) problem += 1;
    else if (outcome === ATTEMPT_OUTCOME.ABSENT) absent += 1;
    else invalid += 1;
  }
  const scored = ok + problem;
  const pass = scored > 0 && ok > problem && (!countAbsence || absent === 0);
  return {
    verdict: pass ? PROBE_VERDICT.PASS : PROBE_VERDICT.FAIL,
    ok,
    problem,
    invalid,
    absent,
  };
}

function outcomeOf(attempt, host) {
  const row = attempt.hosts.find((item) => item.host === host);
  return row ? row.outcome : ATTEMPT_OUTCOME.ABSENT;
}

function inRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}
