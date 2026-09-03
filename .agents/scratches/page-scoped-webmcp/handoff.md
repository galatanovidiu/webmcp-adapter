# Page-scoped WebMCP final handoff

Last updated: 3 September 2026.

## Status

Batches 0 through 8 are merged into `trunk` through pull requests #9 through #17.
Batch 9 implementation and acceptance are complete on
`chore/batch-9-acceptance-cleanup`, based on
`0a0bd66617236ede2750c4a9ab25629c32e7f3f6`, and delivered through pull request
#18. Merge and live `origin/trunk` verification are the only remaining steps. No
plugin zip or release was created.

The final product contract is documented in:

- [`docs/architecture.md`](../../../docs/architecture.md);
- [`docs/development.md`](../../../docs/development.md);
- [`docs/webmcp-reference.md`](../../../docs/webmcp-reference.md);
- [`docs/webmcp-learning-guide.md`](../../../docs/webmcp-learning-guide.md); and
- [`docs/provider-extension.md`](../../../docs/provider-extension.md).

## Batch 9 changes

- Removed the unreferenced `includes/Settings.php` artifact.
- Preserved retired option values during normal activation and schema migration for
  rollback compatibility.
- Completed WordPress uninstall cleanup for the activity table, schema and retired
  options, retention schedule, and hashed anonymous rate-limit transients.
- Added pure and live WordPress uninstall tests.
- Added a private REST-enabled `webmcp_note` post type to the acceptance-only
  fixture and proved compatible block-editor selection without an adapter list.
- Expanded the final page matrix to post, page, compatible custom-post-type, Site
  Editor and its Pages in-shell route, both provider pages, authenticated/anonymous
  home and singular pages, and login/reset/registration screens.
- Added stale-handle execution rejection after provider Ability removal.
- Corrected the raw CDP CLI to detect its input shape with any readonly no-input
  tool, preferring page context, so Dashboard setup works.
- Synchronized README, architecture, development, WebMCP reference, learning guide,
  research, provider guide, blog post, implementation plan, active skills, and
  project instructions with the final page-scoped behavior.
- Regenerated the tracked speech-friendly PDF and visually checked all six pages.

## Deterministic evidence

Environment:

- WordPress 7.0.4 from the immutable WordPress.org archive;
- PHP 8.3 in WordPress Playground;
- Node.js 22.23.1;
- PHP CLI 8.5.10 for pure contracts; and
- Google Chrome 152.0.7977.65 for page-side suites.

Pure and formatting checks:

- `npm test`: 32 passed, 0 failed.
- `npm run test:php`: 31 activity + 10 provider + 4 uninstall checks passed.
- WordPress formatting completed for every changed JavaScript/JSON artifact.
- Raw CDP Dashboard setup listed the exact two tools, detected `string` input on
  Chrome 152, and executed structured `webmcp.get-page-context`.

System-Chrome suites on the mounted WordPress 7.0.4 runtime:

- `tools/verify-page-scoping.mjs`: all 15 exact page inventories, 12 eligible-page
  minimized activity checks, three authentication-screen asset exclusions, and
  the Site Editor in-shell lifecycle passed.
- `tools/verify-destinations.mjs`: 13 passed, 0 failed.
- `tools/verify-general-form.mjs`: 26 passed, 0 failed.
- `tools/verify-activity-ui.mjs`: 28 passed, 0 failed.
- `.agents/skills/webmcp-playwright/verify-frontend.mjs`: 88 passed, 0 failed.
- `tools/verify-observability.mjs`: 24 passed, 0 failed.
- `tools/verify-provider-fixture.mjs`: 39 passed, 0 failed.

Fresh PHP-in-WordPress processes:

- `tools/verify-observability.php`: 17 passed, 0 failed, including normal-migration
  preservation, additive legacy-row migration, new-write sensitive-field
  exclusion, retention, review, and scheduling.
- `tools/verify-uninstall.php`: 9 passed, 0 failed, including precondition proof
  and complete uninstall-only cleanup.

## Codex built-in-browser evidence

The native Site-tools path on the verified WordPress 7.0.4 runtime confirmed:

- authenticated home and singular pages: three exact tools and structured page
  context;
- anonymous home and singular pages on a second fresh runtime: two exact tools,
  structured context, and no admin destination leakage;
- normal browser navigation from returned site/admin destination URLs followed by
  the correct new document inventory;
- Dashboard: two exact tools, structured context, and 40 rendered admin
  destinations;
- General Settings: three exact tools; two-field partial staging; two highlighted
  controls; manual-save notice; reload restored original values and cleared all
  feedback;
- post editor: 17 exact tools and live published-post context;
- page editor: 17 exact tools and an unsaved insert/read/undo/reload sequence;
- compatible `webmcp_note` editor: 17 exact tools and `postType: webmcp_note`;
- Site Editor: 17 exact tools before and after the visible **Pages** in-shell route;
  the original Site-tools handle still executed, proving the top-level document
  remained active;
- primary fixture: four exact tools, exact read, change, no-op, reversal, removal,
  native stale-handle rejection, two-second restoration, and exact read after
  restoration;
- secondary fixture: three exact tools and reversible change/restore; and
- login, password reset, and disabled-registration screens: zero tools, activity
  controls, and adapter script data.

Built-in consequential-call limitation: the Browser capability timed out its outer
`webmcp.save-post` call while the plugin's trusted confirmation remained visibly
pending. A normal trusted **Decline** click closed the dialog and left the editor
dirty, but the outer caller did not return the structured decline result. A
concurrent approval attempt did not deliver either the call or click through that
timed-out Browser operation. No guard was bypassed. The real page confirmation
decline, trusted approval, cancellation, and expiry paths all passed in the current
system-Chrome suites (88/88 editor and 28/28 activity/confirmation checks).

## Final review gates

Before delivery, verify:

- repository-wide PHP/JavaScript/shell/JSON syntax;
- instruction validator for `AGENTS.md` and all three active skills;
- local Markdown links and anchors;
- no current documentation presents superseded names, inventories, settings, UI,
  or browser behavior;
- `git diff --check` and clean commit boundaries;
- live PR body contains only tests actually run; and
- live merged `origin/trunk` contains the Batch 9 merge.

## Delivery state

Commits, push, pull request, merge, and live merge verification are authorized.
Do not create a release or add a status-only commit to `trunk` after merge.

Pull request: <https://github.com/galatanovidiu/webmcp-adapter/pull/18>.
