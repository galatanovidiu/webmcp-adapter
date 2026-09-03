/**
 * Frontend ability: step the editor undo/redo history.
 *
 * A client-side WRITE ability — the recovery half of the write set. The other
 * writes cannot losslessly restore prior unsaved state (deep-merge never deletes
 * keys; a removed block loses its clientId), but the editor's own history can:
 * `core/editor.undo()` / `.redo()` delegate to core-data's undo manager, the same
 * stack the human's Ctrl+Z pops.
 *
 * That stack is SHARED with the human — an undo pops the NEWEST edit, whoever made
 * it. The description tells the agent to undo only immediately after its own
 * write; the result reports hasUndo/hasRedo so an empty-stack call (a silent no-op
 * in core) is visible instead of faked.
 *
 * Risk `reversible`: it mutates only unsaved editor state and is itself reversible
 * via redo. It does not save.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

// Undo is for stepping back a botched action, not time travel; a cap keeps one
// call from unwinding the human's whole session.
const MAX_STEPS = 10;

registerAbility( {
	name: 'webmcp/undo',
	category: 'webmcp',
	label: 'Undo / redo',
	description:
		'Step the undo history of the open WordPress block editor: undo the most recent edit(s), or pass redo:true to re-apply. The history is SHARED with the human — an undo reverts the newest edit whoever made it, so only undo immediately after your own write, and re-read blocks afterwards (restored blocks may carry new clientIds). Steps that hit an empty stack stop early; the result reports steps actually performed plus hasUndo/hasRedo. Applies live and unsaved; does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			redo: {
				type: 'boolean',
				description:
					'Default false (undo). true re-applies undone edits.',
			},
			steps: {
				type: 'integer',
				minimum: 1,
				maximum: MAX_STEPS,
				description:
					'How many history steps (default 1, max ' +
					MAX_STEPS +
					').',
			},
		},
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: false,
			destructive: false,
			idempotent: false,
			clientRegistered: true,
		},
		webmcp: { risk: 'reversible' },
	},
	callback: async ( { redo, steps } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { done: false, reason: NOT_IN_EDITOR };
		}

		const wanted = Math.min( steps ?? 1, MAX_STEPS );
		const canStep = () =>
			redo ? ctx.editor.hasEditorRedo() : ctx.editor.hasEditorUndo();

		// core's undo()/redo() no-op SILENTLY on an empty stack, so gate each
		// step on the has* selector and report the real count.
		let performed = 0;
		for ( ; performed < wanted && canStep(); performed++ ) {
			await ctx.data
				.dispatch( 'core/editor' )
				[ redo ? 'redo' : 'undo' ]();
		}

		return {
			done: performed > 0,
			direction: redo ? 'redo' : 'undo',
			stepsPerformed: performed,
			...( performed < wanted
				? {
						reason:
							'History exhausted after ' +
							performed +
							' step(s).',
				  }
				: {} ),
			hasUndo: ctx.editor.hasEditorUndo(),
			hasRedo: ctx.editor.hasEditorRedo(),
			blockCount: ctx.blockEditor.getBlockCount(),
		};
	},
} );
