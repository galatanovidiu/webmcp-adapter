/**
 * Frontend Ability: stage supported General Settings controls for human review.
 *
 * This provider is enqueued only on options-general.php. Its callback still
 * revalidates the live form because WebMCP tool handles are document-bound but may
 * outlive a replaced form. Staging is reversible UI state: it never submits the
 * form or persists an option.
 */

import { registerAbility } from '@wordpress/abilities';
import 'webmcp-adapter/category';

const FIELD_NAMES = [
	'siteTitle',
	'tagline',
	'administrationEmail',
	'membership',
	'defaultRole',
	'siteLanguage',
	'timezone',
	'dateFormat',
	'timeFormat',
	'weekStartsOn',
];

const FIELD_NAME_SCHEMA = {
	type: 'string',
	enum: FIELD_NAMES,
};

const FIELD_LABELS = {
	siteTitle: 'Site Title',
	tagline: 'Tagline',
	administrationEmail: 'Administration Email Address',
	membership: 'Membership',
	defaultRole: 'New User Default Role',
	siteLanguage: 'Site Language',
	timezone: 'Timezone',
	dateFormat: 'Date Format',
	timeFormat: 'Time Format',
	weekStartsOn: 'Week Starts On',
};

const ADMINISTRATION_EMAIL_WARNING =
	'WordPress will require email confirmation after the user saves the form.';
const REVIEW_SELECTOR = '[data-webmcp-general-review]';
const STAGED_SELECTOR = '[data-webmcp-general-staged]';
const FEEDBACK_STYLE_ID = 'webmcp-general-settings-feedback-style';
let trackedForm = null;
let trackedFormListeners = null;
let stagedTargets = new Map();

const formObserver = new MutationObserver( () => {
	const currentForm = findGeneralSettingsForm();
	if ( ! trackedForm ) {
		if (
			currentForm?.querySelector(
				`${ REVIEW_SELECTOR }, ${ STAGED_SELECTOR }`
			)
		) {
			clearFeedback( currentForm );
		}
		return;
	}

	if ( currentForm !== trackedForm ) {
		clearFeedback( trackedForm );
		if ( currentForm ) {
			clearFeedback( currentForm );
		}
		stopTrackingForm();
	}
} );
formObserver.observe( document.documentElement, {
	childList: true,
	subtree: true,
} );

const VALIDATION_ERROR_SCHEMA = {
	type: 'object',
	properties: {
		field: { type: 'string' },
		message: { type: 'string' },
	},
	required: [ 'field', 'message' ],
	additionalProperties: false,
};

const WARNING_SCHEMA = {
	type: 'object',
	properties: {
		field: FIELD_NAME_SCHEMA,
		message: { type: 'string' },
	},
	required: [ 'field', 'message' ],
	additionalProperties: false,
};

registerAbility( {
	name: 'wordpress/settings/stage-general-form',
	category: 'webmcp',
	label: 'Stage General Settings',
	description:
		'Stage supported fields in the visible WordPress General Settings form for the user to review. Updates only provided controls and never submits or saves the form. The user must choose Save Changes manually.',
	input_schema: {
		type: 'object',
		properties: {
			siteTitle: {
				type: 'string',
				description:
					'Site Title shown by WordPress and the active theme.',
			},
			tagline: {
				type: 'string',
				description: 'Short description of the site.',
			},
			administrationEmail: {
				type: 'string',
				format: 'email',
				description:
					'Administration Email Address. Treated as sensitive and never echoed in the result or review notice. WordPress requires confirmation after manual save.',
			},
			membership: {
				type: 'boolean',
				description: 'Whether anyone can register an account.',
			},
			defaultRole: {
				type: 'string',
				description:
					'New User Default Role. Must equal a currently available option value.',
			},
			siteLanguage: {
				type: 'string',
				description:
					'Site Language. Must equal a currently available option value.',
			},
			timezone: {
				type: 'string',
				description:
					'Timezone. Must equal a currently available option value.',
			},
			dateFormat: {
				type: 'string',
				minLength: 1,
				description:
					'Date format matching a visible preset or a non-empty custom PHP date format.',
			},
			timeFormat: {
				type: 'string',
				minLength: 1,
				description:
					'Time format matching a visible preset or a non-empty custom PHP time format.',
			},
			weekStartsOn: {
				type: 'integer',
				minimum: 0,
				maximum: 6,
				description:
					'First day of the week, from 0 (Sunday) through 6 (Saturday).',
			},
		},
		minProperties: 1,
		additionalProperties: false,
	},
	output_schema: {
		type: 'object',
		properties: {
			staged: { type: 'boolean' },
			changedFields: {
				type: 'array',
				items: FIELD_NAME_SCHEMA,
			},
			unchangedFields: {
				type: 'array',
				items: FIELD_NAME_SCHEMA,
			},
			validationErrors: {
				type: 'array',
				items: VALIDATION_ERROR_SCHEMA,
			},
			warnings: {
				type: 'array',
				items: WARNING_SCHEMA,
			},
			requiresUserSave: { type: 'boolean' },
			saveControlLabel: { type: 'string' },
		},
		required: [
			'staged',
			'changedFields',
			'unchangedFields',
			'validationErrors',
			'warnings',
			'requiresUserSave',
			'saveControlLabel',
		],
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: false,
			destructive: false,
			idempotent: true,
			clientRegistered: true,
		},
		webmcp: { risk: 'reversible' },
	},
	callback: stageGeneralSettings,
} );

