#!/usr/bin/env node
/**
 * WebMCP Playwright driver — drive the page's WebMCP tools with Playwright + the
 * real system Chrome. Playwright's BUNDLED Chromium has no WebMCP API; this script
 * launches the installed Chrome (`channel: 'chrome'`) with the WebMCP testing flag,
 * which exposes `navigator.modelContextTesting` (listTools / executeTool).
 *
 * Usage (run from the WordPress project root):
 *   node .claude/skills/webmcp-playwright/driver.mjs list
 *   node .claude/skills/webmcp-playwright/driver.mjs names
 *   node .claude/skills/webmcp-playwright/driver.mjs call <tool-name> '<json-args>'
 *
 * Requires Playwright as a library (no browser download needed — we use system Chrome):
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -g playwright
 *   # or install in a scratch dir and run with NODE_PATH pointing at it.
 *
 * Config via env (all optional):
 *   WP_URL=http://localhost:8080   WP site (use http://127.0.0.1:9400 for Playground)
 *   WP_USER=admin  WP_PASS=admin
 *   CHROME_CHANNEL=chrome          Playwright channel for system Chrome
 *   PROFILE_DIR=<tmp>/webmcp-pw-profile   persistent profile (keeps the login cookie)
 *   HEADLESS=1                     run headless (default: headed)
 */

import os from 'node:os';
import path from 'node:path';

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	console.error('Playwright is not installed. Run: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -g playwright');
	process.exit(2);
}

const WP_URL = (process.env.WP_URL || 'http://localhost:8080').replace(/\/$/, '');
const WP_USER = process.env.WP_USER || 'admin';
const WP_PASS = process.env.WP_PASS || 'admin';
const CHANNEL = process.env.CHROME_CHANNEL || 'chrome';
const PROFILE_DIR = process.env.PROFILE_DIR || path.join(os.tmpdir(), 'webmcp-pw-profile');
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const FLAGS = ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport'];

const [cmd, toolName, toolArgs] = process.argv.slice(2);

/** Launch system Chrome with the WebMCP flag, log in if needed, open wp-admin, wait for tools. */
async function openAdmin() {
	const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
		channel: CHANNEL,
		headless: HEADLESS,
		args: FLAGS,
	});
	const page = ctx.pages()[0] || (await ctx.newPage());

	await page.goto(`${WP_URL}/wp-admin/`, { waitUntil: 'domcontentloaded' });
	if (page.url().includes('wp-login.php') || (await page.$('#user_login'))) {
		await page.fill('#user_login', WP_USER);
		await page.fill('#user_pass', WP_PASS);
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
			page.click('#wp-submit'),
		]);
		await page.goto(`${WP_URL}/wp-admin/`, { waitUntil: 'domcontentloaded' });
	}

	if ((await page.evaluate(() => typeof navigator.modelContextTesting)) !== 'object') {
		await ctx.close();
		throw new Error(
			'navigator.modelContextTesting is undefined. The flag did not apply — confirm CHROME_CHANNEL points at real Chrome 149+, not bundled Chromium.'
		);
	}

	// The ability store loads asynchronously. Poll until tools register.
	let tools = [];
	for (let i = 0; i < 24; i++) {
		tools = await page.evaluate(async () => {
			try { return await navigator.modelContextTesting.listTools(); } catch { return []; }
		});
		if (Array.isArray(tools) && tools.length) break;
		await page.waitForTimeout(500);
	}
	return { ctx, page, tools };
}

async function main() {
	if (!cmd || !['list', 'names', 'call'].includes(cmd)) {
		console.error("Usage: driver.mjs <list|names|call> [tool-name] ['<json-args>']");
		process.exit(1);
	}

	const { ctx, page, tools } = await openAdmin();
	try {
		if (cmd === 'names') {
			console.log(JSON.stringify(tools.map((t) => t.name).sort(), null, 2));
		} else if (cmd === 'list') {
			console.log(JSON.stringify(tools, null, 2));
		} else if (cmd === 'call') {
			if (!toolName) throw new Error("call needs a tool name: driver.mjs call <name> '<json>'");
			const argStr = toolArgs || '{}';
			JSON.parse(argStr); // validate; executeTool wants a JSON STRING
			const result = await page.evaluate(
				async ([n, a]) => navigator.modelContextTesting.executeTool(n, a),
				[toolName, argStr]
			);
			console.log(JSON.stringify(result, null, 2));
		}
	} finally {
		await ctx.close();
	}
}

main().catch((e) => {
	console.error(String(e && e.message ? e.message : e));
	process.exit(1);
});
