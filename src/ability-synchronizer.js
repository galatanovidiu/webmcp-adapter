const functionIds = new WeakMap();
let nextFunctionId = 1;

/**
 * Creates a lifecycle-aware WordPress Ability to WebMCP registration synchronizer.
 *
 * @param {Object}   options                  Synchronizer dependencies.
 * @param {Function} options.getAbilities     Reads the current Ability records.
 * @param {Function} options.subscribe        Subscribes to Ability-store changes.
 * @param {Function} options.registerAbility  Registers one projected WebMCP tool.
 * @param {Function} options.reportDiagnostic Reports a bounded diagnostic object.
 * @param {Function} options.classifyAbilityRisk Validates Ability risk metadata.
 * @param {Function} options.toWebMcpToolName    Projects an Ability name.
 * @param {Function} options.shouldRegisterAbility Applies document exposure policy.
 * @return {Object} Synchronizer controls.
 */
export function createAbilitySynchronizer( {
	getAbilities,
	subscribe,
	registerAbility,
	reportDiagnostic = () => {},
	classifyAbilityRisk,
	toWebMcpToolName,
	shouldRegisterAbility = () => true,
} ) {
	const registrations = new Map();
	let activeDiagnosticKeys = new Set();
	let unsubscribe = null;
	let started = false;

	const emitDiagnostic = ( code, key, message, details = {} ) => {
		reportDiagnostic( { code, message, ...details } );
		return `${ code }:${ key }`;
	};

	const buildDesiredRegistrations = () => {
		const diagnosticKeys = new Set();
		const recordsByName = new Map();
		const abilities = getAbilities();

		for ( const ability of Array.isArray( abilities ) ? abilities : [] ) {
			const annotations = ability?.meta?.annotations ?? {};
			if (
				annotations.clientRegistered !== true ||
				annotations.serverRegistered === true
			) {
				continue;
			}

			if ( typeof ability.name !== 'string' || ability.name === '' ) {
				const key = 'invalid-ability-name';
				diagnosticKeys.add( key );
				if ( ! activeDiagnosticKeys.has( key ) ) {
					emitDiagnostic(
						'invalid-ability-name',
						'global',
						'A frontend Ability has no usable string name.'
					);
				}
				continue;
			}

			const matching = recordsByName.get( ability.name ) ?? [];
			matching.push( ability );
			recordsByName.set( ability.name, matching );
		}

		const candidates = [];
		for ( const [ abilityName, matching ] of recordsByName ) {
			if ( matching.length > 1 ) {
				const key = `ability-name-collision:${ abilityName }`;
				diagnosticKeys.add( key );
				if ( ! activeDiagnosticKeys.has( key ) ) {
					emitDiagnostic(
						'ability-name-collision',
						abilityName,
						`Multiple frontend Abilities use the name "${ abilityName }". None were projected.`,
						{ abilityNames: [ abilityName ] }
					);
				}
				continue;
			}

			const [ ability ] = matching;
			const classification = classifyAbilityRisk( ability );
			if ( ! classification.ok ) {
				const key = `${ classification.diagnostic }:${ abilityName }`;
				diagnosticKeys.add( key );
				if ( ! activeDiagnosticKeys.has( key ) ) {
					emitDiagnostic(
						classification.diagnostic,
						abilityName,
						`Frontend Ability "${ abilityName }" has no valid WebMCP mutation risk and was not projected.`,
						{ abilityNames: [ abilityName ] }
					);
				}
				continue;
			}
			if ( ! shouldRegisterAbility( ability, classification.risk ) ) {
				continue;
			}

			candidates.push( {
				ability,
				abilityName,
				toolName: toWebMcpToolName( abilityName ),
				risk: classification.risk,
				fingerprint: fingerprintAbility( ability ),
			} );
		}

		const candidatesByToolName = new Map();
		for ( const candidate of candidates ) {
			const matching =
				candidatesByToolName.get( candidate.toolName ) ?? [];
			matching.push( candidate );
			candidatesByToolName.set( candidate.toolName, matching );
		}

		const desired = new Map();
		for ( const [ toolName, matching ] of candidatesByToolName ) {
			if ( matching.length > 1 ) {
				const abilityNames = matching
					.map( ( candidate ) => candidate.abilityName )
					.sort();
				const key = `tool-name-collision:${ toolName }`;
				diagnosticKeys.add( key );
				if ( ! activeDiagnosticKeys.has( key ) ) {
					emitDiagnostic(
						'tool-name-collision',
						toolName,
						`Frontend Abilities project to the same WebMCP tool name "${ toolName }". None were registered.`,
						{ abilityNames, toolName }
					);
				}
				continue;
			}

			const [ candidate ] = matching;
			desired.set( candidate.abilityName, candidate );
		}

		activeDiagnosticKeys = diagnosticKeys;
		return desired;
	};

	const removeRegistration = ( abilityName ) => {
		const registration = registrations.get( abilityName );
		if ( ! registration ) {
			return;
		}

		registrations.delete( abilityName );
		registration.controller.abort();
	};

	const sync = async () => {
		let desired;
		try {
			desired = buildDesiredRegistrations();
		} catch ( error ) {
			reportDiagnostic( {
				code: 'synchronization-failed',
				message:
					'The frontend Ability store could not be synchronized with WebMCP.',
				error,
			} );
			return;
		}

		for ( const [ abilityName, registration ] of registrations ) {
			const candidate = desired.get( abilityName );
			if ( ! candidate ) {
				removeRegistration( abilityName );
				continue;
			}

			if (
				candidate.toolName !== registration.toolName ||
				candidate.fingerprint !== registration.fingerprint
			) {
				removeRegistration( abilityName );
				reportDiagnostic( {
					code: 'definition-replaced',
					message: `Frontend Ability "${ abilityName }" changed in the current document. Its prior WebMCP registration was removed before replacement.`,
					abilityNames: [ abilityName ],
					toolName: candidate.toolName,
				} );
			}
		}

		const pending = [];
		for ( const [ abilityName, candidate ] of desired ) {
			if ( registrations.has( abilityName ) ) {
				continue;
			}

			const controller = new AbortController();
			const registration = {
				controller,
				fingerprint: candidate.fingerprint,
				state: 'pending',
				toolName: candidate.toolName,
			};
			registrations.set( abilityName, registration );

			const promise = Promise.resolve()
				.then( () => {
					if ( controller.signal.aborted ) {
						return;
					}
					return registerAbility( candidate.ability, {
						risk: candidate.risk,
						signal: controller.signal,
						toolName: candidate.toolName,
					} );
				} )
				.then( () => {
					if (
						registrations.get( abilityName ) === registration &&
						! controller.signal.aborted
					) {
						registration.state = 'registered';
					}
				} )
				.catch( ( error ) => {
					if ( registrations.get( abilityName ) === registration ) {
						registrations.delete( abilityName );
					}
					if ( controller.signal.aborted ) {
						return;
					}
					reportDiagnostic( {
						code: 'registration-failed',
						message: `WebMCP could not register frontend Ability "${ abilityName }".`,
						abilityNames: [ abilityName ],
						toolName: candidate.toolName,
						error,
					} );
				} );
			registration.promise = promise;
			pending.push( promise );
		}

		await Promise.allSettled( pending );
	};

	return {
		start() {
			if ( ! started ) {
				started = true;
				unsubscribe = subscribe?.( sync ) ?? null;
			}
			return sync();
		},
		stop() {
			unsubscribe?.();
			unsubscribe = null;
			started = false;
			for ( const abilityName of [ ...registrations.keys() ] ) {
				removeRegistration( abilityName );
			}
		},
		sync,
	};
}

