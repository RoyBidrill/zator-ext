import { ATTEMPT_OUTCOME, MESSAGE, PROBE_VERDICT, STORAGE_KEY } from '../core/contract.js';
import { copyChoices } from '../core/matcher.js';

const TITLES = { ok: 'ОК', problem: 'Проблемы', ignored: 'Игнор' };
const REASONS = {
  'net::ERR_CONNECTION_TIMED_OUT': 'таймаут',
  'net::ERR_TIMED_OUT': 'таймаут',
  'net::ERR_CONNECTION_RESET': 'reset',
  'net::ERR_CONNECTION_CLOSED': 'обрыв',
  'net::ERR_CONNECTION_ABORTED': 'обрыв',
  'net::ERR_EMPTY_RESPONSE': 'пустой ответ',
  'net::ERR_ADDRESS_UNREACHABLE': 'адрес недоступен',
  'net::ERR_SSL_PROTOCOL_ERROR': 'обрыв tls',
  'net::ERR_HTTP2_PROTOCOL_ERROR': 'обрыв http/2',
  'net::ERR_QUIC_PROTOCOL_ERROR': 'обрыв quic',
};
const COVER = { exact: 'только этот хост', subdomains: 'он и поддомены' };
const COPY_TITLE = 'Скопировать правило';
const MARK_TITLE = 'Проверить';
const ATTEMPT_TEXT = {
  ok: 'открылся',
  problem: 'обрыв',
  invalid: 'не в счёте',
  absent: 'не явился',
};
const VERDICT_TEXT = { pass: 'прошёл', fail: 'не прошёл', stopped: 'остановлен' };
const LIST_TITLES = {
  'tcp-yt': 'TCP YouTube', 'udp-yt': 'UDP YouTube', 'tcp-rkn': 'TCP RKN',
  discord: 'Discord', netrogat: 'netrogat', 'rkn-substring': 'подстроки RKN',
  'netrogat-substring': 'подстроки исключений',
};

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

let loading = false;
let pending = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE.LISTS_CHANGED) load();
  if (message.type === MESSAGE.TAB_LOG_CHANGED) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab && message.tabId === tab.id) load();
    });
  }
});

load();

async function load() {
  if (loading) {
    pending = true;
    return;
  }
  loading = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const report = await chrome.runtime.sendMessage({ type: MESSAGE.GET_TAB_REPORT, tabId: tab.id });
    const probe = await chrome.runtime.sendMessage({ type: MESSAGE.GET_PROBE, tabId: tab.id });
    const menuOpen = document.querySelector('.menu:not([hidden]), [aria-expanded="true"]');
    // render() closes an open copy menu via replaceChildren; one later load() paints after it closes.
    if (menuOpen || holdForMenu.waiting) holdForMenu();
    else render(report || { ok: [], problem: [], ignored: [] }, probe || { marks: [] });
  } finally {
    loading = false;
    if (pending) {
      pending = false;
      load();
    }
  }
}

function holdForMenu() {
  if (holdForMenu.waiting) return;
  holdForMenu.waiting = true;
  const done = () => {
    if (document.querySelector('.menu:not([hidden]), [aria-expanded="true"]')) return;
    document.removeEventListener('click', done, true);
    document.removeEventListener('keydown', done, true);
    holdForMenu.waiting = false;
    load();
  };
  document.addEventListener('click', done, true);
  document.addEventListener('keydown', done, true);
}

function render(report, probe) {
  const total = report.ok.length + report.problem.length + report.ignored.length;
  document.getElementById('empty').hidden = total > 0;
  paintProbe(probe);
  for (const name of ['ok', 'problem', 'ignored']) {
    paint(document.getElementById(name), name, report[name], probe.marks || []);
  }
}

function paintProbe(probe) {
  const section = document.getElementById('probe');
  section.replaceChildren();
  const marks = probe.marks || [];
  const running = probe.own && probe.phase && probe.phase !== 'done';
  const foreign = probe.phase && probe.phase !== 'done' && !probe.own;
  if (!marks.length && !probe.phase) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const line = document.createElement('div');
  line.className = 'probe-line';
  const start = document.createElement('button');
  start.type = 'button';
  start.textContent = 'Начать';
  start.disabled = running || foreign || !marks.length || probe.settingsOk === false;
  start.addEventListener('click', () => send(MESSAGE.START_PROBE));
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = 'Остановить';
  stop.disabled = !running;
  stop.addEventListener('click', () => send(MESSAGE.STOP_PROBE));
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Сбросить значок';
  clear.disabled = running;
  clear.addEventListener('click', () => send(MESSAGE.CLEAR_BADGE));
  line.append(start, stop, clear);
  section.append(line);

  if (foreign) section.append(note('Прогон идёт в другой вкладке.'));
  if (probe.settingsOk === false) section.append(note('Настройки проверки вне диапазона. Прогон не запущен.'));
  if (probe.reason) section.append(note(probe.reason));
  if (probe.verdict) section.append(note('Итог: ' + (VERDICT_TEXT[probe.verdict] || probe.verdict)));
  for (const attempt of probe.attempts || []) section.append(attemptView(attempt));
}

