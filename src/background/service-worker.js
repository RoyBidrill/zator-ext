import { DEFAULT_SINKHOLES, MESSAGE, PROBE_VERDICT, STORAGE_KEY } from '../core/contract.js';
import { buildSuffixIndex, parseHostlist, parseSubstrings } from '../core/matcher.js';
import { classifyAttempt, readSettings, summarize } from '../core/probe.js';
import { buildReport, nextListCopy } from '../core/report.js';
import { contentLengthFromHeaders } from '../core/timing.js';
import { KNOWN_LISTS, downloadList, listUrl } from './catalog.js';

const tabs = new Map();
const ALARM = { PAUSE: 'probe-pause', TIMEOUT: 'probe-timeout' };
const SHOT_KEY = 'probeShot';

chrome.webRequest.onBeforeRequest.addListener(rememberStart, { urls: ['<all_urls>'] });
chrome.webRequest.onHeadersReceived.addListener(rememberLength, { urls: ['<all_urls>'] }, ['responseHeaders']);
chrome.webRequest.onCompleted.addListener(rememberEnd, { urls: ['<all_urls>'] });
chrome.webRequest.onErrorOccurred.addListener(rememberEnd, { urls: ['<all_urls>'] });
chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  chrome.storage.session.remove(SHOT_KEY);
  dropMarks(tabId);
  stopIfTab(tabId, 'вкладка закрыта');
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') {
    finishWait(tabId);
    paintProblemBadge(tabId);
  }
});
chrome.tabs.onActivated.addListener((info) => {
  paintProblemBadge(info.tabId);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM.PAUSE) beginAttempt();
  if (alarm.name === ALARM.TIMEOUT) timeoutAttempt();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MESSAGE.GET_TAB_REPORT) {
    reportFor(message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === MESSAGE.REFRESH_LIST) {
    refreshOne(message.id).then(sendResponse);
    return true;
  }
  if (message.type === MESSAGE.REFRESH_ALL) {
    refreshAll().then(sendResponse);
    return true;
  }
  if (message.type === MESSAGE.GET_PROBE) {
    probeView(message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === MESSAGE.START_PROBE) {
    startProbe(message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === MESSAGE.STOP_PROBE) {
    stopProbe('остановлен', message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === MESSAGE.CLEAR_BADGE) {
    clearBadge().then(sendResponse);
    return true;
  }
  return false;
});

function rememberStart(details) {
  if (details.tabId < 0) return;
  // onBeforeRequest of a new document fires before onCommitted, so clear here.
  if (details.type === 'main_frame') {
    tabs.delete(details.tabId);
  }
  const request = slot(details);
  rememberShot(details, true);
  request.startedAt = details.timeStamp;
  request.type = details.type;
  request.host = hostOf(details.url);
}

function rememberLength(details) {
  if (details.tabId < 0) return;
  const bytes = contentLengthFromHeaders(details.responseHeaders);
  if (bytes === null) return;
  slot(details).contentLength = bytes;
}

function rememberEnd(details) {
  if (details.tabId < 0) return;
  const request = slot(details);
  request.endedAt = details.timeStamp;
  request.type = details.type;
  request.host = request.host || hostOf(details.url);
  if (typeof details.statusCode === 'number') request.statusCode = details.statusCode;
  if (details.error) request.error = details.error;
  if (details.ip) request.ip = details.ip;
  rememberShot(details, false);
  // A live message during a probe would show an empty or foreign slice: reload's main_frame clears tabs.
  if (request.statusCode !== undefined || request.error) notifyTabLog(details.tabId);
}

function notifyTabLog(tabId) {
  chrome.storage.session.get(SHOT_KEY).then((stored) => {
    const shot = stored[SHOT_KEY];
    if (shot && shot.tabId === tabId) return;
    chrome.runtime.sendMessage({ type: MESSAGE.TAB_LOG_CHANGED, tabId }).catch(() => {});
    paintProblemBadge(tabId);
  }).catch(() => {});
}

let shotWrite = Promise.resolve();

function rememberShot(details, start) {
  const host = hostOf(details.url);
  shotWrite = shotWrite.then(async () => {
    const stored = await chrome.storage.session.get(SHOT_KEY);
    const shot = stored[SHOT_KEY];
    if (!shot || shot.tabId !== details.tabId) return;
    if (details.type === 'main_frame' && start) shot.hosts = {};
    if (!shot.hosts[host]) shot.hosts[host] = {};
    const prior = shot.hosts[host][details.requestId] || {};
    shot.hosts[host][details.requestId] = {
      ...prior,
      type: details.type,
      ...(start ? {} : {
        statusCode: details.statusCode,
        error: details.error,
      }),
    };
    await chrome.storage.session.set({ [SHOT_KEY]: shot });
  }).catch(() => {});
}

function slot(details) {
  if (!tabs.has(details.tabId)) tabs.set(details.tabId, new Map());
  const hosts = tabs.get(details.tabId);
  const host = hostOf(details.url);
  if (!hosts.has(host)) hosts.set(host, { host, requests: new Map() });
  const requests = hosts.get(host).requests;
  if (!requests.has(details.requestId)) requests.set(details.requestId, {});
  return requests.get(details.requestId);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function reportFor(tabId) {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY.SINKHOLES, STORAGE_KEY.HIDDEN, STORAGE_KEY.LISTS, STORAGE_KEY.LIST_ENABLED,
  ]);
  const copies = stored[STORAGE_KEY.LISTS] || {};
  const enabled = stored[STORAGE_KEY.LIST_ENABLED] || {};
  const active = KNOWN_LISTS.filter((list) => enabled[list.id] !== false && copies[list.id]?.text);

  const suffixLists = active
    .filter((list) => list.kind === 'suffix')
    .map((list) => ({ id: list.id, role: list.role, entries: parseHostlist(copies[list.id].text) }));
  const substringLists = active
    .filter((list) => list.kind === 'substring')
    .map((list) => ({ id: list.id, role: list.role, needles: parseSubstrings(copies[list.id].text) }));

  const log = tabs.get(tabId) || new Map();
  const hosts = new Map();
  for (const [host, record] of log) {
    hosts.set(host, { host, requests: [...record.requests.values()] });
  }

  return buildReport(hosts, {
    sinkholes: stored[STORAGE_KEY.SINKHOLES] || [...DEFAULT_SINKHOLES],
    hidden: stored[STORAGE_KEY.HIDDEN] || [],
    suffixIndex: buildSuffixIndex(suffixLists),
    substringLists,
  });
}

async function refreshOne(id) {
  const list = KNOWN_LISTS.find((item) => item.id === id);
  if (!list) return { ok: false };
  const stored = await chrome.storage.local.get([STORAGE_KEY.LISTS, STORAGE_KEY.CATALOG_BASE]);
  const copies = stored[STORAGE_KEY.LISTS] || {};
  const previous = copies[id] || { text: '', fetchedAt: null, error: false };
  const fetched = await downloadList(fetch, listUrl(stored[STORAGE_KEY.CATALOG_BASE], list.path));
  const next = nextListCopy(previous, fetched);
  copies[id] = next;
  await chrome.storage.local.set({ [STORAGE_KEY.LISTS]: copies });
  chrome.runtime.sendMessage({ type: MESSAGE.LISTS_CHANGED }).catch(() => {});
  return { ok: !next.error, count: countEntries(next.text) };
}

async function refreshAll() {
  const results = [];
  for (const list of KNOWN_LISTS) {
    results.push({ id: list.id, ...(await refreshOne(list.id)) });
  }
  return results;
}

function countEntries(text) {
  return text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).length;
}