/**
 * Builds a stable fingerprint for the fields that define a projected Ability.
 *
 * @param {Object} ability A WordPress Ability record.
 * @return {string} A deterministic definition fingerprint.
 */
export function fingerprintAbility( ability ) {
	return stableSerialize( {
		callback: ability.callback,
		category: ability.category,
		description: ability.description,
		inputSchema: ability.input_schema,
		label: ability.label,
		meta: ability.meta,
		name: ability.name,
		outputSchema: ability.output_schema,
		permissionCallback: ability.permissionCallback,
	} );
}

function stableSerialize( value, seen = new WeakSet() ) {
	if ( typeof value === 'function' ) {
		if ( ! functionIds.has( value ) ) {
			functionIds.set( value, nextFunctionId++ );
		}
		return `function:${ functionIds.get( value ) }`;
	}

	if ( value === undefined ) {
		return 'undefined';
	}

	if ( value === null || typeof value !== 'object' ) {
		return JSON.stringify( value );
	}

	if ( seen.has( value ) ) {
		return 'circular';
	}
	seen.add( value );

	const serialized = Array.isArray( value )
		? `[${ value
				.map( ( item ) => stableSerialize( item, seen ) )
				.join( ',' ) }]`
		: `{${ Object.keys( value )
				.sort()
				.map(
					( key ) =>
						`${ JSON.stringify( key ) }:${ stableSerialize(
							value[ key ],
							seen
						) }`
				)
				.join( ',' ) }}`;

	seen.delete( value );
	return serialized;
}
