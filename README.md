# zator-ext

[Русский](README.ru.md)

A Chrome and Chromium extension. It watches requests on the **current tab** and sorts hosts into three popup sections. Bypass lists come from [zator](https://github.com/AloofLibra/zator). It does not write to the router and does not talk to the panel on port 17682.

![Popup: a timeout under Problems and the OK section](docs/popup.png)

A section title folds that section. A Problems row shows a short reason for the latest break (`timeout`, `reset`, `closed`, `tls`, `http/2`, `quic`). Under the name: min, average, and tail of finished requests, and how many were counted. A second line appears only when the server sent Content-Length: speed in the same order, then the median size, then how many requests went into the speed. The check mark flags a host for a page probe. The clipboard icon opens the copy menu. Hide exists only on Problems: the host moves to Ignored and stays there until it is removed in settings.

**Report**, next to Settings, snapshots the tab log at the click. The table lists each host already shown in the popup: domain, ok / not ok / ignored, request count, error count, every distinct error, average time, and average speed. **Download CSV** saves that same snapshot. An empty log still downloads a header-only file. The report is not refreshed by live popup updates and is not sent anywhere.

![Copy menu: three hostlist rules](docs/copy-menu.png)

The menu offers rules in the form pasted into a hostlist. The narrowest comes first: `^host` is that host only, a line without the caret is the host and its subdomains, then parent domains with the same cover but wider. For `00.img.avito.st` that is also `img.avito.st` and `avito.st`. A single label and `*.example.com` are not offered: zapret does not read them that way.

![Badge: attempt one of the run](docs/badge.png)

While a page probe runs, the badge shows `attempt/total` in grey. At the end it flashes green `passed/marked` or a red `!`. Once the active tab finishes loading, the badge again shows the Problems count in red. Clear badge removes the text and does not stop the probe.

| Section | When |
| --- | --- |
| OK | The host's latest finished request is an HTTP response. Any status, including 400 and 500: the server answered, so bypass is not the question. If some requests were cancelled, the row is marked `cancelled N of M`: the host is not a list candidate, but red `(canceled)` rows in Network are not swallowed |
| Problems | The connection failed and no response followed: timeout, reset, TLS, HTTP/2, or QUIC break. A later break overrides an earlier response; a later response moves the host back to OK |
| Ignored | The request IP is in the sinkhole list, or the domain was hidden by hand |

A name that does not resolve, a network drop, a cancelled request, and a blocker abort do not show a host by themselves: that is not a list candidate. A cancel beside an HTTP response stays as a mark on the OK row. It does not move the host to Problems.

If the host is already in a downloaded list copy, the row is marked `in bypass` or `in exclusions`. That is not the probe check mark. An exclusion hit (`netrogat` and exclusion substrings) does not heal the host; it turns processing off. Matching follows zapret rules: `youtube.com` covers `www.youtube.com`, `^host` covers only that host. Until a list has been refreshed at least once, there are no marks: the RKN list is not bundled.

If the tab document failed and a subresource of the same host answered, the row can stay in OK with the mark `document failed`.

## Report

The button reads the log the background already keeps for this tab, from the last document navigation until the click. It does not start a probe and does not open Settings.

| Column | Meaning |
| --- | --- |
| Domain | Host, as in the popup. Not folded to the registrable domain |
| Status | `ok`, `not ok`, or `ignored`, matching the OK / Problems / Ignored sections. A dropped host is omitted |
| Requests | Every logged request, including unfinished ones |
| Errors | Requests with a non-empty `error`, including cancels and DNS failures |
| Error list | Distinct errors in first-seen order. The table shows short labels; the CSV keeps raw `net::ERR_*` codes |
| Avg time | Mean of finished requests, milliseconds. Empty when none finished |
| Avg speed | Mean of `Content-Length / duration`. Empty when the header was not sent. Not bytes on the wire |

CSV is UTF-8 with BOM, comma-separated, RFC 4180. Header: `domain,status,requests,errors,error_list,avg_time_ms,avg_speed_bps`. Time and speed in the file are raw numbers. The file name is `zator-report-<tabId>-<YYYYMMDD-HHmmss>.csv` in local time. Download happens only from **Download CSV**.

## Settings

Open in their own tab, not in the popup.

- Page probe. Defaults: 2 attempts, 5 second pause, 20 second load timeout. Allowed: attempts 1–10, pause 1–60, timeout 5–60. A value outside the range does not start a run.
- Ignore IPs. Defaults: `0.0.0.0`, `::`, `127.0.0.1`. Exact addresses only, no network mask. A host that resolved to one of these goes to Ignored even if the error was a timeout.
- Hidden domains. Cleared here. They are not restored one by one from the popup.
- Known zator lists. Seven lists: TCP/UDP YouTube, TCP RKN, Discord, exclusions, RKN substrings, and exclusion substrings. The default catalog is `https://raw.githubusercontent.com/AloofLibra/zator/zator`. A disabled list does not mark rows. A failed refresh does not wipe the previous copy.

## Install

`chrome://extensions` → Developer mode → Load unpacked → the folder that contains `manifest.json`.

No build. The log lives in the background memory: a new document on the tab clears it, and so does closing the tab. Restarting the background clears the log. Settings and list copies stay.

Permissions:

| Permission | Why |
| --- | --- |
| `<all_urls>` and `webRequest` | See which host on the page answered and which one broke. Without this the popup is empty |
| `tabs` | Know the active tab and reload it during a probe |
| `storage` | Settings, list copies, and probe marks |
| `alarms` | Probe pause and timeout survive the background going to sleep |
| `clipboardWrite` | Declared for copying a rule |

The only outbound request is downloading lists from the catalog URL in settings. Page requests are not forwarded. The CSV stays in the browser.

## Page probe

The check mark flags a host. The mark survives closing the popup and a hash-only navigation. A different path clears it. Start appears once at least one host is marked: it reloads this same tab a few times and checks whether the marked hosts showed up together. A second run from another tab does not start: one badge per window.

A green result means the document opened and every marked host had more answers than breaks, with no absence. A tie, a zero score, or one absence is a fail. A host missing from an attempt's log is neither a success nor a break.

A green run only means the page opened in this browser. It does not mean a new strategy worked: the browser takes a different path than a check from the router.

## What it does not do

- It does not tell a block by name from a block by IP. A timeout looks the same.
- It does not see UDP or programs outside the browser.
- It does not confirm a `0.0.0.0` sinkhole if the browser did not attach an IP to the error. That host stays in Problems.
- It does not add domains to zator by itself. A copied line is pasted into a list by hand.
- It does not upload the report, and it does not read the router debug log.

## Development

From this folder:

```bash
npm test
```

That is `node --test test/*.test.js`. Node 18 or newer, no dependencies. What the tests do not open is listed in `test/MANUAL.md`.
