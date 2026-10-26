/**
 * Declared Content-Length and per-host timing/speed.
 * Speed uses the header the server sent, not bytes on the wire.
 */

export function parseContentLength(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const bytes = Number(text);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return null;
  return bytes;
}

export function contentLengthFromHeaders(headers) {
  if (!Array.isArray(headers)) return null;
  for (const header of headers) {
    if (!header || String(header.name).toLowerCase() !== 'content-length') continue;
    const bytes = parseContentLength(header.value);
    if (bytes !== null) return bytes;
  }
  return null;
}

/**
 * @param {Array<{startedAt?: number, endedAt?: number, contentLength?: number}>} requests
 * @returns {{timing: object | null, speed: object | null}}
 */
export function summarizeRequests(requests) {
  const times = [];
  const speeds = [];
  const sizes = [];

  for (const request of requests) {
    if (typeof request.startedAt !== 'number' || typeof request.endedAt !== 'number') continue;
    const delta = Math.round(request.endedAt - request.startedAt);
    if (delta < 0) continue;
    times.push(delta);
    if (delta === 0) continue;
    const bytes = request.contentLength;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) continue;
    speeds.push(bytes / (delta / 1000));
    sizes.push(bytes);
  }

  return {
    timing: times.length ? series(times, (value) => value, true) : null,
    speed: speeds.length ? { ...series(speeds, (value) => -value, false), medianBytes: median(sizes) } : null,
  };
}

function series(values, worseKey, roundAvg) {
  const sorted = values.slice().sort((a, b) => worseKey(a) - worseKey(b));
  const sum = values.reduce((total, value) => total + value, 0);
  const avg = sum / values.length;
  return {
    count: values.length,
    min: sorted[0],
    avg: roundAvg ? Math.round(avg) : avg,
    p99: sorted[rank(values.length) - 1],
  };
}

function rank(count) {
  return Math.min(count, Math.max(1, Math.ceil(0.99 * count)));
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