function pageUrl(url) {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname + parsed.search;
}

async function loadRun() {
  const stored = await chrome.storage.session.get(STORAGE_KEY.PROBE_RUN);
  return stored[STORAGE_KEY.PROBE_RUN] || null;
}

async function saveRun(run) {
  await chrome.storage.session.set({ [STORAGE_KEY.PROBE_RUN]: run });
}

async function startProbe(tabId) {
  const current = await loadRun();
  if (current && current.phase !== 'done') return { ok: false, error: 'running' };
  const stored = await chrome.storage.local.get([
    STORAGE_KEY.PROBE_MARKS, STORAGE_KEY.PROBE_ATTEMPTS, STORAGE_KEY.PROBE_PAUSE_SEC, STORAGE_KEY.PROBE_TIMEOUT_SEC,
  ]);
  const settings = readSettings(stored);
  if (!settings.ok) return { ok: false, error: settings.error };
  const marks = (stored[STORAGE_KEY.PROBE_MARKS] || {})[tabId] || [];
  if (!marks.length) return { ok: false, error: 'empty' };
  const tab = await chrome.tabs.get(tabId);
  // Список хостов приходит от попапа. Будущий вызов панели подставит тот же массив.
  const run = {
    tabId,
    pageUrl: pageUrl(tab.url),
    hosts: marks,
    settings,
    attempt: 1,
    phase: 'reload',
    attempts: [],
    stop: false,
    generation: Date.now(),
  };
  await saveRun(run);
  await beginAttempt();
  return { ok: true };
}

