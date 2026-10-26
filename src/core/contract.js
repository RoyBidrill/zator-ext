/** Shared names. Popup, options and the worker import these; they do not redefine them. */

export const OUTCOME = Object.freeze({
  OK: 'ok',
  PROBLEM: 'problem',
  IGNORED: 'ignored',
  DROPPED: 'dropped',
});

export const IGNORE_REASON = Object.freeze({
  SINKHOLE: 'sinkhole',
  HIDDEN: 'hidden',
});

export const LIST_ROLE = Object.freeze({
  BYPASS: 'bypass',
  EXCLUDE: 'exclude',
});

export const MESSAGE = Object.freeze({
  GET_TAB_REPORT: 'getTabReport',
  LISTS_CHANGED: 'listsChanged',
  TAB_LOG_CHANGED: 'tabLogChanged',
  REFRESH_LIST: 'refreshList',
  REFRESH_ALL: 'refreshAll',
  GET_PROBE: 'getProbe',
  START_PROBE: 'startProbe',
  STOP_PROBE: 'stopProbe',
  CLEAR_BADGE: 'clearBadge',
  SET_MARKS: 'setMarks',
});

/** Chromium net errors that mean the connection itself failed. */
export const CONNECTION_ERRORS = Object.freeze([
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_TIMED_OUT',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_ABORTED',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_SSL_PROTOCOL_ERROR',
  'net::ERR_HTTP2_PROTOCOL_ERROR',
  'net::ERR_QUIC_PROTOCOL_ERROR',
]);

/** Not a zator candidate: name, network, or the user cancelled. */
export const DROPPED_ERRORS = Object.freeze([
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_ABORTED',
  'net::ERR_BLOCKED_BY_CLIENT',
]);

export const DEFAULT_SINKHOLES = Object.freeze(['0.0.0.0', '::', '127.0.0.1']);

export const STORAGE_KEY = Object.freeze({
  SINKHOLES: 'sinkholes',
  HIDDEN: 'hiddenHosts',
  CATALOG_BASE: 'catalogBase',
  LISTS: 'lists',
  LIST_ENABLED: 'listEnabled',
  PROBE_ATTEMPTS: 'probeAttempts',
  PROBE_PAUSE_SEC: 'probePauseSec',
  PROBE_TIMEOUT_SEC: 'probeTimeoutSec',
  PROBE_MARKS: 'probeMarks',
  PROBE_RUN: 'probeRun',
});

export const PROBE_DEFAULTS = Object.freeze({
  ATTEMPTS: 2,
  PAUSE_SEC: 5,
  TIMEOUT_SEC: 20,
});

export const PROBE_LIMITS = Object.freeze({
  ATTEMPTS: Object.freeze({ min: 1, max: 10 }),
  PAUSE_SEC: Object.freeze({ min: 1, max: 60 }),
  TIMEOUT_SEC: Object.freeze({ min: 5, max: 60 }),
});

/** One attempt's document or host, before the majority fold. */
export const ATTEMPT_OUTCOME = Object.freeze({
  OK: 'ok',
  PROBLEM: 'problem',
  INVALID: 'invalid',
  ABSENT: 'absent',
});

/** Majority fold. Stopped is a run, not a host. */
export const PROBE_VERDICT = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  STOPPED: 'stopped',
});
