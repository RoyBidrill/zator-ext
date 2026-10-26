import { DEFAULT_SINKHOLES, MESSAGE, PROBE_DEFAULTS, PROBE_LIMITS, STORAGE_KEY } from '../core/contract.js';
import { DEFAULT_CATALOG_BASE, KNOWN_LISTS } from '../background/catalog.js';

const ipPattern = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;

document.getElementById('probe-form').addEventListener('submit', saveProbe);
document.getElementById('sinkhole-form').addEventListener('submit', addSinkhole);
document.getElementById('sinkhole-reset').addEventListener('click', () => saveSinkholes([...DEFAULT_SINKHOLES]));
document.getElementById('hidden-clear').addEventListener('click', () => chrome.storage.local.set({ [STORAGE_KEY.HIDDEN]: [] }).then(render));
document.getElementById('refresh-all').addEventListener('click', refreshAll);
document.getElementById('base-form').addEventListener('submit', saveBase);

render();

async function render() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY.SINKHOLES, STORAGE_KEY.HIDDEN, STORAGE_KEY.LISTS,
    STORAGE_KEY.LIST_ENABLED, STORAGE_KEY.CATALOG_BASE,
  ]);
  paintProbe(stored);
  paintSinkholes(stored[STORAGE_KEY.SINKHOLES] || [...DEFAULT_SINKHOLES]);
  paintHidden(stored[STORAGE_KEY.HIDDEN] || []);
  paintLists(stored[STORAGE_KEY.LISTS] || {}, stored[STORAGE_KEY.LIST_ENABLED] || {});
  document.getElementById('catalog-base').value = stored[STORAGE_KEY.CATALOG_BASE] || DEFAULT_CATALOG_BASE;
}

const PROBE_FIELDS = [
  { id: 'probe-attempts', key: STORAGE_KEY.PROBE_ATTEMPTS, fallback: PROBE_DEFAULTS.ATTEMPTS, ...PROBE_LIMITS.ATTEMPTS, label: 'Попытки: 1–10.' },
  { id: 'probe-pause', key: STORAGE_KEY.PROBE_PAUSE_SEC, fallback: PROBE_DEFAULTS.PAUSE_SEC, ...PROBE_LIMITS.PAUSE_SEC, label: 'Пауза: 1–60 секунд.' },
  { id: 'probe-timeout', key: STORAGE_KEY.PROBE_TIMEOUT_SEC, fallback: PROBE_DEFAULTS.TIMEOUT_SEC, ...PROBE_LIMITS.TIMEOUT_SEC, label: 'Таймаут: 5–60 секунд.' },
];

function paintProbe(stored) {
  for (const field of PROBE_FIELDS) {
    const value = stored[field.key];
    document.getElementById(field.id).value = Number.isInteger(value) ? value : field.fallback;
  }
}

async function saveProbe(event) {
  event.preventDefault();
  const error = document.getElementById('probe-error');
  const next = {};
  for (const field of PROBE_FIELDS) {
    const raw = document.getElementById(field.id).value.trim();
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < field.min || value > field.max) {
      error.hidden = false;
      error.textContent = field.label;
      return;
    }
    next[field.key] = value;
  }
  error.hidden = true;
  await chrome.storage.local.set(next);
}

function paintSinkholes(items) {
  const list = document.getElementById('sinkholes');
  list.replaceChildren();
  for (const ip of items) {
    const item = document.createElement('li');
    item.append(text(ip), removeButton(() => saveSinkholes(items.filter((item) => item !== ip))));
    list.append(item);
  }
}

async function addSinkhole(event) {
  event.preventDefault();
  const input = document.getElementById('sinkhole-input');
  const error = document.getElementById('sinkhole-error');
  const value = input.value.trim();
  if (!ipPattern.test(value) || value.includes('/')) {
    error.hidden = false;
    error.textContent = 'Нужен точный IPv4 или IPv6, без маски сети.';
    return;
  }
  error.hidden = true;
  const stored = await chrome.storage.local.get(STORAGE_KEY.SINKHOLES);
  const items = new Set(stored[STORAGE_KEY.SINKHOLES] || [...DEFAULT_SINKHOLES]);
  items.add(value);
  input.value = '';
  await saveSinkholes([...items]);
}

function saveSinkholes(items) {
  return chrome.storage.local.set({ [STORAGE_KEY.SINKHOLES]: items }).then(render);
}

function paintHidden(items) {
  const list = document.getElementById('hidden');
  list.replaceChildren();
  for (const host of items) {
    const item = document.createElement('li');
    item.append(text(host), removeButton(async () => {
      await chrome.storage.local.set({ [STORAGE_KEY.HIDDEN]: items.filter((item) => item !== host) });
      render();
    }));
    list.append(item);
  }
}

function paintLists(copies, enabled) {
  const root = document.getElementById('lists');
  root.replaceChildren();
  for (const list of KNOWN_LISTS) {
    const copy = copies[list.id];
    const row = document.createElement('div');
    row.className = 'list-row';

    const toggle = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabled[list.id] !== false;
    checkbox.addEventListener('change', async () => {
      const stored = await chrome.storage.local.get(STORAGE_KEY.LIST_ENABLED);
      const next = stored[STORAGE_KEY.LIST_ENABLED] || {};
      next[list.id] = checkbox.checked;
      await chrome.storage.local.set({ [STORAGE_KEY.LIST_ENABLED]: next });
    });
    toggle.append(checkbox, text(' ' + list.title));

    const status = document.createElement('span');
    status.textContent = copy?.text
      ? count(copy.text) + ' записей' + (copy.fetchedAt ? ', ' + new Date(copy.fetchedAt).toLocaleString('ru') : '')
      : 'копии ещё нет';
    if (copy?.error) status.className = 'failed', status.textContent += ' — обновление не удалось, оставлена прошлая копия';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Обновить';
    button.addEventListener('click', () => refresh(list.id, button));

    row.append(toggle, status, button);
    root.append(row);
  }
}

async function refresh(id, button) {
  button.disabled = true;
  await chrome.runtime.sendMessage({ type: MESSAGE.REFRESH_LIST, id });
  button.disabled = false;
  render();
}

async function refreshAll() {
  const button = document.getElementById('refresh-all');
  button.disabled = true;
  await chrome.runtime.sendMessage({ type: MESSAGE.REFRESH_ALL });
  button.disabled = false;
  render();
}

function saveBase(event) {
  event.preventDefault();
  const value = document.getElementById('catalog-base').value.trim() || DEFAULT_CATALOG_BASE;
  return chrome.storage.local.set({ [STORAGE_KEY.CATALOG_BASE]: value });
}

function removeButton(onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Удалить';
  button.addEventListener('click', onClick);
  return button;
}

function text(value) {
  return document.createTextNode(value);
}

function count(text) {
  return text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).length;
}
