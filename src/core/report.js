import { IGNORE_REASON, OUTCOME } from './contract.js';
import { matchHost, matchSubstrings, splitMarks } from './matcher.js';
import { foldHost, isSinkhole } from './outcome.js';
import { summarizeRequests } from './timing.js';

/**
 * Turn one tab's request log into the three popup sections.
 * The worker owns the log; this function only folds it.
 *
 * @param {Map<string, {host: string, requests: object[]}>} hosts
 * @param {{sinkholes: string[], hidden: string[], suffixIndex: Map<string, object[]>, substringLists: object[]}} context
 */
export function buildReport(hosts, context) {
  const sections = { ok: [], problem: [], ignored: [] };

  for (const record of hosts.values()) {
    const row = rowFor(record, context);
    if (!row) continue;
    sections[row.section].push(row);
  }

  for (const name of Object.keys(sections)) {
    sections[name].sort((a, b) => a.host.localeCompare(b.host));
  }
  return sections;
}

function rowFor(record, context) {
  if (context.hidden.includes(record.host)) {
    return baseRow(record, 'ignored', IGNORE_REASON.HIDDEN, context);
  }
  if (record.requests.some((request) => isSinkhole(request.ip, context.sinkholes))) {
    return baseRow(record, 'ignored', IGNORE_REASON.SINKHOLE, context);
  }

  const folded = foldHost(record.requests);
  if (folded.outcome === OUTCOME.DROPPED) return null;
  return {
    ...baseRow(record, folded.outcome, null, context),
    documentFailed: folded.documentFailed,
    reason: folded.reason,
    canceled: folded.canceled,
    finished: folded.finished,
  };
}

function baseRow(record, section, ignoreReason, context) {
  const hits = [
    ...matchHost(record.host, context.suffixIndex),
    ...matchSubstrings(record.host, context.substringLists),
  ];
  const marks = splitMarks(hits);
  return {
    host: record.host,
    section,
    ignoreReason,
    bypass: marks.bypass,
    exclude: marks.exclude,
    documentFailed: false,
    ...summarizeRequests(record.requests),
    ...requestErrors(record.requests),
  };
}

function requestErrors(requests) {
  const errors = [];
  let errorCount = 0;
  for (const request of requests) {
    if (typeof request.error !== 'string' || request.error === '') continue;
    errorCount += 1;
    if (!errors.includes(request.error)) errors.push(request.error);
  }
  return { requestCount: requests.length, errorCount, errors };
}

const CSV_HEADER = 'domain,status,requests,errors,error_list,avg_time_ms,avg_speed_bps';
const CSV_STATUS = { ok: 'ок', problem: 'не ок', ignored: 'игнор' };

/**
 * Rows from buildReport as RFC 4180 text. Pure: no log, no network.
 * @param {object[]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  const lines = [CSV_HEADER];
  for (const row of rows) lines.push(csvLine(row));
  return `\uFEFF${lines.join('\n')}\n`;
}

function csvLine(row) {
  return [
    row.host,
    CSV_STATUS[row.section],
    String(row.requestCount),
    String(row.errorCount),
    row.errors.join('; '),
    row.timing ? String(row.timing.avg) : '',
    row.speed ? String(row.speed.avg) : '',
  ].map(csvField).join(',');
}

function csvField(value) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Keep a failed refresh from wiping a good copy.
 * @param {{text: string, fetchedAt: number | null}} previous
 * @param {{ok: boolean, text: string}} fetched
 */
export function nextListCopy(previous, fetched) {
  if (!fetched.ok || !fetched.text.trim()) return { ...previous, error: true };
  return { text: fetched.text, fetchedAt: Date.now(), error: false };
}
