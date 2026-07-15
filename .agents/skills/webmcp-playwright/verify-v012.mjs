#!/usr/bin/env node
/**
 * One-off E2E verification of the v0.12.0 editor ability set against wp-env.
 * Based on driver.mjs: real system Chrome + WebMCP testing flag, fresh profile
 * (busts the sub-module cache), drives the block editor on a new page.
 *
 * Run from inside this skill dir (playwright resolves from its node_modules):
 *   node verify-v012.mjs
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

const WP_URL = (process.env.WP_URL || 'http://localhost:8888').replace(/\/$/, '');
const WP_USER = process.env.WP_USER || 'admin';
const WP_PASS = process.env.WP_PASS || 'password';
const PROFILE_DIR = path.join(os.tmpdir(), `webmcp-verify-${Date.now()}`);
const FLAGS = ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport'];

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

try {
	// ---- Login + open a fresh page in the editor ----
	await page.goto(`${WP_URL}/wp-admin/`, { waitUntil: 'domcontentloaded' });
	if (page.url().includes('wp-login.php') || (await page.$('#user_login'))) {
		await page.fill('#user_login', WP_USER);
		await page.fill('#user_pass', WP_PASS);
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
			page.click('#wp-submit'),
		]);
	}
	await page.goto(`${WP_URL}/wp-admin/post-new.php?post_type=page`, {
		waitUntil: 'domcontentloaded',
	});
	await page.waitForFunction(
		() => window.wp?.data?.select?.('core/editor')?.getCurrentPostId?.(),
		null,
		{ timeout: 30000 }
	);
	// Dismiss the "Choose a pattern" starter modal / welcome guide.
	await page.waitForTimeout(1500);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(500);
	await page.keyboard.press('Escape');

	// ---- Wait for tools ----
	let tools = [];
	for (let i = 0; i < 30; i++) {
		tools = await page.evaluate(async () => {
			try { return await navigator.modelContextTesting.listTools(); } catch { return []; }
		});
		if (Array.isArray(tools) && tools.length > 5) break;
		await page.waitForTimeout(500);
	}
	const names = tools.map((t) => t.name);

	const callTool = async (name, args = {}) => {
		const raw = await page.evaluate(
			async ([n, a]) => navigator.modelContextTesting.executeTool(n, a),
			[name, JSON.stringify(args)]
		);
		if (typeof raw === 'string') return JSON.parse(raw);
		if (raw?.content?.[0]?.text) return JSON.parse(raw.content[0].text);
		return raw;
	};
	// Destructive tools pop the confirmation modal; click accept (trusted click).
	const callDestructive = async (name, args = {}) => {
		const resultPromise = page.evaluate(
			async ([n, a]) => navigator.modelContextTesting.executeTool(n, a),
			[name, JSON.stringify(args)]
		);
		await page.waitForSelector('[data-webmcp-confirm-accept]', { timeout: 8000 });
		await page.click('[data-webmcp-confirm-accept]');
		const raw = await resultPromise;
		if (typeof raw === 'string') return JSON.parse(raw);
		if (raw?.content?.[0]?.text) return JSON.parse(raw.content[0].text);
		return raw;
	};
	const truth = (fn, arg) => page.evaluate(fn, arg);

	console.log('\n== T0: registration ==');
	for (const n of [
		'webmcp-editor-context', 'webmcp-read-blocks', 'webmcp-list-templates',
		'webmcp-move-blocks', 'webmcp-replace-blocks', 'webmcp-edit-post-attributes',
		'webmcp-undo', 'webmcp-save-post',
	]) {
		check(`tool registered: ${n}`, names.includes(n));
	}
	const ogMedia = names.filter((n) => n.startsWith('og-media'));
	console.log(`  INFO og-media tools present: ${ogMedia.length ? ogMedia.join(', ') : 'NONE (catalog release zip may predate og-media)'}`);
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

	console.log('\n== T12: save-post (destructive, modal-confirmed) ==');
	const sv1 = await callDestructive('webmcp-save-post', {});
	check('draft saved', sv1.saved === true && sv1.status === 'draft' && sv1.postId > 0, JSON.stringify(sv1));
	const ctx4 = await callTool('webmcp-editor-context');
	check('not dirty after save', ctx4.isDirty === false);

	console.log('\n== T13: save-post publish flow ==');
	const sv2 = await callDestructive('webmcp-save-post', { status: 'publish' });
	check('published', sv2.saved === true && sv2.status === 'publish', JSON.stringify(sv2));
	check('live link', typeof sv2.link === 'string' && sv2.link.includes('full-control-verify'), sv2.link);
	const sv3 = await callDestructive('webmcp-save-post', {});
	check('save with no changes reports honestly', sv3.saved === false && /Nothing to save/.test(sv3.reason), JSON.stringify(sv3));

	console.log(`\n==== ${pass} passed, ${fail} failed ====`);
	if (failures.length) {
		console.log('Failures:');
		for (const f of failures) console.log('  - ' + f);
	}
} finally {
	await ctx.close();
	fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