async function beginAttempt() {
  const run = await loadRun();
  if (!run || run.phase === 'done') return;
  const tab = await chrome.tabs.get(run.tabId).catch(() => null);
  if (!tab) return stopIfTab(run.tabId, 'вкладка закрыта');
  if (pageUrl(tab.url) !== run.pageUrl) return finish(run, PROBE_VERDICT.STOPPED, 'вкладка ушла');
  if (run.stop) return finish(run, PROBE_VERDICT.STOPPED, 'остановлен');

  await chrome.storage.session.set({ [SHOT_KEY]: { tabId: run.tabId, generation: run.generation, hosts: {} } });
  run.phase = 'wait';
  await saveRun(run);
  await paintBadge(run.attempt + '/' + run.settings.attempts, '#555');
  chrome.alarms.create(ALARM.TIMEOUT, { delayInMinutes: run.settings.timeoutSec / 60 });
  await chrome.tabs.reload(run.tabId, { bypassCache: true });
}

async function finishWait(tabId) {
  const run = await loadRun();
  if (!run || run.phase !== 'wait' || run.tabId !== tabId) return;
  await chrome.alarms.clear(ALARM.TIMEOUT);
  await recordAttempt(run);
}

async function timeoutAttempt() {
  const run = await loadRun();
  if (!run || run.phase !== 'wait') return;
  await recordAttempt(run);
}

async function recordAttempt(run) {
  const fresh = await loadRun();
  if (!fresh || fresh.generation !== run.generation || fresh.phase !== 'wait') return;
  const tab = await chrome.tabs.get(fresh.tabId).catch(() => null);
  if (!tab) return stopIfTab(fresh.tabId, 'вкладка закрыта');
  if (pageUrl(tab.url) !== fresh.pageUrl) return finish(fresh, PROBE_VERDICT.STOPPED, 'вкладка ушла');

  await shotWrite;
  const storedShot = await chrome.storage.session.get(SHOT_KEY);
  const shot = storedShot[SHOT_KEY] && storedShot[SHOT_KEY].generation === fresh.generation
    ? storedShot[SHOT_KEY]
    : { hosts: {} };
  const document = documentOf(shot, new URL(tab.url).hostname);
  const hosts = fresh.hosts.map((host) => ({ host, requests: requestsOf(shot, host) }));
  fresh.attempts.push({ number: fresh.attempt, ...classifyAttempt(document, hosts) });
  fresh.attempt += 1;
  if (fresh.stop || fresh.attempt > fresh.settings.attempts) {
    const summary = summarize(fresh.attempts, fresh.hosts);
    return finish(fresh, summary.verdict, null);
  }
  fresh.phase = 'pause';
  await saveRun(fresh);
  chrome.alarms.create(ALARM.PAUSE, { delayInMinutes: fresh.settings.pauseSec / 60 });
}

function documentOf(shot, host) {
  const records = shot.hosts[host];
  if (!records) return null;
  return Object.values(records).find((request) => request.type === 'main_frame') || null;
}

function requestsOf(shot, host) {
  const records = shot.hosts[host];
  return records ? Object.values(records) : [];
}

