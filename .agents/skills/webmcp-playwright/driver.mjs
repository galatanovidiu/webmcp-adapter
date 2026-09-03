#!/usr/bin/env node
/**
 * WebMCP Playwright driver — drive the page's WebMCP tools with Playwright + the
 * real system Chrome. Playwright's BUNDLED Chromium has no WebMCP API; this script
 * launches the installed Chrome (`channel: 'chrome'`) with WebMCP enabled and
 * drives the standard `document.modelContext` API. Chrome 149's testing hook is
 * retained as a fallback.
 *
 * Usage (run from the WordPress project root):
 *   node .agents/skills/webmcp-playwright/driver.mjs list
 *   node .agents/skills/webmcp-playwright/driver.mjs names
 *   node .agents/skills/webmcp-playwright/driver.mjs call <tool-name> '<json-args>'
 *
 * Requires Playwright as a library (no browser download needed — we use system Chrome):
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix .agents/skills/webmcp-playwright
 *
 * Config via env (all optional):
 *   WP_URL=http://localhost:8080   WP site (use http://127.0.0.1:9400 for Playground)
 *   WP_USER=admin  WP_PASS=password
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
const WP_PASS = process.env.WP_PASS || 'password';
const CHANNEL = process.env.CHROME_CHANNEL || 'chrome';
const PROFILE_DIR = process.env.PROFILE_DIR || path.join(os.tmpdir(), 'webmcp-pw-profile');
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const FLAGS = ['--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport'];

const [cmd, toolName, toolArgs] = process.argv.slice(2);
let standardInputMode = null;

/** Read serializable tool descriptors through the current or legacy WebMCP API. */
async function listTools(page) {
	return page.evaluate(async () => {
		const normalize = (tool) => {
			let inputSchema = tool.inputSchema;
			if (typeof inputSchema === 'string') {
				try { inputSchema = JSON.parse(inputSchema); } catch {}
			}

			return {
				name: tool.name,
				...(tool.title ? { title: tool.title } : {}),
				description: tool.description,
				inputSchema,
				annotations: tool.annotations,
			};
		};
		if (typeof document.modelContext?.getTools === 'function') {
			return (await document.modelContext.getTools())
				.filter((tool) => tool.window === window)
				.map(normalize);
		}

		const legacy = navigator.modelContextTesting || document.modelContextTesting;
		return legacy ? (await legacy.listTools()).map(normalize) : [];
	});
}

/** Detect the current standard API's input shape using a harmless read tool. */
async function detectStandardInputMode(page) {
	if (standardInputMode || !(await page.evaluate(() =>
		typeof document.modelContext?.executeTool === 'function'
	))) return;

	standardInputMode = await page.evaluate(async () => {
		const probe = (await document.modelContext.getTools())
			.find((tool) => tool.window === window && tool.name === 'webmcp-editor-context');
		if (!probe) throw new Error('The frontend read probe webmcp-editor-context is unavailable.');
		try {
			await document.modelContext.executeTool(probe, {});
			return 'object';
		} catch (error) {
			if (!/^UnknownError: Failed to parse input arguments\.?$/i.test(String(error))) {
				throw error;
			}
			await document.modelContext.executeTool(probe, '{}');
			return 'string';
		}
	});
}

/** Execute one tool through the current or legacy WebMCP API. */
async function executeTool(page, name, argsJson) {
	return page.evaluate(async ([toolName, input, inputMode]) => {
		if (typeof document.modelContext?.getTools === 'function' &&
			typeof document.modelContext?.executeTool === 'function') {
				const registered = (await document.modelContext.getTools())
					.find((tool) => tool.window === window && tool.name === toolName);
				if (!registered) throw new Error(`Unknown WebMCP tool: ${toolName}`);
				if (!inputMode) throw new Error('The standard WebMCP input shape was not detected.');
				return document.modelContext.executeTool(
					registered,
					inputMode === 'object' ? JSON.parse(input) : input
				);
		}

		const legacy = navigator.modelContextTesting || document.modelContextTesting;
		if (!legacy) throw new Error('WebMCP is unavailable in this browser.');
		return legacy.executeTool(toolName, input);
	}, [name, argsJson, standardInputMode]);
}

/** Parse the JSON string returned by Chrome's standard execution helper. */
function normalizeResult(result) {
	if (typeof result !== 'string') return result;
	try { return JSON.parse(result); } catch { return result; }
}

/** Launch system Chrome with WebMCP, log in if needed, open wp-admin, wait for tools. */
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

	const apiAvailable = await page.evaluate(() =>
		typeof document.modelContext?.getTools === 'function' ||
		typeof navigator.modelContextTesting?.listTools === 'function' ||
		typeof document.modelContextTesting?.listTools === 'function'
	);
	if (!apiAvailable) {
		await ctx.close();
		throw new Error(
			'WebMCP is unavailable. Confirm CHROME_CHANNEL points at a current system Chrome, not bundled Chromium.'
		);
	}

	// The ability store loads asynchronously. Poll until tools register.
	let tools = [];
	let previousNames = '';
	for (let i = 0; i < 24; i++) {
		try { tools = await listTools(page); } catch { tools = []; }
		const names = Array.isArray(tools)
			? JSON.stringify(tools.map((tool) => tool.name).sort())
			: '';
		if (names && names === previousNames) break;
		previousNames = names;
		await page.waitForTimeout(500);
	}
	if (!tools.length) {
		await ctx.close();
		throw new Error('No WebMCP tools registered on the WordPress admin page.');
	}
	await detectStandardInputMode(page);
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
			JSON.parse(argStr); // validate CLI input before selecting the API shape
			const result = normalizeResult(await executeTool(page, toolName, argStr));
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
