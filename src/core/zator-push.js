/** Pure zapret-go push rules. No chrome, no fetch. */

export const CDN_HOST = /^rr\d+---sn-[a-z0-9-]+\.googlevideo\.com$/;
export const COOLDOWN_MS = 60_000;
export const FAIL_CAP = 5;
export const GAP_MS = 200;
export const SENT_CAP = 2000;
export const QUEUE_CAP = 100;
export const FETCH_TIMEOUT_MS = 15_000;
export const MANUAL_LISTS = Object.freeze(['netrogat', 'custom_rkn']);
export const DEFAULT_BASE = 'http://192.168.1.31:17682';

/**
 * @param {string} raw
 * @returns {string} normalized media-CDN host, or ''
 */
export function cdnHost(raw) {
  const host = String(raw || '').trim().toLowerCase().replace(/\.+$/, '');
  return CDN_HOST.test(host) ? host : '';
}

/**
 * @param {string} raw
 * @returns {{ ok: true, base: string } | { ok: false, error: string }}
 */
export function normalizeBase(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, error: 'Нужен адрес.' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'Адрес должен быть http:// или https:// URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Адрес должен быть http:// или https:// URL.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Логин и пароль в адресе не принимаются.' };
  }
  const base = url.origin + url.pathname.replace(/\/+$/, '');
  return { ok: true, base };
}

/** @param {string} password */
export function passwordOk(password) {
  const text = String(password ?? '');
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 255) return false;
  }
  return true;
}

/**
 * @param {string} base saved origin, no trailing slash
 * @param {string} list
 * @param {string} host
 */
export function buildPush(base, list, host) {
  const body = new URLSearchParams({
    list, action: 'add', domain: host, scope: 'default',
  });
  return { url: base + '/api/domains', body: body.toString() };
}

/** @param {string} password @returns {string | null} */
export function basicHeader(password) {
  if (!password) return null;
  return 'Basic ' + btoa(':' + password);
}

export function sentKey(list, host) {
  return list + '\n' + host;
}

/**
 * @param {{ sent: string[], fails: Record<string, {n: number, at: number}>, key: string, now: number, inFlight: boolean, lastDoneAt: number, cooledUntil?: number }} state
 * @returns {'skip' | 'wait' | 'send'}
 */
export function decide(state) {
  if (state.sent.includes(state.key)) return 'skip';
  const fail = state.fails[state.key];
  if (fail && fail.n >= FAIL_CAP) return 'skip';
  if (fail && state.now - fail.at < COOLDOWN_MS) return 'skip';
  if (state.inFlight || (!state.manual && state.cooledUntil && state.now < state.cooledUntil)) return 'wait';
  if (state.lastDoneAt && state.now - state.lastDoneAt < GAP_MS) return 'wait';
  return 'send';
}

/**
 * @param {{ list: string, host: string, manual: boolean }[]} queue
 * @param {{ list: string, host: string, manual: boolean }} item
 * @returns {{ list: string, host: string, manual: boolean }[]}
 */
export function enqueue(queue, item) {
  const same = (entry) => entry.list === item.list && entry.host === item.host;
  const rest = queue.filter((entry) => !same(entry));
  if (item.manual) {
    const autoAt = rest.findIndex((entry) => !entry.manual);
    const next = autoAt < 0 ? [...rest, item] : [...rest.slice(0, autoAt), item, ...rest.slice(autoAt)];
    return next.length > QUEUE_CAP ? dropOldestAuto(next) : next;
  }
  if (rest.length >= QUEUE_CAP) return queue;
  return [...rest, item];
}

function dropOldestAuto(queue) {
  const autoAt = queue.findIndex((entry) => !entry.manual);
  if (autoAt < 0) return queue.slice(0, QUEUE_CAP);
  return queue.filter((_, index) => index !== autoAt);
}

/**
 * @param {string[]} sent
 * @param {string} key
 */
export function rememberSent(sent, key) {
  const next = sent.filter((item) => item !== key);
  next.push(key);
  return next.length > SENT_CAP ? next.slice(next.length - SENT_CAP) : next;
}