/**
 * Stages supported values in the live form without submitting it.
 *
 * @param {Object} params Supported General Settings fields.
 * @return {Promise<Object>} Structured staging outcome.
 */
async function stageGeneralSettings( params = {} ) {
	const form = findGeneralSettingsForm();
	const saveControl = form?.querySelector( '#submit[type="submit"]' );
	const saveControlLabel =
		saveControl instanceof HTMLInputElement ? saveControl.value.trim() : '';

	if ( ! form || ! saveControl || saveControl.disabled ) {
		return failureResult(
			'form',
			'The live General Settings form and its Save Changes control are not available.',
			saveControlLabel,
			form
		);
	}

	if (
		! params ||
		typeof params !== 'object' ||
		Array.isArray( params ) ||
		Object.keys( params ).length === 0
	) {
		return failureResult(
			'input',
			'Provide at least one supported General Settings field.',
			saveControlLabel,
			form
		);
	}

	const unsupportedFields = Object.keys( params ).filter(
		( field ) => ! FIELD_NAMES.includes( field )
	);
	if ( unsupportedFields.length ) {
		return failureResult(
			'input',
			'One or more provided fields are not supported.',
			saveControlLabel,
			form
		);
	}

	const descriptors = [];
	const validationErrors = [];
	for ( const field of Object.keys( params ) ) {
		const descriptor = createFieldDescriptor(
			form,
			field,
			params[ field ]
		);
		if ( descriptor.error ) {
			validationErrors.push( {
				field,
				message: descriptor.error,
			} );
		} else {
			descriptors.push( descriptor );
		}
	}

	if ( validationErrors.length ) {
		return {
			staged: false,
			changedFields: [],
			unchangedFields: [],
			validationErrors,
			warnings: [],
			requiresUserSave: hasPendingStagedChanges( form ),
			saveControlLabel,
		};
	}

	const changedDescriptors = descriptors.filter(
		( descriptor ) => ! descriptor.matches( descriptor.read() )
	);
	const unchangedFields = descriptors
		.filter( ( descriptor ) => descriptor.matches( descriptor.read() ) )
		.map( ( descriptor ) => descriptor.field );

	try {
		for ( const descriptor of changedDescriptors ) {
			descriptor.before = descriptor.read();
			descriptor.apply();
		}
	} catch {
		revertDescriptors( changedDescriptors );
		return failureResult(
			'form',
			'The live form rejected one or more staged values.',
			saveControlLabel,
			form
		);
	}

	const verificationErrors = changedDescriptors
		.filter( ( descriptor ) => ! descriptor.matches( descriptor.read() ) )
		.map( ( descriptor ) => ( {
			field: descriptor.field,
			message: 'The visible control did not retain the requested value.',
		} ) );

	if ( verificationErrors.length ) {
		revertDescriptors( changedDescriptors );
		return {
			staged: false,
			changedFields: [],
			unchangedFields: [],
			validationErrors: verificationErrors,
			warnings: [],
			requiresUserSave: hasPendingStagedChanges( form ),
			saveControlLabel,
		};
	}

	trackForm( form );
	for ( const descriptor of changedDescriptors ) {
		highlightField( descriptor.field, descriptor.highlightTargets() );
	}
	if ( stagedTargets.size ) {
		renderReviewNotice( form, saveControlLabel );
	}

	return {
		staged: true,
		changedFields: changedDescriptors.map(
			( descriptor ) => descriptor.field
		),
		unchangedFields,
		validationErrors: [],
		warnings: Object.prototype.hasOwnProperty.call(
			params,
			'administrationEmail'
		)
			? [
					{
						field: 'administrationEmail',
						message: ADMINISTRATION_EMAIL_WARNING,
					},
			  ]
			: [],
		requiresUserSave: stagedTargets.size > 0,
		saveControlLabel,
	};
}

/**
 * Finds the one physical General Settings form on the current live route.
 *
 * @return {?HTMLFormElement} The form, or null when the route/form is stale.
 */
