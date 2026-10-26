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
 *
 * @param {Array<{statusCode?: number, error?: string, type?: string}>} requests
 * @returns {{outcome: string, documentFailed: boolean, reason: string | null}}
 */
export function foldHost(requests) {
  let sawAnswer = false;
  let failedAfterAnswer = false;
  let reason = null;
  let documentFailed = false;
  let documentAnswered = false;

  for (const request of requests) {
    if (typeof request.statusCode === 'number') {
      sawAnswer = true;
      failedAfterAnswer = false;
      reason = null;
      if (request.type === 'main_frame') documentAnswered = true;
      continue;
    }
    if (classifyError(request.error) === OUTCOME.PROBLEM) {
      failedAfterAnswer = true;
      reason = request.error;
      if (request.type === 'main_frame') documentFailed = true;
    }
  }

  const documentFlag = documentFailed && !documentAnswered;
  if (failedAfterAnswer) return { outcome: OUTCOME.PROBLEM, documentFailed: documentFlag, reason };
  if (sawAnswer) return { outcome: OUTCOME.OK, documentFailed: documentFlag, reason: null };
  return { outcome: OUTCOME.DROPPED, documentFailed: false, reason: null };
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
