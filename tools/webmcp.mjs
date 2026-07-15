#!/usr/bin/env node
/**
 * WebMCP agent CLI — drive the page's WebMCP tools in Chrome over the DevTools
 * Protocol. Lets any terminal-side agent (e.g. Claude Code) act as the WebMCP
 * consumer: discover tools, then execute them in the live page.
 *
 * Usage:
 *   node webmcp.mjs ensure                       Launch the debug Chrome if it is not up
 *   node webmcp.mjs setup [adminPath]            ensure + log in + open a wp-admin URL
 *                                                (default /wp-admin/), wait for tools.
 *                                                Pass an editor URL to land in it ready, e.g.
 *                                                setup "/wp-admin/post-new.php?post_type=post"
 *   node webmcp.mjs list                         List registered WebMCP tools (JSON)
 *   node webmcp.mjs call <name> '<json>'|@file   Execute a tool with JSON args (inline or @path)
 *   node webmcp.mjs batch '<json>'|@file|-       Run [{name,args},…] in ONE CDP session
 *                                                (@path, or - for stdin). Same-page calls only.
 *                                                Reports {ok, failed, results[].ok}; exits
 *                                                non-zero if any step failed or was refused.
 *   node webmcp.mjs screenshot <url> <out> [w]   Full-page PNG of a URL (default width 1400)
 *
 * Configuration (all optional, sensible defaults):
 *   CDP_PORT=9222            Chrome remote-debugging port
 *   WP_URL=http://localhost:8080
 *   WP_USER=admin  WP_PASS=admin
 *   CHROME_BIN=...           Chrome executable (auto-detected per platform)
 *   CHROME_PROFILE=...       throwaway user-data-dir (default: <tmp>/wpwebmcp-chrome-profile)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.CDP_PORT || '9222';
const WP_URL = process.env.WP_URL || 'http://localhost:8080';
const WP_USER = process.env.WP_USER || 'admin';
const WP_PASS = process.env.WP_PASS || 'admin';
const CHROME_BIN = process.env.CHROME_BIN || defaultChrome();
const CHROME_PROFILE = process.env.CHROME_PROFILE || path.join(os.tmpdir(), 'wpwebmcp-chrome-profile');
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve a JSON-args argument: "@path" reads a file, "-" reads stdin, else literal. */
function readArgs(ref) {
  if (!ref) return '{}';
  if (ref === '-') return fs.readFileSync(0, 'utf8');
  if (ref.startsWith('@')) return fs.readFileSync(ref.slice(1), 'utf8');
  return ref;
}

/** Best-guess Chrome path per platform. Override with CHROME_BIN. */
function defaultChrome() {
  switch (process.platform) {
    case 'darwin': return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'win32': return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    default: return 'google-chrome';
  }
}

async function portUp() {
  try { return (await fetch(`${BASE}/json/version`)).ok; } catch { return false; }
}

/** Launch the debug Chrome with the WebMCP flag if the port is not already up. */
async function ensureChrome() {
  if (await portUp()) return { launched: false, port: PORT };
  const child = spawn(CHROME_BIN, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    '--enable-features=WebMCPTesting,DevToolsWebMCPSupport',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 30; i++) { await sleep(500); if (await portUp()) return { launched: true, port: PORT }; }
  throw new Error(`Chrome did not open port ${PORT}. Is "${CHROME_BIN}" correct? Set CHROME_BIN.`);
}

async function pageTarget() {
  const list = await (await fetch(`${BASE}/json`)).json();
  const t = list.find((x) => x.type === 'page');
  if (!t) throw new Error('No page target available.');
  return t;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method && listeners.has(m.method)) {
        listeners.get(m.method)(m.params);
      }
    };
    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onopen = () => resolve({
      send: (method, params = {}) =>
        new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      on: (method, fn) => listeners.set(method, fn),
      close: () => ws.close(),
    });
  });
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function withPage(fn) {
  await ensureChrome();
  const t = await pageTarget();
  const cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  try { return await fn(cdp); } finally { cdp.close(); }
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await evaluate(cdp, 'document.readyState') === 'complete') return; }
}

const TESTING = `(navigator.modelContextTesting || document.modelContextTesting)`;

async function cmdEnsure() {
  return { chrome: await ensureChrome(), profile: CHROME_PROFILE, chromeBin: CHROME_BIN };
}

async function cmdSetup(adminPath) {
  const path = adminPath || '/wp-admin/';
  const dest = path.startsWith('http') ? path : `${WP_URL}${path}`;
  return withPage(async (cdp) => {
    await navigate(cdp, `${WP_URL}/wp-login.php`);
    await evaluate(cdp, `(() => {
      const u = document.querySelector('#user_login');
      if (!u) return 'already';
      u.value = ${JSON.stringify(WP_USER)};
      document.querySelector('#user_pass').value = ${JSON.stringify(WP_PASS)};
      const r = document.querySelector('#rememberme'); if (r) r.checked = true;
      document.querySelector('#loginform').submit();
      return 'submitted';
    })()`);
    await sleep(1500);
    await navigate(cdp, dest);
    let tools = [];
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      tools = await evaluate(cdp, `(async () => { const t = ${TESTING}; return t ? (await t.listTools()).map(x=>x.name) : []; })()`, true);
      if (tools.length) break;
    }
    // A block editor re-parses its content once after mount, regenerating every
    // block clientId. Wait for the top-level clientIds to stop changing so a
    // caller's read-blocks → mutate sequence targets IDs that still exist.
    // editorSettled is null when the tab is not a block editor (nothing to wait
    // for), true once two consecutive reads match, false if it never stabilized.
    const idsExpr = `(() => {
      const s = window.wp && wp.data && wp.data.select('core/block-editor');
      if (!s || typeof s.getBlocks !== 'function') return null;
      return JSON.stringify(s.getBlocks().map((b) => b.clientId));
    })()`;
    let editorSettled = null;
    let prevIds = null;
    for (let i = 0; i < 20; i++) {
      const ids = await evaluate(cdp, idsExpr);
      if (ids === null) break; // not a block editor
      if (ids === prevIds) { editorSettled = true; break; }
      editorSettled = false;
      prevIds = ids;
      await sleep(400);
    }
    return { ok: true, url: await evaluate(cdp, 'location.href'), tools, editorSettled };
  });
}

