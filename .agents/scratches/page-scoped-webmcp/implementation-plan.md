# Page-scoped WebMCP implementation plan

Status: implemented; Batch 9 final acceptance and delivery is the remaining gate.

Audience: implementation, verification, and review agents working in this
repository.

The source research is
[`docs/page-scoped-webmcp-tools-research.md`](../../../docs/page-scoped-webmcp-tools-research.md).
The released runtime contract is
[`docs/architecture.md`](../../../docs/architecture.md).

## Outcome

Load a small WebMCP adapter on every eligible top-level WordPress frontend and
wp-admin document. Project only the client Abilities registered by providers for
the current page. Keep the bridge protocol-specific; WordPress and third-party
providers own page selection, schemas, permissions, callbacks, and live-state
guards.

The implementation must:

- expose only the tools applicable to the current document;
- support page-only and shared provider Abilities without adapter changes;
- exclude every `serverRegistered` Ability;
- expose every applicable Ability whose risk metadata is valid;
- return rendered destinations that normal browser navigation can open;
- stage supported General Settings fields without submitting or persisting;
- preserve the generic Gutenberg editor API on every compatible block editor;
- show a minimized, accessible activity control on eligible pages;
- record bounded, redacted observability for every completed attempt; and
- provide a WordPress-native third-party extension contract.

## Page inventory contract

| Page context | Required Site tools |
|---|---|
| Anonymous frontend | `webmcp.get-page-context`, `webmcp.list-site-destinations` |
| Authenticated frontend | Frontend tools plus `webmcp.list-admin-destinations` |
| Generic wp-admin | `webmcp.get-page-context`, `webmcp.list-admin-destinations` |
| General Settings | wp-admin tools plus `wordpress.settings.stage-general-form` |
| Compatible post/page/CPT block editor | wp-admin tools plus all 15 editor tools |
| Site Editor | wp-admin tools plus all 15 editor tools |
| Login/reset/registration/two-factor | No Site tools and no activity UI |

The editor provider owns six reads, eight reversible unsaved writes, and the
consequential `webmcp.save-post` persistence tool. WordPress Ability names project
from `namespace/name` to `namespace.name`.

## Provider and lifecycle contract

- Provider modules are conditionally enqueued through normal WordPress hooks.
- Page selection is module presence, not a central context registry.
- The block-editor provider uses `WP_Screen::is_block_editor()` and has no
  post-type list.
- The Site Editor keeps its provider set across top-level shell routes; callbacks
  reject when the live route or store is not applicable.
- The adapter projects only `clientRegistered === true` records and rejects every
  `serverRegistered === true` record.
- The synchronizer detects Ability and projected-name collisions, awaits
  registration, aborts removals, and removes before same-name replacement.
- Full navigation creates a new discovery boundary. Same-document callbacks retain
  live guards because client refresh timing is unspecified.

## Risk and confirmation contract

Readonly Abilities derive `read`. Mutations declare `reversible`, `persistent`,
`consequential`, or `privileged` at `meta.webmcp.risk`. Missing or invalid mutation
risk fails closed.

Consequential and privileged calls always open the in-page confirmation. The
dialog shows provider, action, page context, risk, and a bounded redacted summary;
requires an `event.isTrusted` approval click; supports decline and Escape; expires
after 60 seconds; observes forwarded cancellation; and revalidates immediately
before execution.

## Form contract

`wordpress.settings.stage-general-form` exposes ten supported optional fields in a
closed schema with `minProperties: 1`. It validates the complete request against
live controls before mutation, updates only provided fields through native setters
and events, verifies visible values, highlights changes, and displays a manual-save
notice.

It never submits, emulates submission, or sends a persistence request. Reloading
discards staged state. Administration Email is never echoed in results, review
feedback, observability, storage, or exporter data.

## Activity and observability contract

Eligible pages mount one fixed 48-pixel activity control in an isolated shadow
root. The detail region opens only on request, supports keyboard and screen-reader
use, remembers its open/minimized state per tab, renders untrusted text safely, and
records running plus final outcomes without affecting the Ability result.

