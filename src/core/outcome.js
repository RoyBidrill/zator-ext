import { CONNECTION_ERRORS, DROPPED_ERRORS, OUTCOME } from './contract.js';

const connectionErrors = new Set(CONNECTION_ERRORS);
const droppedErrors = new Set(DROPPED_ERRORS);

/**
 * @param {string} error
 * @returns {'problem' | 'dropped' | null}
 */
export function classifyError(error) {
  if (connectionErrors.has(error)) return OUTCOME.PROBLEM;
  if (droppedErrors.has(error)) return OUTCOME.DROPPED;
  return null;
}

/**
 * Fold one host's requests into a section.
 * The later of the last HTTP answer and a connection failure wins.
 * A failed main frame stays flagged even when a subresource of the same host answered.
 * Cancels (ERR_ABORTED, a blocker) never move the section, but they are counted:
 * a media host can answer 200 and still have DevTools-red videoplayback beside it.
 *
 * @param {Array<{statusCode?: number, error?: string, type?: string}>} requests
 * @returns {{outcome: string, documentFailed: boolean, reason: string | null, canceled: number, finished: number}}
 */
export function foldHost(requests) {
  let sawAnswer = false;
  let failedAfterAnswer = false;
  let reason = null;
  let documentFailed = false;
  let documentAnswered = false;
  let canceled = 0;
  let finished = 0;

  for (const request of requests) {
    if (typeof request.statusCode === 'number') {
      sawAnswer = true;
      failedAfterAnswer = false;
      reason = null;
      finished += 1;
      if (request.type === 'main_frame') documentAnswered = true;
      continue;
    }
    const kind = classifyError(request.error);
    if (kind === OUTCOME.DROPPED && isCancel(request.error)) canceled += 1;
    if (kind === OUTCOME.PROBLEM) {
      failedAfterAnswer = true;
      reason = request.error;
      if (request.type === 'main_frame') documentFailed = true;
    }
  }

  const documentFlag = documentFailed && !documentAnswered;
  const counts = { canceled, finished };
  if (failedAfterAnswer) return { outcome: OUTCOME.PROBLEM, documentFailed: documentFlag, reason, ...counts };
  if (sawAnswer) return { outcome: OUTCOME.OK, documentFailed: documentFlag, reason: null, ...counts };
  return { outcome: OUTCOME.DROPPED, documentFailed: false, reason: null, ...counts };
}

function isCancel(error) {
  return error === 'net::ERR_ABORTED' || error === 'net::ERR_BLOCKED_BY_CLIENT';
}

/**
 * @param {string} ip
 * @param {readonly string[]} sinkholes
 * @returns {boolean}
 */
export function isSinkhole(ip, sinkholes) {
  if (!ip) return false;
  return sinkholes.includes(ip);
}