function findGeneralSettingsForm() {
	if (
		! /\/wp-admin\/options-general\.php$/.test( window.location.pathname )
	) {
		return null;
	}

	const marker = document.querySelector(
		'form input[name="option_page"][value="general"]'
	);
	return marker?.form instanceof HTMLFormElement ? marker.form : null;
}

/**
 * Builds one live-field adapter or returns a validation error.
 *
 * @param {HTMLFormElement} form  General Settings form.
 * @param {string}          field Public Ability field name.
 * @param {*}               value Requested value.
 * @return {Object} Field descriptor or `{ error }`.
 */
function createFieldDescriptor( form, field, value ) {
	const textFields = {
		siteTitle: '#blogname',
		tagline: '#blogdescription',
		administrationEmail: '#new_admin_email',
	};
	if ( textFields[ field ] ) {
		const control = form.querySelector( textFields[ field ] );
		if ( ! isEditableInput( control ) || typeof value !== 'string' ) {
			return {
				error: 'The requested text control or value is not available.',
			};
		}
		if ( field === 'administrationEmail' && ! isValidEmail( value ) ) {
			return { error: 'Provide a valid Administration Email Address.' };
		}
		return valueDescriptor( field, control, value );
	}

	if ( field === 'membership' ) {
		const control = form.querySelector( '#users_can_register' );
		if (
			! isEditableInput( control ) ||
			control.type !== 'checkbox' ||
			typeof value !== 'boolean'
		) {
			return {
				error: 'The Membership checkbox or value is not available.',
			};
		}
		return checkboxDescriptor( field, control, value );
	}

	const selectFields = {
		defaultRole: '#default_role',
		siteLanguage: '#WPLANG',
		timezone: '#timezone_string',
		weekStartsOn: '#start_of_week',
	};
	if ( selectFields[ field ] ) {
		const control = form.querySelector( selectFields[ field ] );
		const expectedValue =
			field === 'weekStartsOn' && Number.isInteger( value )
				? String( value )
				: value;
		if (
			! ( control instanceof HTMLSelectElement ) ||
			control.disabled ||
			typeof expectedValue !== 'string'
		) {
			return {
				error: 'The requested select control or value is not available.',
			};
		}
		const option = [ ...control.options ].find(
			( item ) => item.value === expectedValue && ! item.disabled
		);
		if ( ! option ) {
			return {
				error: 'Choose a value from the options currently available in the form.',
			};
		}
		return valueDescriptor( field, control, expectedValue );
	}

	if ( field === 'dateFormat' || field === 'timeFormat' ) {
		return formatDescriptor( form, field, value );
	}

	return { error: 'The requested field is not supported.' };
}

function valueDescriptor( field, control, expectedValue ) {
	return {
		field,
		read: () => control.value,
		matches: ( actual ) => actual === expectedValue,
		apply: () => setNativeValue( control, expectedValue ),
		revert: ( previous ) => setNativeValue( control, previous ),
		highlightTargets: () => [ control ],
	};
}

function checkboxDescriptor( field, control, expectedValue ) {
	return {
		field,
		read: () => control.checked,
		matches: ( actual ) => actual === expectedValue,
		apply: () => setNativeChecked( control, expectedValue ),
		revert: ( previous ) => setNativeChecked( control, previous ),
		highlightTargets: () => [ control ],
	};
}

function formatDescriptor( form, field, expectedValue ) {
	if ( typeof expectedValue !== 'string' || expectedValue.length === 0 ) {
		return { error: 'Provide a non-empty date or time format.' };
	}

	const prefix = field === 'dateFormat' ? 'date' : 'time';
	const radios = [
		...form.querySelectorAll( `input[name="${ prefix }_format"]` ),
	];
	const customRadio = form.querySelector(
		`#${ prefix }_format_custom_radio`
	);
	const customInput = form.querySelector( `#${ prefix }_format_custom` );
	if (
		! radios.length ||
		! isEditableInput( customRadio ) ||
		! isEditableInput( customInput )
	) {
		return { error: 'The date or time format controls are not available.' };
	}
	const preset = radios.find(
		( radio ) => radio !== customRadio && radio.value === expectedValue
	);
	const read = () => {
		const selected = radios.find( ( radio ) => radio.checked );
		return selected === customRadio ? customInput.value : selected?.value;
	};
	const applyValue = ( nextValue ) => {
		const nextPreset = radios.find(
			( radio ) => radio !== customRadio && radio.value === nextValue
		);
		if ( nextPreset ) {
			setNativeChecked( nextPreset, true );
			return;
		}
		setNativeValue( customInput, nextValue );
		setNativeChecked( customRadio, true );
	};

	return {
		field,
		read,
		matches: ( actual ) => actual === expectedValue,
		apply: () => applyValue( expectedValue ),
		revert: applyValue,
		highlightTargets: () =>
			preset ? [ preset ] : [ customRadio, customInput ],
	};
}

