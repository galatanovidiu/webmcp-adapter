/**
 * Pure contracts shared by the page-scoped adapter and its tests.
 */

const MUTATION_RISKS = new Set( [
	'reversible',
	'persistent',
	'consequential',
	'privileged',
] );

const CONFIRMATION_RISKS = new Set( [ 'consequential', 'privileged' ] );

/**
 * Converts a WordPress Ability name into an injective WebMCP tool name.
 *
 * WordPress Ability segments cannot contain dots, so replacing each segment
 * delimiter with a dot is reversible and does not collapse names that contain
 * dashes inside a segment.
 *
 * @param {string} abilityName The WordPress Ability name.
 * @return {string} The WebMCP tool name.
 */
export function toWebMcpToolName( abilityName ) {
	return abilityName.replace( /\//g, '.' );
}

/**
 * Converts a projected WebMCP tool name back into a WordPress Ability name.
 *
 * @param {string} toolName The projected WebMCP tool name.
 * @return {string} The WordPress Ability name.
 */
export function toAbilityName( toolName ) {
	return toolName.replace( /\./g, '/' );
}

/**
 * Classifies an Ability under the page-scoped exposure contract.
 *
 * Read-only Abilities need no adapter-specific risk metadata. Mutations must
 * declare a supported `meta.webmcp.risk`; missing and invalid declarations fail
 * closed and carry a bounded diagnostic code.
 *
 * @param {Object} ability A WordPress Ability record.
 * @return {Object} A successful risk or a fail-closed diagnostic.
 */
export function classifyAbilityRisk( ability ) {
	if ( ability?.meta?.annotations?.readonly === true ) {
		return { ok: true, risk: 'read' };
	}

	const risk = ability?.meta?.webmcp?.risk;
	if ( MUTATION_RISKS.has( risk ) ) {
		return { ok: true, risk };
	}

	return {
		ok: false,
		risk: null,
		diagnostic:
			typeof risk === 'undefined' ? 'missing-risk' : 'invalid-risk',
	};
}

/**
 * Returns whether the validated risk class requires in-page confirmation.
 *
 * Confirmation follows consequence, not WordPress's broader destructive hint.
 * Persistent-but-routine writes can use their owning application flow, while
 * consequential and privileged actions always require explicit supervision.
 *
 * @param {*} risk Candidate risk value.
 * @return {boolean} Whether the risk requires confirmation.
 */
export function requiresConfirmationForRisk( risk ) {
	return CONFIRMATION_RISKS.has( risk );
}
