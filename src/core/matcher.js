import { LIST_ROLE } from './contract.js';

/**
 * zapret hostlist: a bare entry covers the host and its subdomains.
 * An entry starting with ^ covers that host only. * is not a wildcard.
 *
 * @param {string} text
 * @returns {Array<{host: string, exact: boolean}>}
 */
export function parseHostlist(text) {
  const entries = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const exact = line.startsWith('^');
    const host = (exact ? line.slice(1) : line).trim().toLowerCase();
    if (!host || host.includes('*')) continue;
    entries.push({ host, exact });
  }
  return entries;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseSubstrings(text) {
  const needles = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim().toLowerCase();
    if (!line || line.startsWith('#')) continue;
    needles.push(line);
  }
  return needles;
}

/**
 * Index keyed by the last label, so a lookup never walks the whole RKN list.
 * @param {Array<{id: string, role: string, entries: Array<{host: string, exact: boolean}>}>} lists
 */
export function buildSuffixIndex(lists) {
  const byLastLabel = new Map();
  for (const list of lists) {
    for (const entry of list.entries) {
      const lastLabel = entry.host.split('.').pop();
      if (!byLastLabel.has(lastLabel)) byLastLabel.set(lastLabel, []);
      byLastLabel.get(lastLabel).push({ ...entry, id: list.id, role: list.role });
    }
  }
  return byLastLabel;
}

/**
 * @param {string} host
 * @param {Map<string, Array<{host: string, exact: boolean, id: string, role: string}>>} index
 * @returns {Array<{id: string, role: string, entry: string}>}
 */
export function matchHost(host, index) {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return [];
  const labels = normalized.split('.');
  const bucket = index.get(labels[labels.length - 1]) || [];
  const hits = [];
  const seen = new Set();

  for (const entry of bucket) {
    const covered = entry.exact
      ? normalized === entry.host
      : normalized === entry.host || normalized.endsWith('.' + entry.host);
    if (!covered) continue;
    const key = entry.role + ':' + entry.id;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ id: entry.id, role: entry.role, entry: entry.exact ? '^' + entry.host : entry.host });
  }
  return hits;
}

/**
 * @param {string} host
 * @param {Array<{id: string, role: string, needles: string[]}>} lists
 * @returns {Array<{id: string, role: string, entry: string}>}
 */
export function matchSubstrings(host, lists) {
  const normalized = host.trim().toLowerCase();
  const hits = [];
  for (const list of lists) {
    const needle = list.needles.find((item) => normalized.includes(item));
    if (!needle) continue;
    hits.push({ id: list.id, role: list.role, entry: needle });
  }
  return hits;
}

/**
 * @param {Array<{id: string, role: string}>} hits
 * @returns {{bypass: string[], exclude: string[]}}
 */
export function splitMarks(hits) {
  return {
    bypass: hits.filter((hit) => hit.role === LIST_ROLE.BYPASS).map((hit) => hit.id),
    exclude: hits.filter((hit) => hit.role === LIST_ROLE.EXCLUDE).map((hit) => hit.id),
  };
}

/** What the copy menu puts on the clipboard. zapret has no *.host form. */
export function copyBare(host) {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

export function copyExact(host) {
  return '^' + copyBare(host);
}

/**
 * Rules from narrowest to widest. A bare entry covers that name and its
 * subdomains, so a star is never offered. A single label is not a rule.
 * An address is not split: 1.2.3 is not a domain.
 *
 * @param {string} host
 * @returns {Array<{text: string, cover: 'exact' | 'subdomains'}>}
 */
export function copyChoices(host) {
  const bare = copyBare(host);
  if (!bare) return [];
  const choices = [
    { text: '^' + bare, cover: 'exact' },
    { text: bare, cover: 'subdomains' },
  ];
  if (bare.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return choices;
  const labels = bare.split('.').filter(Boolean);
  for (let index = 1; index <= labels.length - 2; index += 1) {
    choices.push({ text: labels.slice(index).join('.'), cover: 'subdomains' });
  }
  return choices;
}