function attemptView(attempt) {
  const row = document.createElement('p');
  row.className = 'attempt';
  const documentText = 'Документ: ' + (ATTEMPT_TEXT[attempt.document] || attempt.document);
  const hosts = (attempt.hosts || []).map((host) => host.host + ' — ' + (ATTEMPT_TEXT[host.outcome] || host.outcome));
  row.textContent = attempt.number + '. ' + documentText + (hosts.length ? '. ' + hosts.join('; ') : '');
  return row;
}

function note(text) {
  const node = document.createElement('p');
  node.className = 'muted';
  node.textContent = text;
  return node;
}

function send(type) {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => (
    chrome.runtime.sendMessage({ type, tabId: tab.id }).then(load)
  ));
}

function paint(section, name, rows, marks) {
  const open = section.querySelector('.fold')?.getAttribute('aria-expanded') !== 'false';
  const menuHost = section.querySelector('.menu:not([hidden])')?.closest('.row')?.querySelector('.host')?.textContent;
  section.replaceChildren();
  if (!rows.length) return;
  const body = document.createElement('div');
  body.hidden = !open;
  for (const row of rows) body.append(rowView(row, name, marks.includes(row.host), row.host === menuHost));
  section.append(foldButton(name, rows.length, body, open), body);
}

function foldButton(name, count, body, open) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fold';
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  const chevron = svg();
  chevron.classList.add('chevron');
  chevron.append(path(open ? 'M6 9l6 6l6 -6' : 'M9 6l6 6l-6 6'));
  const title = document.createElement('span');
  title.textContent = TITLES[name] + ' · ' + count;
  button.append(chevron, title);
  button.addEventListener('click', () => {
    const willOpen = body.hidden;
    body.hidden = !willOpen;
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    chevron.replaceChildren(path(willOpen ? 'M6 9l6 6l6 -6' : 'M9 6l6 6l-6 6'));
  });
  return button;
}

function rowView(row, sectionName, marked, menuOpen) {
  const root = document.createElement('div');
  root.className = 'row';

  const host = document.createElement('div');
  host.className = 'host';
  host.append(hostLabel(row.host));

  const marks = document.createElement('div');
  marks.className = 'marks';
  for (const id of row.bypass) marks.append(mark('в обходе: ' + label(id), 'bypass'));
  for (const id of row.exclude) marks.append(mark('в исключениях: ' + label(id), 'exclude'));
  if (row.documentFailed) marks.append(mark('документ не загрузился', 'exclude'));
  if (sectionName === 'problem' && row.reason) marks.append(mark(reasonText(row.reason), 'reason'));
  if (row.ignoreReason === 'sinkhole') marks.append(mark('ip из списка игнора', ''));
  if (row.ignoreReason === 'hidden') marks.append(mark('скрыт вручную', ''));

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(markButton(row.host, marked));
  const menu = copyMenu(row.host, actions, menuOpen);
  if (sectionName === 'problem') actions.append(hideButton(row.host));

  root.append(host, actions, marks, timingView(row), menu);
  return root;
}

function timingView(row) {
  if (!row.timing) return document.createElement('span');
  const node = document.createElement('div');
  node.className = 'timing';
  node.title = 'мин / сред / хвост';
  const time = document.createElement('div');
  time.textContent = trio(row.timing, formatMs) + ' · ' + row.timing.count;
  node.append(time);
  if (row.speed) {
    const speed = document.createElement('div');
    speed.textContent = trio(row.speed, formatBps) + ' · ' + formatBytes(row.speed.medianBytes) + ' · ' + row.speed.count;
    node.append(speed);
  }
  return node;
}

function trio(series, format) {
  return format(series.min) + ' – ' + format(series.avg) + ' – ' + format(series.p99);
}

function formatMs(value) {
  if (value < 1000) return Math.round(value) + ' мс';
  return (value / 1000).toFixed(1) + ' с';
}

