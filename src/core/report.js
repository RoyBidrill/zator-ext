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
  };
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