function isEditableInput( control ) {
	return (
		control instanceof HTMLInputElement &&
		! control.disabled &&
		! control.readOnly
	);
}

function isValidEmail( value ) {
	const input = document.createElement( 'input' );
	input.type = 'email';
	input.required = true;
	input.value = value;
	return input.checkValidity();
}

function setNativeValue( control, value ) {
	const prototype =
		control instanceof HTMLSelectElement
			? HTMLSelectElement.prototype
			: HTMLInputElement.prototype;
	const setter = Object.getOwnPropertyDescriptor( prototype, 'value' )?.set;
	if ( typeof setter !== 'function' ) {
		throw new Error( 'Native value setter is unavailable.' );
	}
	setter.call( control, value );
	dispatchControlEvents( control );
}

function setNativeChecked( control, checked ) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		'checked'
	)?.set;
	if ( typeof setter !== 'function' ) {
		throw new Error( 'Native checked setter is unavailable.' );
	}
	setter.call( control, checked );
	dispatchControlEvents( control );
}

function dispatchControlEvents( control ) {
	control.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	control.dispatchEvent( new Event( 'change', { bubbles: true } ) );
}

function revertDescriptors( descriptors ) {
	for ( const descriptor of [ ...descriptors ].reverse() ) {
		if ( Object.prototype.hasOwnProperty.call( descriptor, 'before' ) ) {
			try {
				descriptor.revert( descriptor.before );
			} catch {}
		}
	}
}

function trackForm( form ) {
	if ( trackedForm === form ) {
		return;
	}

	if ( trackedForm ) {
		clearFeedback( trackedForm );
	}
	clearFeedback( form );
	stopTrackingForm();

	trackedForm = form;
	trackedFormListeners = new AbortController();
	const { signal } = trackedFormListeners;
	form.addEventListener( 'submit', () => clearFeedback( form ), {
		capture: true,
		signal,
	} );
	form.addEventListener(
		'reset',
		() => window.setTimeout( () => clearFeedback( form ), 0 ),
		{ capture: true, signal }
	);
}

function stopTrackingForm() {
	trackedFormListeners?.abort();
	trackedFormListeners = null;
	trackedForm = null;
	stagedTargets = new Map();
}

function highlightField( field, targets ) {
	ensureFeedbackStyles();
	for ( const prior of stagedTargets.get( field ) ?? [] ) {
		prior.removeAttribute( 'data-webmcp-general-staged' );
		prior.removeAttribute( 'data-webmcp-staged-field' );
	}

	for ( const target of targets ) {
		target.setAttribute( 'data-webmcp-general-staged', '' );
		target.setAttribute( 'data-webmcp-staged-field', field );
	}
	stagedTargets.set( field, targets );
}

function ensureFeedbackStyles() {
	if ( document.getElementById( FEEDBACK_STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = FEEDBACK_STYLE_ID;
	style.textContent = `${ STAGED_SELECTOR } { outline: 2px solid #2271b1 !important; outline-offset: 2px !important; }`;
	document.head.append( style );
}

function renderReviewNotice( form, saveControlLabel ) {
	form.querySelector( REVIEW_SELECTOR )?.remove();
	const notice = document.createElement( 'div' );
	notice.className = 'notice notice-info inline';
	notice.setAttribute( 'data-webmcp-general-review', '' );
	notice.setAttribute( 'role', 'status' );

	const message = document.createElement( 'p' );
	const strong = document.createElement( 'strong' );
	strong.textContent = 'Review staged changes.';
	message.append( strong );
	message.append(
		document.createTextNode(
			` Site tools updated ${ [ ...stagedTargets.keys() ]
				.map( ( field ) => FIELD_LABELS[ field ] )
				.join( ', ' ) }. Nothing has been saved yet. Choose ${
				saveControlLabel || 'Save Changes'
			} to persist these values.`
		)
	);
	notice.append( message );
	form.prepend( notice );
}

function clearFeedback( form ) {
	if ( ! form ) {
		return;
	}
	form.querySelector( REVIEW_SELECTOR )?.remove();
	for ( const target of form.querySelectorAll( STAGED_SELECTOR ) ) {
		target.removeAttribute( 'data-webmcp-general-staged' );
		target.removeAttribute( 'data-webmcp-staged-field' );
	}
	if ( form === trackedForm ) {
		stagedTargets = new Map();
	}
}

function hasPendingStagedChanges( form ) {
	return form === trackedForm && stagedTargets.size > 0;
}

function failureResult( field, message, saveControlLabel, form = null ) {
	return {
		staged: false,
		changedFields: [],
		unchangedFields: [],
		validationErrors: [ { field, message } ],
		warnings: [],
		requiresUserSave: hasPendingStagedChanges( form ),
		saveControlLabel,
	};
}
