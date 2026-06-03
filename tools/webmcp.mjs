#!/usr/bin/env node
/**
 * WebMCP agent CLI — drive the page's WebMCP tools in Chrome over the DevTools
 * Protocol. Lets any terminal-side agent (e.g. Claude Code) act as the WebMCP
 * consumer: discover tools, then execute them in the live page.
 *
 * Usage:
 *   node webmcp.mjs ensure                 Launch the debug Chrome if it is not up
 *   node webmcp.mjs setup                  ensure + log in + open wp-admin, wait for tools
 *   node webmcp.mjs list                   List registered WebMCP tools (JSON)
 *   node webmcp.mjs call <name> '<json>'   Execute a tool with JSON args
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

const PORT = process.env.CDP_PORT || '9222';
const WP_URL = process.env.WP_URL || 'http://localhost:8080';
const WP_USER = process.env.WP_USER || 'admin';
const WP_PASS = process.env.WP_PASS || 'admin';
const CHROME_BIN = process.env.CHROME_BIN || defaultChrome();
const CHROME_PROFILE = process.env.CHROME_PROFILE || path.join(os.tmpdir(), 'wpwebmcp-chrome-profile');
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      }
    };
    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onopen = () => resolve({
      send: (method, params = {}) =>
        new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
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

async function cmdSetup() {
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
    await navigate(cdp, `${WP_URL}/wp-admin/`);
    let tools = [];
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      tools = await evaluate(cdp, `(async () => { const t = ${TESTING}; return t ? (await t.listTools()).map(x=>x.name) : []; })()`, true);
      if (tools.length) break;
    }
    return { ok: true, url: await evaluate(cdp, 'location.href'), tools };
  });
}

async function cmdList() {
  return withPage(async (cdp) =>
    evaluate(cdp, `(async () => {
      const t = ${TESTING};
      if (!t) return { error: 'modelContextTesting unavailable — is the WebMCP flag enabled?' };
      return (await t.listTools()).map(x => ({ name: x.name, description: x.description, inputSchema: x.inputSchema, annotations: x.annotations }));
    })()`, true));
}

async function cmdCall(name, argsJson) {
  const args = argsJson || '{}';
  JSON.parse(args); // validate locally
  return withPage(async (cdp) =>
    evaluate(cdp, `(async () => {
      const t = ${TESTING};
      if (!t) return { error: 'modelContextTesting unavailable' };
      try { return { result: await t.executeTool(${JSON.stringify(name)}, ${JSON.stringify(args)}) }; }
      catch (e) { return { error: String(e && e.message || e) }; }
    })()`, true));
}

const [cmd, a, b] = process.argv.slice(2);
const run = cmd === 'ensure' ? cmdEnsure()
  : cmd === 'setup' ? cmdSetup()
  : cmd === 'list' ? cmdList()
  : cmd === 'call' ? cmdCall(a, b)
  : Promise.reject(new Error('Usage: webmcp.mjs <ensure|setup|list|call> [name] [jsonArgs]'));

/** Synchronous write avoids stdout pipe truncation when process.exit() follows. */
function finish(fd, text, code) {
  fs.writeSync(fd, text + '\n');
  process.exit(code);
}

run.then((out) => finish(1, JSON.stringify(out, null, 2), 0))
   .catch((e) => finish(2, 'ERROR: ' + e.message, 1));