async function finish(run, verdict, reason) {
  run.phase = 'done';
  run.verdict = verdict;
  run.reason = reason;
  await saveRun(run);
  await chrome.alarms.clear(ALARM.PAUSE);
  await chrome.alarms.clear(ALARM.TIMEOUT);
  await chrome.storage.session.remove(SHOT_KEY);
  const passed = verdict === PROBE_VERDICT.PASS;
  await paintBadge(passed ? passedCount(run) : '!', passed ? '#0b6b2f' : '#9b1c1c');
  paintProblemBadge(run.tabId);
}

function passedCount(run) {
  const summary = summarize(run.attempts, run.hosts);
  const passed = summary.ok ? summary.hosts.filter((host) => host.verdict === PROBE_VERDICT.PASS).length : 0;
  return passed + '/' + run.hosts.length;
}

async function stopProbe(reason, tabId) {
  const run = await loadRun();
  if (!run || run.phase === 'done' || run.tabId !== tabId) return { ok: false };
  if (run.phase === 'wait') {
    run.stop = true;
    await saveRun(run);
    return { ok: true };
  }
  await finish(run, PROBE_VERDICT.STOPPED, reason);
  return { ok: true };
}

async function stopIfTab(tabId, reason) {
  const run = await loadRun();
  if (!run || run.phase === 'done' || run.tabId !== tabId) return;
  await finish(run, PROBE_VERDICT.STOPPED, reason);
}

async function probeView(tabId) {
  await reconcileMarks(tabId);
  const stored = await chrome.storage.local.get([
    STORAGE_KEY.PROBE_MARKS, STORAGE_KEY.PROBE_ATTEMPTS, STORAGE_KEY.PROBE_PAUSE_SEC, STORAGE_KEY.PROBE_TIMEOUT_SEC,
  ]);
  const settings = readSettings(stored);
  const run = await loadRun();
  const marks = (stored[STORAGE_KEY.PROBE_MARKS] || {})[tabId] || [];
  if (!run) return { marks, settingsOk: settings.ok };
  return {
    marks,
    settingsOk: settings.ok,
    phase: run.phase,
    attempts: run.attempts,
    verdict: run.phase === 'done' ? run.verdict : null,
    reason: run.reason || null,
    own: run.tabId === tabId,
  };
}

async function reconcileMarks(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return dropMarks(tabId);
  const stored = await chrome.storage.local.get(STORAGE_KEY.PROBE_MARKS);
  const marks = stored[STORAGE_KEY.PROBE_MARKS] || {};
  const run = await loadRun();
  if (run && run.tabId === tabId && run.phase !== 'done' && pageUrl(tab.url) !== run.pageUrl) {
    await finish(run, PROBE_VERDICT.STOPPED, 'вкладка ушла');
  }
  if (!marks[tabId]) return;
  if (run && run.tabId === tabId && pageUrl(tab.url) !== run.pageUrl) {
    delete marks[tabId];
    await chrome.storage.local.set({ [STORAGE_KEY.PROBE_MARKS]: marks });
  }
}

function dropMarks(tabId) {
  return chrome.storage.local.get(STORAGE_KEY.PROBE_MARKS).then((stored) => {
    const marks = stored[STORAGE_KEY.PROBE_MARKS] || {};
    if (!marks[tabId]) return;
    delete marks[tabId];
    return chrome.storage.local.set({ [STORAGE_KEY.PROBE_MARKS]: marks });
  });
}

function paintBadge(text, color) {
  return Promise.all([
    chrome.action.setBadgeText({ text: String(text).slice(0, 4) }),
    chrome.action.setBadgeBackgroundColor({ color }),
  ]);
}

function paintProblemBadge(tabId) {
  return loadRun().then((run) => {
    if (run && run.phase !== 'done') return;
    return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab || tab.id !== tabId) return;
      return reportFor(tabId).then((report) => {
        const count = report.problem.length;
        return paintBadge(count ? String(count) : '', '#9b1c1c');
      });
    });
  }).catch(() => {});
}

function clearBadge() {
  return chrome.action.setBadgeText({ text: '' }).then(() => ({ ok: true }));
}

export { reportFor };