/**
 * Did a batch step actually succeed? A tool can run without throwing yet still
 * refuse the action — the WebMCP testing hook reports that in the result, not as
 * an exception, so a naive batch looked "ok" while every write was rejected.
 * False on: an exec/transport error; a declined confirmation ({cancelled:true});
 * an explicit {ok:false}/{success:false}; or the editor write tools' refusal
 * shape ({inserted|replaced|moved|…:false, reason:"…"}). The result value is the
 * tool's own JSON string; an opaque (non-JSON) string is treated as success.
 */
export function stepOk(res) {
  if (!res || res.error) return false;
  let r = res.result;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { return true; }
  }
  if (r && typeof r === 'object') {
    if (r.cancelled === true || r.ok === false || r.success === false) return false;
    // Editor writes signal refusal as an action flag set false alongside a reason.
    if (typeof r.reason === 'string' && Object.values(r).some((v) => v === false)) return false;
  }
  return true;
}

/** Execute one tool in the page and return {result} or {error}; never throws. */
function execTool(cdp, name, argsJson) {
  return evaluate(cdp, `(async () => {
    const t = ${TESTING};
    if (!t) return { error: 'modelContextTesting unavailable' };
    try { return { result: await t.executeTool(${JSON.stringify(name)}, ${JSON.stringify(argsJson)}) }; }
    catch (e) { return { error: String(e && e.message || e) }; }
  })()`, true);
}

async function cmdList() {
  return withPage(async (cdp) =>
    evaluate(cdp, `(async () => {
      const t = ${TESTING};
      if (!t) return { error: 'modelContextTesting unavailable — is the WebMCP flag enabled?' };
      return (await t.listTools()).map(x => ({ name: x.name, description: x.description, inputSchema: x.inputSchema, annotations: x.annotations }));
    })()`, true));
}

async function cmdCall(name, argsRef) {
  const args = readArgs(argsRef);
  JSON.parse(args); // validate locally
  return withPage((cdp) => execTool(cdp, name, args));
}

// Run a list of [{name, args}] in ONE CDP session — no per-call process/connect
// overhead. args may be a JSON object (from the file) or a JSON string. Runs
// sequentially, capturing each call's {result}/{error}; never early-exits. For
// SAME-PAGE sequences (a page build) — do not put webmcp-navigate mid-batch, it
// reloads the page and drops the tools.
async function cmdBatch(specRef) {
  const calls = JSON.parse(readArgs(specRef || '-'));
  if (!Array.isArray(calls)) throw new Error('batch expects a JSON array of {name, args}.');
  return withPage(async (cdp) => {
    const results = [];
    for (const c of calls) {
      const argsJson = typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {});
      const res = { name: c.name, ...(await execTool(cdp, c.name, argsJson)) };
      res.ok = stepOk(res);
      results.push(res);
    }
    const failed = results.filter((r) => !r.ok).length;
    return { ok: failed === 0, failed, count: results.length, results };
  });
}

// Full-page PNG of a URL, captured in a THROWAWAY tab so the tab you were driving
// (e.g. the editor, with its loaded tools) is left untouched — no re-setup needed.
// Auto-accepts any dialog so a stray beforeunload cannot hang the capture.
async function cmdScreenshot(url, out, widthArg) {
  if (!url || !out) throw new Error('Usage: screenshot <url> <out.png> [width]');
  const width = Number(widthArg || 1400);
  await ensureChrome();
  // Open a fresh tab (PUT is required by current Chrome for /json/new).
  const tab = await (await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connect(tab.webSocketDebuggerUrl);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    cdp.on('Page.javascriptDialogOpening', () =>
      cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(cdp, url);
    await sleep(1200); // let fonts/gradients settle
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const height = Math.ceil(metrics.cssContentSize?.height || metrics.contentSize?.height || 3000);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    return { ok: true, out, width, height };
  } finally {
    cdp.close();
    await fetch(`${BASE}/json/close/${tab.id}`).catch(() => {}); // discard the throwaway tab
  }
}

/** Synchronous write avoids stdout pipe truncation when process.exit() follows. */
function finish(fd, text, code) {
  fs.writeSync(fd, text + '\n');
  process.exit(code);
}

// Only dispatch when run as a CLI, not when imported (e.g. by the test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b, c] = process.argv.slice(2);
  const run = cmd === 'ensure' ? cmdEnsure()
    : cmd === 'setup' ? cmdSetup(a)
    : cmd === 'list' ? cmdList()
    : cmd === 'call' ? cmdCall(a, b)
    : cmd === 'batch' ? cmdBatch(a)
    : cmd === 'screenshot' ? cmdScreenshot(a, b, c)
    : Promise.reject(new Error('Usage: webmcp.mjs <ensure|setup|list|call|batch|screenshot> [args]'));

  // Exit non-zero when a command reports failure (e.g. a batch with a refused
  // step), so scripts can branch on it while still reading the JSON on stdout.
  run.then((out) => finish(1, JSON.stringify(out, null, 2), out && out.ok === false ? 1 : 0))
     .catch((e) => finish(2, 'ERROR: ' + e.message, 1));
}
