import { LIST_ROLE } from '../core/contract.js';

/**
 * Lists config.default actually loads. Roles are fixed; the user only toggles matching.
 * Paths are the repo layout, not the flattened /opt/zator names.
 */
export const KNOWN_LISTS = Object.freeze([
  { id: 'tcp-yt', title: 'TCP YouTube', role: LIST_ROLE.BYPASS, kind: 'suffix', path: 'extra_strats/TCP/YT/List.txt' },
  { id: 'udp-yt', title: 'UDP YouTube', role: LIST_ROLE.BYPASS, kind: 'suffix', path: 'extra_strats/UDP/YT/List.txt' },
  { id: 'tcp-rkn', title: 'TCP RKN', role: LIST_ROLE.BYPASS, kind: 'suffix', path: 'extra_strats/TCP/RKN/List.txt' },
  { id: 'discord', title: 'Discord', role: LIST_ROLE.BYPASS, kind: 'suffix', path: 'extra_strats/TCP/RKN/Discord.txt' },
  { id: 'netrogat', title: 'Исключения', role: LIST_ROLE.EXCLUDE, kind: 'suffix', path: 'lists/netrogat.txt' },
  { id: 'rkn-substring', title: 'Подстроки RKN', role: LIST_ROLE.BYPASS, kind: 'substring', path: 'extra_strats/TCP/RKN/Domains_By_Substring.txt' },
  { id: 'netrogat-substring', title: 'Подстроки исключений', role: LIST_ROLE.EXCLUDE, kind: 'substring', path: 'lists/netrogat_substrings.txt' },
]);

export const DEFAULT_CATALOG_BASE = 'https://raw.githubusercontent.com/AloofLibra/zator/zator';

/**
 * @param {string} base
 * @param {string} path
 */
export function listUrl(base, path) {
  const trimmed = (base || DEFAULT_CATALOG_BASE).replace(/\/+$/, '');
  return trimmed + '/' + path;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @returns {Promise<{ok: boolean, text: string}>}
 */
export async function downloadList(fetchImpl, url) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return { ok: false, text: '' };
    const text = await response.text();
    return { ok: text.trim().length > 0, text };
  } catch {
    return { ok: false, text: '' };
  }
}
