#!/usr/bin/env node
/**
 * Full E2E verification of the frontend editor ability set against wp-env.
 * Based on driver.mjs: real system Chrome + WebMCP enabled, fresh profile
 * (busts the sub-module cache), drives the block editor on a new page.
 *
 * Run from inside this skill dir (playwright resolves from its node_modules):
 *   node verify-frontend.mjs
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

const WP_URL = (process.env.WP_URL || 'http://localhost:8888').replace(/\/$/, '');
const WP_USER = process.env.WP_USER || 'admin';
const WP_PASS = process.env.WP_PASS || 'password';
const PROFILE_DIR = path.join(os.tmpdir(), `webmcp-verify-${Date.now()}`);
const FLAGS = ['--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport'];
const READ_TOOL_NAMES = [
	'webmcp-editor-context',
	'webmcp-get-theme-design-tokens',
	'webmcp-list-block-types',
	'webmcp-list-patterns',
	'webmcp-list-templates',
	'webmcp-navigate',
	'webmcp-read-blocks',
].sort();
const WRITE_TOOL_NAMES = [
	...READ_TOOL_NAMES,
	'webmcp-edit-post-attributes',
	'webmcp-insert-blocks',
	'webmcp-insert-pattern',
	'webmcp-move-blocks',
	'webmcp-remove-blocks',
	'webmcp-replace-blocks',
	'webmcp-undo',
	'webmcp-update-block-attributes',
].sort();
const COMPLETE_TOOL_NAMES = [...WRITE_TOOL_NAMES, 'webmcp-save-post'].sort();
let standardInputMode = null;

async function listTools() {
	return page.evaluate(async () => {
		const normalize = (tool) => {
			let inputSchema = tool.inputSchema;
			if (typeof inputSchema === 'string') {
				try { inputSchema = JSON.parse(inputSchema); } catch {}
			}
			return { name: tool.name, title: tool.title, description: tool.description,
				inputSchema, annotations: tool.annotations };
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

async function stableTools(expectedCount, attempts = 30) {
	let tools = [];
	let previous = '';
	for (let i = 0; i < attempts; i++) {
		try { tools = await listTools(); } catch { tools = []; }
		const current = tools.length === expectedCount
			? JSON.stringify(tools.map((tool) => tool.name).sort())
			: '';
		if (current && current === previous) return tools;
		previous = current;
		await page.waitForTimeout(500);
	}
	return tools;
}

async function detectStandardInputMode() {
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

async function executeTool(name, args = {}) {
	return page.evaluate(async ([toolName, input, inputMode]) => {
		if (typeof document.modelContext?.getTools === 'function' &&
			typeof document.modelContext?.executeTool === 'function') {
			const tool = (await document.modelContext.getTools())
				.find((item) => item.window === window && item.name === toolName);
			if (!tool) throw new Error(`Unknown WebMCP tool: ${toolName}`);
			if (!inputMode) throw new Error('The standard WebMCP input shape was not detected.');
			return document.modelContext.executeTool(
				tool,
				inputMode === 'object' ? JSON.parse(input) : input
			);
		}
		const legacy = navigator.modelContextTesting || document.modelContextTesting;
		if (!legacy) throw new Error('WebMCP is unavailable in this browser.');
		return legacy.executeTool(toolName, input);
	}, [name, JSON.stringify(args), standardInputMode]);
}

let pass = 0;
let fail = 0;
const failures = [];
function check(label, cond, detail = '') {
	if (cond) {
		pass++;
		console.log(`  PASS ${label}`);
	} else {
		fail++;
		failures.push(label + (detail ? ` — ${detail}` : ''));
		console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
	}
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: FLAGS,
});
const page = ctx.pages()[0] || (await ctx.newPage());
const abilityRequests = [];
const pageErrors = [];
const adapterWarnings = [];
let originalSettings = null;
let createdPostId = null;
page.on('request', (request) => {
	if (request.url().includes('/wp-abilities/v1/abilities')) {
		abilityRequests.push(request.url());
	}
});
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => {
	if (message.type() === 'warning' && message.text().includes('WebMCP could not register')) {
		adapterWarnings.push(message.text());
	}
});

try {
	// ---- Login + establish the default read-only inventory ----
	await page.goto(`${WP_URL}/wp-admin/`, { waitUntil: 'domcontentloaded' });
	if (page.url().includes('wp-login.php') || (await page.$('#user_login'))) {
		await page.fill('#user_login', WP_USER);
		await page.fill('#user_pass', WP_PASS);
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
			page.click('#wp-submit'),
		]);
	}
	await page.goto(`${WP_URL}/wp-admin/options-general.php?page=webmcp-adapter`, {
		waitUntil: 'domcontentloaded',
	});
	originalSettings = {
		writes: await page.isChecked('#webmcp_enable_write_tools'),
		destructive: await page.isChecked('#webmcp_enable_destructive_tools'),
	};
	await page.uncheck('#webmcp_enable_write_tools', { force: true });
	await page.uncheck('#webmcp_enable_destructive_tools', { force: true });
	await Promise.all([
		page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
		page.click('#submit', { force: true }),
	]);

	const defaultTools = await stableTools(READ_TOOL_NAMES.length);
	const defaultNames = defaultTools.map((tool) => tool.name).sort();
	check('default inventory is the exact 7-tool frontend read set',
		JSON.stringify(defaultNames) === JSON.stringify(READ_TOOL_NAMES),
		defaultTools.map((tool) => tool.name).join(', '));
	await detectStandardInputMode();

	const dashboardContextRaw = await executeTool('webmcp-editor-context');
	const dashboardContext = typeof dashboardContextRaw === 'string'
		? JSON.parse(dashboardContextRaw) : dashboardContextRaw;
	check('editor-context is structured and reports no editor',
		dashboardContext.inEditor === false, JSON.stringify(dashboardContext));

	// Enable unsaved writes first and verify the intermediate gate.
	await page.check('#webmcp_enable_write_tools', { force: true });
	await Promise.all([
		page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
		page.click('#submit', { force: true }),
	]);
	const writeTools = await stableTools(WRITE_TOOL_NAMES.length);
	const writeNames = writeTools.map((tool) => tool.name).sort();
	check('write inventory is the exact 15-tool frontend set',
		JSON.stringify(writeNames) === JSON.stringify(WRITE_TOOL_NAMES),
		writeTools.map((tool) => tool.name).join(', '));
	check('save-post remains hidden without destructive gate',
		!writeTools.some((tool) => tool.name === 'webmcp-save-post'));

	// Enable the complete frontend set for the editor exercise.
	await page.check('#webmcp_enable_destructive_tools', { force: true });
	await Promise.all([
		page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
		page.click('#submit', { force: true }),
	]);
	await page.goto(`${WP_URL}/wp-admin/post-new.php?post_type=page`, {
		waitUntil: 'domcontentloaded',
	});
	// Dismiss the "Choose a pattern" starter modal / welcome guide.
	await page.waitForTimeout(1500);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(500);
	await page.keyboard.press('Escape');

	// ---- Wait for tools ----
	const tools = await stableTools(COMPLETE_TOOL_NAMES.length);
	const names = tools.map((t) => t.name);
	check('complete inventory is the exact 16-tool frontend set',
		JSON.stringify([...names].sort()) === JSON.stringify(COMPLETE_TOOL_NAMES),
		names.join(', '));
	check('no server ability request was made', abilityRequests.length === 0,
		abilityRequests.join(', '));

	const callTool = async (name, args = {}) => {
		const raw = await executeTool(name, args);
		if (typeof raw === 'string') return JSON.parse(raw);
		if (raw?.content?.[0]?.text) return JSON.parse(raw.content[0].text);
		return raw;
	};
	const startDeferredTool = async (name, args = {}) => {
		await page.evaluate(async ([toolName, input, inputMode]) => {
			let promise;
			if (typeof document.modelContext?.getTools === 'function' &&
				typeof document.modelContext?.executeTool === 'function') {
				const tool = (await document.modelContext.getTools())
					.find((item) => item.window === window && item.name === toolName);
				if (!tool) throw new Error(`Unknown WebMCP tool: ${toolName}`);
				promise = document.modelContext.executeTool(
					tool,
					inputMode === 'object' ? JSON.parse(input) : input
				);
			} else {
				const legacy = navigator.modelContextTesting || document.modelContextTesting;
				promise = legacy.executeTool(toolName, input);
			}
			window.__webmcpDeferredResult = promise.then(
				(value) => ({ ok: true, value }),
				(error) => ({ ok: false, name: error.name, message: error.message })
			);
		}, [name, JSON.stringify(args), standardInputMode]);
	};
	const finishDeferredTool = async () => {
		const outcome = await page.evaluate(() => window.__webmcpDeferredResult);
		if (!outcome.ok) throw new Error(`${outcome.name}: ${outcome.message}`);
		const raw = outcome.value;
		return typeof raw === 'string' ? JSON.parse(raw) : raw;
	};
	// Destructive tools pop the confirmation modal; click accept (trusted click).
	const callDestructive = async (name, args = {}) => {
		await startDeferredTool(name, args);
		await page.waitForSelector('[data-webmcp-confirm-accept]', { timeout: 8000 });
		await page.click('[data-webmcp-confirm-accept]', { force: true });
		return finishDeferredTool();
	};
	const declineDestructive = async (name, args = {}) => {
		await startDeferredTool(name, args);
		await page.waitForSelector('[data-webmcp-confirm-cancel]', { timeout: 8000 });
		await page.click('[data-webmcp-confirm-cancel]', { force: true });
		return finishDeferredTool();
	};
	const truth = (fn, arg) => page.evaluate(fn, arg);
	let editorReady = false;
	for (let i = 0; i < 30; i++) {
		try {
			editorReady = (await callTool('webmcp-editor-context')).inEditor === true;
		} catch {
			editorReady = false;
		}
		if (editorReady) break;
		await page.waitForTimeout(500);
	}
	check('block editor became ready', editorReady, page.url());

	console.log('\n== T0: registration ==');
	for (const n of [
		'webmcp-editor-context', 'webmcp-read-blocks', 'webmcp-list-templates',
		'webmcp-move-blocks', 'webmcp-replace-blocks', 'webmcp-edit-post-attributes',
		'webmcp-undo', 'webmcp-save-post',
	]) {
		check(`tool registered: ${n}`, names.includes(n));
	}
	check('only frontend tools registered', names.every((name) => name.startsWith('webmcp-')),
		names.filter((name) => !name.startsWith('webmcp-')).join(', '));
	check('tools carry titles', tools.every((tool) => typeof tool.title === 'string' && tool.title.length > 0));
	check('tools mark page content untrusted',
		tools.every((tool) => tool.annotations?.untrustedContentHint === true));

	const serverProbe = await page.evaluate(async () => {
		try {
			const abilities = await import('@wordpress/abilities');
			abilities.registerAbilityCategory('webmcp-probe', {
				label: 'WebMCP probe',
				description: 'Temporary provenance test.',
				meta: { annotations: { serverRegistered: true } },
			});
				abilities.registerAbility({
					name: 'webmcp-probe/server-only',
				category: 'webmcp-probe',
				label: 'Server-only probe',
				description: 'Must not become a WebMCP tool.',
				input_schema: { type: 'object', properties: {}, additionalProperties: false },
				meta: { annotations: { readonly: true, serverRegistered: true } },
					callback: async () => ({ exposed: true }),
				});
				abilities.registerAbility({
					name: 'webmcp-probe/mixed-provenance',
					category: 'webmcp-probe',
					label: 'Mixed provenance probe',
					description: 'Must remain excluded when both provenance flags are true.',
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
					meta: { annotations: {
						readonly: true,
						clientRegistered: true,
						serverRegistered: true,
					} },
					callback: async () => ({ exposed: true }),
				});
			return { ok: true };
		} catch (error) {
			return { ok: false, error: String(error) };
		}
	});
	check('server provenance probe registered in the client store', serverProbe.ok,
		serverProbe.error || '');
	await page.waitForTimeout(500);
	const afterServerProbe = await listTools();
	check('server and mixed-provenance abilities remain excluded',
		afterServerProbe.length === 16 &&
		!afterServerProbe.some((tool) => [
			'webmcp-probe-server-only',
			'webmcp-probe-mixed-provenance',
		].includes(tool.name)));

	const lateProbe = await page.evaluate(async () => {
		try {
			const abilities = await import('@wordpress/abilities');
			abilities.registerAbility({
				name: 'webmcp-probe/late-client',
				category: 'webmcp-probe',
				label: 'Late client probe',
				description: 'Must register exactly once after the initial sync.',
				input_schema: { type: 'object', properties: {}, additionalProperties: false },
				meta: { annotations: { readonly: true, clientRegistered: true } },
				callback: async () => ({ late: true }),
			});
			return { ok: true };
		} catch (error) {
			return { ok: false, error: String(error) };
		}
	});
	check('late client ability registered in the store', lateProbe.ok, lateProbe.error || '');
	await page.waitForTimeout(500);
	const afterLateProbe = await listTools();
	check('late client ability registers exactly once',
		afterLateProbe.filter((tool) => tool.name === 'webmcp-probe-late-client').length === 1 &&
		afterLateProbe.length === 17,
		afterLateProbe.map((tool) => tool.name).join(', '));

	const pageErrorsBeforeCollision = pageErrors.length;
	const collisionProbe = await page.evaluate(async () => {
		try {
			const abilities = await import('@wordpress/abilities');
			for (const [name, category] of [
				['webmcp-probe/collision', 'webmcp-probe'],
				['webmcp/probe-collision', 'webmcp'],
			]) {
				abilities.registerAbility({
					name,
					category,
					label: `Collision probe ${name}`,
					description: 'Temporary registration rejection test.',
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
					meta: { annotations: { readonly: true, clientRegistered: true } },
					callback: async () => ({ ok: true }),
				});
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, error: String(error) };
		}
	});
	check('collision probe abilities registered in the store', collisionProbe.ok,
		collisionProbe.error || '');
	await page.waitForTimeout(500);
	const afterCollisionProbe = await listTools();
	check('exactly one normalized collision tool registers',
		afterCollisionProbe.filter((tool) => tool.name === 'webmcp-probe-collision').length === 1,
		afterCollisionProbe.map((tool) => tool.name).join(', '));
	check('normalized collision rejection is reported',
		adapterWarnings.some((warning) => warning.includes('probe-collision')),
		adapterWarnings.join(' | '));
	check('registration rejection is handled',
		pageErrors.length === pageErrorsBeforeCollision,
		pageErrors.slice(pageErrorsBeforeCollision).join(' | '));
	const savePostTool = tools.find((t) => t.name === 'webmcp-save-post');
	check('save-post description carries the destructive ⚠ prefix',
		Boolean(savePostTool && savePostTool.description.startsWith('⚠')),
		savePostTool ? savePostTool.description.slice(0, 40) : 'tool missing');

	console.log('\n== T1: editor-context (initial) ==');
	const ctx1 = await callTool('webmcp-editor-context');
	check('inEditor', ctx1.inEditor === true);
	check('postType page', ctx1.postType === 'page');
	check('selection null initially', ctx1.selection === null);
	check('hasUndo false initially', ctx1.hasUndo === false);
	check('document-state keys present',
		['isDirty', 'isSaveable', 'isPublished', 'permalink', 'renderingMode'].every((k) => k in ctx1),
		JSON.stringify(Object.keys(ctx1)));

	console.log('\n== T2: insert-blocks ==');
	const ins = await callTool('webmcp-insert-blocks', {
		blocks: [
			{ name: 'core/paragraph', attributes: { content: 'Alpha' } },
			{ name: 'core/paragraph', attributes: { content: 'Beta' } },
			{ name: 'core/group', innerBlocks: [
				{ name: 'core/heading', attributes: { content: 'Hello', level: 2 } },
			] },
		],
	});
	check('inserted', ins.inserted === true, JSON.stringify(ins));
	const [pAlpha, pBeta, grp] = ins.tree.map((n) => n.clientId);
	let head = ins.tree[2].innerBlocks[0].clientId;

	console.log('\n== T3: read-blocks names targeting ==');
	const rb = await callTool('webmcp-read-blocks', { names: ['core/paragraph'] });
	check('matches shape', Array.isArray(rb.matches) && rb.matches.length === 2,
		JSON.stringify(rb).slice(0, 200));
	check('match has rootClientId+index',
		rb.matches.every((m) => 'rootClientId' in m && typeof m.index === 'number'));
	const rbProj = await callTool('webmcp-read-blocks', {
		names: ['core/heading'], attributeKeys: ['level'],
	});
	check('attributeKeys projection', rbProj.matches?.[0] &&
		JSON.stringify(Object.keys(rbProj.matches[0].attributes)) === '["level"]',
		JSON.stringify(rbProj.matches?.[0]?.attributes));

	console.log('\n== T4: batched update + single-undo ==');
	const up = await callTool('webmcp-update-block-attributes', {
		updates: [
			{ clientId: pAlpha, attributes: { content: 'Alpha updated' } },
			{ clientId: pBeta, attributes: { content: 'Beta updated' } },
		],
	});
	check('batch updated', up.updated === true, JSON.stringify(up));
	const t4a = await truth(() => {
		const be = wp.data.select('core/block-editor');
		return be.getBlocks().slice(0, 2).map((b) => String(b.attributes.content));
	});
	check('both contents updated', t4a.join('|') === 'Alpha updated|Beta updated', t4a.join('|'));
	const un1 = await callTool('webmcp-undo', {});
	check('undo done', un1.done === true && un1.stepsPerformed === 1, JSON.stringify(un1));
	const t4b = await truth(() => {
		const be = wp.data.select('core/block-editor');
		return be.getBlocks().slice(0, 2).map((b) => String(b.attributes.content));
	});
	check('ONE undo reverted BOTH patches (single undo step)',
		t4b.join('|') === 'Alpha|Beta', t4b.join('|'));
	const re1 = await callTool('webmcp-undo', { redo: true });
	check('redo done', re1.done === true, JSON.stringify(re1));
	const re2 = await callTool('webmcp-undo', { redo: true });
	check('redo on empty stack reports done:false', re2.done === false, JSON.stringify(re2));

	console.log('\n== T5: unset (top-level + nested) ==');
	await callTool('webmcp-update-block-attributes', {
		clientId: head,
		attributes: { textAlign: 'center', style: { color: { background: '#ff0000', text: '#00ff00' } } },
	});
	const t5a = await truth(() => {
		const a = wp.data.select('core/block-editor').getBlocks().find((b) => b.name === 'core/group')?.innerBlocks[0]?.attributes;
		return { textAlign: a?.textAlign, bg: a?.style?.color?.background, text: a?.style?.color?.text };
	});
	check('set worked', t5a.textAlign === 'center' && t5a.bg === '#ff0000', JSON.stringify(t5a));
	const unset = await callTool('webmcp-update-block-attributes', {
		clientId: head, unset: ['textAlign', 'style.color.background'],
	});
	check('unset call ok', unset.updated === true, JSON.stringify(unset));
	const t5b = await truth(() => {
		const a = wp.data.select('core/block-editor').getBlocks().find((b) => b.name === 'core/group')?.innerBlocks[0]?.attributes;
		return { textAlign: a?.textAlign, bg: a?.style?.color?.background, text: a?.style?.color?.text };
	});
	check('top-level key gone, nested key gone, sibling nested key SURVIVES',
		t5b.textAlign === undefined && t5b.bg === undefined && t5b.text === '#00ff00',
		JSON.stringify(t5b));

	console.log('\n== T6: move-blocks ==');
	const mv1 = await callTool('webmcp-move-blocks', { clientId: pBeta, index: 0 });
	check('reorder moved', mv1.moved === true && mv1.index === 0, JSON.stringify(mv1));
	const t6a = await truth(() => wp.data.select('core/block-editor').getBlocks()[0].clientId);
	check('Beta now first', t6a === pBeta);
	const mv2 = await callTool('webmcp-move-blocks', { clientId: pAlpha, toRootClientId: grp, index: 0 });
	check('reparent moved', mv2.moved === true, JSON.stringify(mv2));
	const t6b = await truth(([id]) => wp.data.select('core/block-editor').getBlockRootClientId(id), [pAlpha]);
	check('Alpha now inside group', t6b === grp, String(t6b));
	const mv3 = await callTool('webmcp-move-blocks', { clientId: pAlpha, toRootClientId: '', index: 0 });
	check('move back to top', mv3.moved === true, JSON.stringify(mv3));
	const mvBad = await callTool('webmcp-move-blocks', { clientId: 'nope-123', index: 0 });
	check('unknown id refused', mvBad.moved === false && /Unknown/.test(mvBad.reason), JSON.stringify(mvBad));

	console.log('\n== T7: replace-blocks transformTo ==');
	const tr1 = await callTool('webmcp-replace-blocks', { clientId: pAlpha, transformTo: 'core/heading' });
	check('paragraph→heading', tr1.replaced === true && tr1.tree[0].name === 'core/heading', JSON.stringify(tr1));
	const hAlpha = tr1.tree?.[0]?.clientId;
	// Content is 'Alpha updated' here: T4's redo re-applied the batch patch.
	const t7a = await truth(([id]) => String(wp.data.select('core/block-editor').getBlock(id)?.attributes.content), [hAlpha]);
	check('content preserved through transform', t7a === 'Alpha updated', t7a);
	const tr2 = await callTool('webmcp-replace-blocks', { clientId: hAlpha, transformTo: 'core/spacer' });
	check('impossible transform returns possibleTransforms',
		tr2.replaced === false && Array.isArray(tr2.possibleTransforms) && tr2.possibleTransforms.length > 0,
		JSON.stringify(tr2).slice(0, 200));

	console.log('\n== T8: group / ungroup ==');
	const gr = await callTool('webmcp-replace-blocks', { clientId: hAlpha, transformTo: 'core/group' });
	check('wrap in group', gr.replaced === true && gr.tree[0].name === 'core/group', JSON.stringify(gr).slice(0, 200));
	const gid = gr.tree?.[0]?.clientId;
	const ug = await callTool('webmcp-replace-blocks', { clientId: gid, ungroup: true });
	check('ungroup dissolves wrapper', ug.replaced === true && ug.tree[0].name === 'core/heading', JSON.stringify(ug).slice(0, 200));
	const ugBad = await callTool('webmcp-replace-blocks', { clientId: pBeta, ungroup: true });
	check('ungroup non-wrapper refused', ugBad.replaced === false, JSON.stringify(ugBad));

	console.log('\n== T9: edit-post-attributes ==');
	const ep = await callTool('webmcp-edit-post-attributes', {
		title: 'Full Control Verify', slug: 'full-control-verify', excerpt: 'E2E check',
	});
	check('fields applied', ep.updated === true && ep.applied.title === 'Full Control Verify', JSON.stringify(ep));
	const ctx2 = await callTool('webmcp-editor-context');
	check('editor-context reflects edits', ctx2.title === 'Full Control Verify' && ctx2.slug === 'full-control-verify');
	// The client schema (additionalProperties:false) rejects `status` before the
	// callback belt is even reached — executeTool REJECTS. Either layer passing
	// is the security property we want.
	const epStatus = await callTool('webmcp-edit-post-attributes', { status: 'publish' })
		.catch((e) => ({ schemaRejected: true, error: String(e).slice(0, 120) }));
	check('status REJECTED (schema or callback)',
		epStatus.schemaRejected === true ||
			(epStatus.updated === false && /save-post/.test(epStatus.reason)),
		JSON.stringify(epStatus).slice(0, 150));
	const epSmuggle = await callTool('webmcp-edit-post-attributes', { taxonomies: { status: [1] } });
	check('taxonomy smuggle of post field REJECTED', epSmuggle.updated === false, JSON.stringify(epSmuggle));

	console.log('\n== T10: selection read ==');
	await page.evaluate(([id]) => wp.data.dispatch('core/block-editor').selectBlock(id), [pBeta]);
	const ctx3 = await callTool('webmcp-editor-context');
	check('selection reported', ctx3.selection?.blocks?.[0]?.clientId === pBeta &&
		ctx3.selection.blocks[0].name === 'core/paragraph', JSON.stringify(ctx3.selection));

	console.log('\n== T11: list-templates ==');
	const lt = await callTool('webmcp-list-templates');
	check('templates listed', Array.isArray(lt.templates) && lt.templates.length > 0,
		JSON.stringify(lt).slice(0, 200));
	check('template parts listed', Array.isArray(lt.templateParts) && lt.templateParts.length > 0);
	check('editUrl shape', (lt.templates[0]?.editUrl || '').includes('site-editor.php?p=/wp_template/'),
		lt.templates[0]?.editUrl);

	console.log('\n== T12: save-post cancellation and decline ==');
	const declined = await declineDestructive('webmcp-save-post', {});
	check('save decline is structured', declined.cancelled === true,
		JSON.stringify(declined));
	const afterDecline = await callTool('webmcp-editor-context');
	check('decline leaves edits unsaved', afterDecline.isDirty === true);

	const controlledCancellation = await page.evaluate(async () => {
		const adapterScript = [...document.scripts]
			.find((script) => script.src.includes('/webmcp-adapter/src/adapter.js'));
		if (!adapterScript) return { available: false, reason: 'adapter module script not found' };
		const moduleUrl = new URL('./confirmation.js', adapterScript.src);
		const { confirmDestructive } = await import(moduleUrl.href);
		const ability = { name: 'webmcp-probe/confirmation', label: 'Confirmation probe' };

		const controller = new AbortController();
		let continued = false;
		const invocation = confirmDestructive(ability, {}, controller.signal, false, 1000)
			.then(() => { continued = true; });
		controller.abort();
		let abortOutcome;
		try {
			await invocation;
			abortOutcome = { resolved: true };
		} catch (error) {
			abortOutcome = { resolved: false, name: error.name };
		}
		const afterAbort = document.querySelectorAll('[data-webmcp-confirm-overlay]').length;
		const timedOut = await confirmDestructive(ability, {}, undefined, false, 20);
		const afterTimeout = document.querySelectorAll('[data-webmcp-confirm-overlay]').length;
		return { available: true, abortOutcome, continued, afterAbort, timedOut, afterTimeout };
	});
	check('controlled callback abort rejects with AbortError and blocks continuation',
		controlledCancellation.available === true &&
		controlledCancellation.abortOutcome?.resolved === false &&
		controlledCancellation.abortOutcome?.name === 'AbortError' &&
		controlledCancellation.continued === false &&
		controlledCancellation.afterAbort === 0,
		JSON.stringify(controlledCancellation));
	check('confirmation expires distinctly and removes its modal',
		controlledCancellation.timedOut?.approved === false &&
		controlledCancellation.timedOut?.reason === 'expired' &&
		controlledCancellation.afterTimeout === 0,
		JSON.stringify(controlledCancellation));

	const abortSupported = await page.evaluate(async (inputMode) => {
		if (typeof document.modelContext?.getTools !== 'function' ||
			typeof document.modelContext?.executeTool !== 'function') {
			return false;
		}
		const tool = (await document.modelContext.getTools())
			.find((item) => item.window === window && item.name === 'webmcp-save-post');
		const controller = new AbortController();
		window.__webmcpAbortController = controller;
		const invocation = document.modelContext
			.executeTool(tool, inputMode === 'object' ? {} : '{}', { signal: controller.signal });
		window.__webmcpAbortResult = invocation
			.then((value) => ({ resolved: true, value }))
			.catch((error) => ({ resolved: false, name: error.name, message: error.message }));
		return true;
	}, standardInputMode);
	check('standard cancellation API available', abortSupported);
	if (abortSupported) {
		await page.waitForSelector('[data-webmcp-confirm-overlay]', { timeout: 8000 });
		const abortForwarded = await page.locator('[data-webmcp-confirm-overlay]')
			.getAttribute('data-webmcp-confirm-abort-aware') !== null;
		await page.evaluate(() => window.__webmcpAbortController.abort());
		const aborted = await page.evaluate(() => window.__webmcpAbortResult);
		check('aborted save rejects', aborted.resolved === false,
			JSON.stringify(aborted));
		const overlayCount = await page.locator('[data-webmcp-confirm-overlay]').count();
		console.log(`  INFO browser forwarded callback signal: ${abortForwarded}; overlays after outer cancellation: ${overlayCount}`);
		if (!abortForwarded && overlayCount === 1) {
			// Current Chrome may cancel the outer invocation without forwarding its
			// signal. The production timeout will decline the modal; the test cleans it
			// immediately so the remainder can continue.
			await page.click('[data-webmcp-confirm-cancel]', { force: true });
		}
		const afterAbort = await callTool('webmcp-editor-context');
		check('abort leaves edits unsaved', afterAbort.isDirty === true);
	}

	console.log('\n== T13: save-post (destructive, modal-confirmed) ==');
	const sv1 = await callDestructive('webmcp-save-post', {});
	check('draft saved', sv1.saved === true && sv1.status === 'draft' && sv1.postId > 0, JSON.stringify(sv1));
	createdPostId = sv1.postId || null;
	const ctx4 = await callTool('webmcp-editor-context');
	check('not dirty after save', ctx4.isDirty === false);

	console.log('\n== T14: save-post publish flow ==');
	const sv2 = await callDestructive('webmcp-save-post', { status: 'publish' });
	check('published', sv2.saved === true && sv2.status === 'publish', JSON.stringify(sv2));
	createdPostId = sv2.postId || createdPostId;
	check('live link', typeof sv2.link === 'string' && sv2.link.includes('full-control-verify'), sv2.link);
	const sv3 = await callDestructive('webmcp-save-post', {});
	check('save with no changes reports honestly', sv3.saved === false && /Nothing to save/.test(sv3.reason), JSON.stringify(sv3));

	const trashed = await page.evaluate(async (postId) => {
		const result = await wp.data.dispatch('core').deleteEntityRecord(
			'postType',
			'page',
			postId,
			{ force: true }
		);
		return result?.deleted === true;
	}, createdPostId);
	check('test page permanently removed', trashed === true);
	createdPostId = null;

	console.log('\n== T15: navigation and rediscovery ==');
	const [, navigationOutcome] = await Promise.all([
		page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
		executeTool('webmcp-navigate', { url: '/wp-admin/' }).then(
			(value) => ({ completed: true, value }),
			(error) => ({ completed: false, error: String(error) })
		),
	]);
	check('navigate tool completed or was interrupted only by its own reload',
		navigationOutcome.completed === true ||
			/Execution context was destroyed|Cannot find context|Target page.*navigat/i.test(
				navigationOutcome.error
			),
		JSON.stringify(navigationOutcome));
	check('navigate reached the exact wp-admin destination',
		new URL(page.url()).pathname === '/wp-admin/', page.url());
	const rediscovered = await stableTools(COMPLETE_TOOL_NAMES.length);
	check('tools rediscover after same-origin navigation',
		JSON.stringify(rediscovered.map((tool) => tool.name).sort()) ===
			JSON.stringify(COMPLETE_TOOL_NAMES));
	const dashboardAfterNavigation = await executeTool('webmcp-editor-context');
	const dashboardAfter = typeof dashboardAfterNavigation === 'string'
		? JSON.parse(dashboardAfterNavigation)
		: dashboardAfterNavigation;
	check('rediscovered editor-context executes on destination page',
		dashboardAfter.inEditor === false, JSON.stringify(dashboardAfter));

} finally {
	if (!page.isClosed()) {
		if (createdPostId) {
			try {
				await page.goto(`${WP_URL}/wp-admin/post.php?post=${createdPostId}&action=edit`, {
					waitUntil: 'domcontentloaded',
				});
				await page.waitForFunction(() => Boolean(window.wp?.data?.dispatch('core')));
				await page.evaluate((postId) => wp.data.dispatch('core').deleteEntityRecord(
					'postType', 'page', postId, { force: true }
				), createdPostId);
			} catch (error) {
				check('fallback test-page cleanup', false, error.message);
			}
		}
		if (originalSettings) {
			try {
				await page.goto(`${WP_URL}/wp-admin/options-general.php?page=webmcp-adapter`, {
					waitUntil: 'domcontentloaded',
				});
				await page.setChecked('#webmcp_enable_write_tools', originalSettings.writes, { force: true });
				await page.setChecked('#webmcp_enable_destructive_tools', originalSettings.destructive, { force: true });
				await Promise.all([
					page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
					page.click('#submit', { force: true }),
				]);
				const restored =
					(await page.isChecked('#webmcp_enable_write_tools')) === originalSettings.writes &&
					(await page.isChecked('#webmcp_enable_destructive_tools')) === originalSettings.destructive;
				check('WebMCP settings restored after test', restored);
			} catch (error) {
				check('WebMCP settings restored after test', false, error.message);
			}
		}
	}
	await ctx.close();
	fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (failures.length) {
	console.log('Failures:');
	for (const f of failures) console.log('  - ' + f);
}
process.exit(fail ? 1 : 0);