function formatBps(value) {
  return formatUnit(value, ['Б/с', 'КБ/с', 'МБ/с']);
}

function formatBytes(value) {
  return formatUnit(value, ['Б', 'КБ', 'МБ']);
}

function formatUnit(value, units) {
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const text = index === 0 ? String(Math.round(scaled)) : scaled.toFixed(1);
  return text + ' ' + units[index];
}

function hostLabel(host) {
  const fragment = document.createDocumentFragment();
  const parts = String(host).split('.');
  parts.forEach((part, index) => {
    fragment.append(part);
    if (index < parts.length - 1) fragment.append('.', document.createElement('wbr'));
  });
  return fragment;
}

function mark(text, kind) {
  const node = document.createElement('span');
  node.className = 'mark ' + kind;
  node.textContent = text;
  return node;
}

function copyMenu(host, actions, menuOpen) {
  const button = iconButton(clipboardIcon(), COPY_TITLE);
  button.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  button.setAttribute('aria-haspopup', 'menu');
  actions.append(button);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.hidden = !menuOpen;
  menu.setAttribute('role', 'menu');

  for (const choice of copyChoices(host)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.setAttribute('role', 'menuitem');
    const rule = document.createElement('span');
    rule.className = 'rule';
    rule.append(hostLabel(choice.text));
    const cover = document.createElement('span');
    cover.className = 'cover';
    cover.textContent = COVER[choice.cover];
    item.append(rule, cover);
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      copyRule(button, choice.text, menu);
    });
    menu.append(item);
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu(button, menu);
  });
  return menu;
}

function toggleMenu(button, menu) {
  const willOpen = menu.hidden;
  closeMenus();
  if (!willOpen) return;
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
}

function closeMenus() {
  for (const menu of document.querySelectorAll('.menu')) {
    menu.hidden = true;
  }
  for (const button of document.querySelectorAll('.icon[aria-expanded="true"]')) {
    button.setAttribute('aria-expanded', 'false');
  }
}

async function copyRule(button, text, menu) {
  await navigator.clipboard.writeText(text);
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  button.classList.add('copied');
  button.title = 'Скопировано';
  button.setAttribute('aria-label', 'Скопировано');
  clearTimeout(button.copiedTimer);
  button.copiedTimer = setTimeout(() => {
    button.classList.remove('copied');
    button.title = COPY_TITLE;
    button.setAttribute('aria-label', COPY_TITLE);
  }, 1000);
}

document.addEventListener('click', closeMenus);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
});

function markButton(host, marked) {
  const button = iconButton(checkIcon(), MARK_TITLE);
  button.setAttribute('aria-pressed', marked ? 'true' : 'false');
  if (marked) button.classList.add('marked');
  button.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const stored = await chrome.storage.local.get(STORAGE_KEY.PROBE_MARKS);
    const marks = stored[STORAGE_KEY.PROBE_MARKS] || {};
    const next = new Set(marks[tab.id] || []);
    if (next.has(host)) next.delete(host);
    else next.add(host);
    marks[tab.id] = [...next];
    await chrome.storage.local.set({ [STORAGE_KEY.PROBE_MARKS]: marks });
    load();
  });
  return button;
}

function hideButton(host) {
  const button = iconButton(eyeOffIcon(), 'Скрыть');
  button.addEventListener('click', async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEY.HIDDEN);
    const hidden = new Set(stored[STORAGE_KEY.HIDDEN] || []);
    hidden.add(host);
    await chrome.storage.local.set({ [STORAGE_KEY.HIDDEN]: [...hidden] });
    load();
  });
  return button;
}

function label(id) {
  return LIST_TITLES[id] || id;
}

function reasonText(error) {
  return REASONS[error] || String(error).replace(/^net::ERR_/, '').toLowerCase().replaceAll('_', ' ');
}

function iconButton(icon, name) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon';
  button.title = name;
  button.setAttribute('aria-label', name);
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  return button;
}

function svg() {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  return node;
}

function path(d) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  node.setAttribute('d', d);
  return node;
}

function clipboardIcon() {
  const node = svg();
  node.append(
    path('M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2'),
    path('M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2'),
  );
  return node;
}

function checkIcon() {
  const node = svg();
  node.append(path('M5 12l5 5l9 -11'));
  return node;
}

function eyeOffIcon() {
  const node = svg();
  node.append(
    path('M10.585 10.587a2 2 0 0 0 2.829 2.828'),
    path('M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87'),
    path('M3 3l18 18'),
  );
  return node;
}