The backend accepts one final event through a hardened endpoint. Stored data is
limited to server-owned normalized identifiers, provider/risk, page context/path,
hashed anonymous identity or user ID, outcome, duration, confirmation result,
bounded error code, and allowlisted safe summary.

Anonymous ingestion uses signed short-lived context tokens, a 4 KB request bound,
and hashed fixed-window rate limits. Default retention is seven days and 10,000
rows. `webmcp_activity_stored` fires after successful storage, subject to
`webmcp_activity_should_export`.

Migration remains additive: existing rows and retired option values survive normal
activation and upgrade. New rows leave legacy sensitive columns empty. WordPress
uninstall removes the plugin's activity table, options, retention schedule, and
temporary rate-limit counters.

## Delivery ledger

| Batch | Delivered result |
|---:|---|
| 0 | Protected naming, risk, driver, and page-inventory contracts |
| 1 | Provider-independent projection and registration lifecycle |
| 2 | Eligible frontend/wp-admin loading and base page providers |
| 3 | Rendered destination discovery and browser-owned navigation |
| 4 | Always-available compatible block-editor provider and trusted confirmation |
| 5 | General Settings staging, review feedback, and sensitive redaction |
| 6 | Minimized accessible activity presentation and risk-based confirmation |
| 7 | Bounded authenticated/anonymous backend observability |
| 8 | Third-party provider fixture and extension documentation |
| 9 | Obsolete artifact removal, uninstall completion, coordinated docs, and final acceptance |

## Batch 9 work

1. Remove the unreferenced Settings class artifact.
2. Preserve retired option values during normal migration and delete them only on
   WordPress uninstall.
3. Complete uninstall cleanup for the table, schema option, schedule, and temporary
   rate-limit counters.
4. Update README, architecture, development, API reference, learning guide,
   research, provider guide, blog post, active skills, CLI examples, PDF, plan, and
   handoff as one contract.
5. Run all Node/PHP tests and repository formatting.
6. Run every deterministic system-Chrome suite on verified WordPress 7.0.4.
7. Run Codex built-in-browser acceptance across every relevant page class.
8. Review the complete diff adversarially; commit narrowly; push; create and verify
   the PR; merge only when every exit criterion is green; verify the live merge.
9. Create no plugin zip or release.

## Final acceptance matrix

| Scenario | Required evidence |
|---|---|
| Anonymous home and singular | Two exact tools; minimized activity; no admin destination leakage |
| Authenticated home and singular | Three exact tools; rendered admin-toolbar destinations |
| Dashboard | Two exact tools; rendered admin-menu destinations |
| General Settings | Three exact tools; validation, partial staging, native events, review feedback, no request/submission/persistence, redaction |
| Post and page editors | Seventeen exact tools; reads, unsaved write, undo, decline, approval, cancellation, expiry |
| Compatible CPT editor | Seventeen exact tools with no adapter post-type list |
| Site Editor | Stable 17-tool inventory across a visible in-shell route change; inapplicable callbacks reject |
| Provider pages | Exact four/three tools; read, reversible write, no-op, reversal, removal, stale-handle rejection, restoration |
| Full navigation | Returned URL opens through normal browser controls; new document inventory is rediscovered |
| Authentication screens | Zero tools, activity UI, and adapter assets |
| Activity UI | Minimized default, running/final states, keyboard, focus, responsive/isolation/session behavior, safe rendering |
| Observability | Authenticated/anonymous ingestion, payload/rate limits, exporter, retention, migration, sensitive redaction |
| Uninstall | Normal upgrade preserves rollback data; uninstall removes all owned persistent/temporary data |

## Completion rule

The project is complete only when every matrix row has current evidence from the
verified disposable WordPress 7.0.4 runtime, primary built-in-browser acceptance is
recorded with exact product limitations, the PR is merged, and live `origin/trunk`
contains the merge. Passing pure tests alone is insufficient.
