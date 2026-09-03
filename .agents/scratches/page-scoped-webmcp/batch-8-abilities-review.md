# Batch 8 client Ability checklist

Verdict: Pass.

This report applies the WordPress Abilities create checklist to the two browser-only client Abilities in the disposable provider fixture:

- `webmcp-provider-fixture/get-panel-state`;
- `webmcp-provider-fixture/set-panel-tone`.

The skill's PHP registration, REST `/run`, server MCP projection, and WordPress-capability permission rules are marked N-A because these definitions use WordPress 7.0.4's `@wordpress/abilities` client API and execute in the open document. Their runtime evidence is the standard `document.modelContext.getTools()/executeTool()` system-Chrome path. The client `permissionCallback` revalidates DOM availability but is not claimed as a server authorization boundary.

## Fact sheet

| Ability | Page ownership | Category | Annotations | Adapter risk | Behavior |
| --- | --- | --- | --- | --- | --- |
| `get-panel-state` | Primary fixture page only | `webmcp-provider-fixture` | read-only, non-destructive, idempotent | read (derived) | Returns the exact live primary `page` and `tone`; stale availability denies execution. |
| `set-panel-tone` | Same module on primary and secondary fixture pages | `webmcp-provider-fixture` | write, non-destructive, idempotent | reversible | Sets visible `calm`/`focus` state, validates the visible output before success, returns `previousTone`, performs no synchronized same-value DOM assignment, and restores through the same Ability. |

Both callbacks use the shared `panel-state.js` service, revalidate the live panel, and return closed successful result objects. They do not persist panel/application data or make a provider application request; the adapter separately records bounded activity. The fixture registers its own category before the Abilities, relies on automatic `clientRegistered: true`, and adds matching server-side activity allowlist entries through `webmcp_activity_ability_definitions`.

## Findings

### Blockers

None.

### Should-fix

None.

### Nits

None.

## Evidence

- `npm test`: 32 passed, including exact output keys, invalid/stale/missing-output refusal, desynchronized-output repair, no-op idempotence, reversal, and adapter provider-neutrality.
- `npm run test:php`: 40 passed, including exact page enqueue selection and server-side activity allowlist entries.
- WordPress 7.0.4 + system Chrome fixture verifier: 38 passed, covering 4-tool primary and 3-tool secondary inventories, schema rejection before mutation, missing-output refusal, detached-panel permission denial, live no-op with zero DOM mutations, reversal, unregister/late re-register, bounded stored read/write/failure events, all unrelated page inventories, and zero server Ability-catalog requests.
- Live WebMCP descriptor measurement: read 508 bytes; reversible write 811 bytes.
- The complete Batch 0-7 Chrome regression stayed green on the same runtime: page inventories, destinations 13/13, General Settings 26/26, activity/confirmation 28/28, editor 88/88, and observability 24/24.
- Disposable PHP runtime verification: 16 passed on WordPress 7.0.4.
- Codex's built-in browser discovered 4 primary-page tools, returned the exact `{page, tone}` read, changed/no-op/restored the primary tone, navigated and rediscovered 3 secondary-page tools, changed and restored the secondary tone, then rediscovered only 2 base tools on Dashboard. Its administrator review showed all six fixture calls with the server-side provider/risk allowlist and both page contexts.

## Completeness

Seeded states were primary and secondary pages, both allowed tones, same-tone no-op with a MutationObserver, desynchronized and missing visible output, unsupported tone, detached live panel, full navigation, and same-document unregister/re-register. The lifecycle claim is page-side only: system Chrome observed the live WebMCP map, while same-document ChatGPT Work/Codex model-context refresh timing remains unspecified. No role matrix was seeded because the fixture is a browser-only provider on pages already gated by WordPress's `read` capability; the client `permissionCallback` is deliberately not claimed as server authorization. The provider defines no custom error-code vocabulary; current system Chrome collapses client schema/permission failures to a generic invocation error, while observability stores only the bounded `ability_refused` or `ability_execution_failed` codes. No get/list/restore/delete companion is missing for the one-value visible UI state: the read reports it, and the setter restores it through `previousTone`.

## Coverage appendix

- SCOPE: 16 rules; read 15 PASS/1 N-A, write 14 PASS/2 N-A, 0 FAIL, 0 UNVERIFIED.
- NAME: 17 rules; read 11 PASS/6 N-A, write 11 PASS/6 N-A, 0 FAIL, 0 UNVERIFIED.
- DESC: 18 rules; read 10 PASS/8 N-A, write 13 PASS/5 N-A, 0 FAIL, 0 UNVERIFIED.
- IN: 28 rules; read 3 PASS/25 N-A, write 15 PASS/13 N-A, 0 FAIL, 0 UNVERIFIED.
- OUT: 22 rules; read 11 PASS/11 N-A, write 11 PASS/11 N-A, 0 FAIL, 0 UNVERIFIED.
- PERM: 26 rules; read 0 PASS/26 N-A, write 0 PASS/26 N-A, 0 FAIL, 0 UNVERIFIED.
- EXEC: 22 rules; read 4 PASS/18 N-A, write 11 PASS/11 N-A, 0 FAIL, 0 UNVERIFIED.
- ERR: 22 rules; read 4 PASS/18 N-A, write 5 PASS/17 N-A, 0 FAIL, 0 UNVERIFIED.
- ANN: 17 rules; read 7 PASS/10 N-A, write 8 PASS/9 N-A, 0 FAIL, 0 UNVERIFIED.
- HS: 11 rules; read 3 PASS/8 N-A, write 3 PASS/8 N-A, 0 FAIL, 0 UNVERIFIED.
- RT: 26 rules; read 2 PASS/24 N-A, write 3 PASS/23 N-A, 0 FAIL, 0 UNVERIFIED.
- TEST: 32 rules; read 6 PASS/26 N-A, write 10 PASS/22 N-A, 0 FAIL, 0 UNVERIFIED.
- LIFE: 9 rules; read 0 PASS/9 N-A, write 0 PASS/9 N-A, 0 FAIL, 0 UNVERIFIED.

## Appendix — full ledger

| ID | Read | Reversible write | Evidence |
| --- | --- | --- | --- |
| SCOPE-01 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-02 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-03 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-04 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-05 | PASS | N-A (client fixture scope does not trigger this rule) | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-06 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-07 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-08 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-09 | N-A | N-A | client fixture scope does not trigger this rule |
| SCOPE-10 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-11 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-12 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-13 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-14 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-15 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| SCOPE-16 | PASS | PASS | code:get-panel-state.js:14; set-panel-tone.js:17; webmcp-provider.php:75; live:B8.1/B8.4 |
| NAME-01 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-02 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-03 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-04 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-05 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-06 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-07 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-08 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-09 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-10 | N-A | N-A | client fixture scope does not trigger this rule |
| NAME-11 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-12 | N-A | N-A | client fixture scope does not trigger this rule |
| NAME-13 | N-A | N-A | client fixture scope does not trigger this rule |
| NAME-14 | N-A | N-A | mode excludes create |
| NAME-15 | PASS | PASS | code:get-panel-state.js:11-22; set-panel-tone.js:17-22; live:B8.1 descriptors |
| NAME-16 | N-A | N-A | client fixture scope does not trigger this rule |
| NAME-17 | N-A | N-A | client fixture scope does not trigger this rule |
| DESC-01 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-02 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-03 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-04 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-05 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-06 | PASS | N-A (client fixture scope does not trigger this rule) | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-07 | N-A | N-A | client fixture scope does not trigger this rule |
| DESC-08 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-09 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-10 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-11 | N-A | N-A | client fixture scope does not trigger this rule |
| DESC-12 | N-A | N-A | client fixture scope does not trigger this rule |
| DESC-13 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-14 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-15 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-16 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| DESC-17 | N-A | N-A | client fixture scope does not trigger this rule |
| DESC-18 | PASS | PASS | code:get-panel-state.js:20-22; set-panel-tone.js:20-29; live:B8.1 descriptors |
| IN-01 | PASS | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-02 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-03 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-04 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-05 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-06 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-07 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-08 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-09 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-10 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-11 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-12 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-13 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-14 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-15 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-16 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-17 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-18 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-19 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-20 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-21 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-22 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-23 | N-A | N-A | mode excludes create |
| IN-24 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-25 | N-A | N-A | client fixture scope does not trigger this rule |
| IN-26 | PASS | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-27 | PASS | PASS | code:get-panel-state.js:23-27; set-panel-tone.js:23-34; live:B8.2 invalid-tone |
| IN-28 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-01 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-02 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-03 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-04 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-05 | N-A | N-A | mode excludes create |
| OUT-06 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-07 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-08 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-09 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-10 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-11 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-12 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-13 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-14 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-15 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-16 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-17 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-18 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-19 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-20 | N-A | N-A | client fixture scope does not trigger this rule |
| OUT-21 | PASS | PASS | code:get-panel-state.js:28-35; set-panel-tone.js:35-63; test:provider-fixture.test.mjs:34-99 |
| OUT-22 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-01 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-02 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-03 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-04 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-05 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-06 | N-A | N-A | mode excludes create |
| PERM-07 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-08 | N-A | N-A | mode excludes create |
| PERM-09 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-10 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-11 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-12 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-13 | N-A | N-A | mode excludes create |
| PERM-14 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-15 | N-A | N-A | mode excludes create |
| PERM-16 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-17 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-18 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-19 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-20 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-21 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-22 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-23 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-24 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-25 | N-A | N-A | client fixture scope does not trigger this rule |
| PERM-26 | N-A | N-A | mode excludes create |
| EXEC-01 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-02 | PASS | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-03 | PASS | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-04 | PASS | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-05 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-06 | N-A | N-A | mode excludes create |
| EXEC-07 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-08 | PASS | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-09 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-10 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-11 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-12 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-13 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-14 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-15 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-16 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-17 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-18 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-19 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-20 | N-A | N-A | client fixture scope does not trigger this rule |
| EXEC-21 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| EXEC-22 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:20-107; live:B8.2 execute/no-DOM-no-op/reverse |
| ERR-01 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-02 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-03 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-04 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-05 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-06 | N-A | N-A | mode excludes create |
| ERR-07 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-08 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-09 | N-A | N-A | mode excludes create |
| ERR-10 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-11 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-12 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-13 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-14 | PASS | PASS | code:panel-state.js:23-93; live:B8.2 bounded failure events |
| ERR-15 | PASS | PASS | code:panel-state.js:23-93; live:B8.2 bounded failure events |
| ERR-16 | PASS | PASS | code:panel-state.js:23-93; live:B8.2 bounded failure events |
| ERR-17 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-18 | N-A (client fixture scope does not trigger this rule) | PASS | code:panel-state.js:23-93; live:B8.2 bounded failure events |
| ERR-19 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-20 | PASS | PASS | code:panel-state.js:23-93; live:B8.2 bounded failure events |
| ERR-21 | N-A | N-A | client fixture scope does not trigger this rule |
| ERR-22 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-01 | PASS | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-02 | PASS | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-03 | PASS | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-04 | PASS | N-A (client fixture scope does not trigger this rule) | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-05 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-06 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-07 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-08 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-09 | N-A (client fixture scope does not trigger this rule) | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-10 | PASS | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-11 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-12 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-13 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-14 | PASS | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-15 | PASS | PASS | code:get-panel-state.js:36-43; set-panel-tone.js:64-74; live:B8.1/B8.2; descriptor-bytes=508/811 |
| ANN-16 | N-A | N-A | client fixture scope does not trigger this rule |
| ANN-17 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-01 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-02 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-03 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-04 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-05 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-06 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-07 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-08 | N-A | N-A | client fixture scope does not trigger this rule |
| HS-09 | PASS | PASS | code:panel-state.js:20-107; live:B8.2 no consequential confirmation/panel persistence |
| HS-10 | PASS | PASS | code:panel-state.js:20-107; live:B8.2 no consequential confirmation/panel persistence |
| HS-11 | PASS | PASS | code:panel-state.js:20-107; live:B8.2 no consequential confirmation/panel persistence |
| RT-01 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-02 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-03 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-04 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-05 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-06 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-07 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-08 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-09 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-10 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-11 | N-A | N-A | mode excludes create |
| RT-12 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-13 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-14 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-15 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-16 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-17 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-18 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-19 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-20 | PASS | PASS | live:WordPress-7.0.4/B8.1-B8.4; code:webmcp-provider.php:79-127 |
| RT-21 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-22 | PASS | PASS | live:WordPress-7.0.4/B8.1-B8.4; code:webmcp-provider.php:79-127 |
| RT-23 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-24 | N-A | N-A | client fixture scope does not trigger this rule |
| RT-25 | N-A (client fixture scope does not trigger this rule) | PASS | live:WordPress-7.0.4/B8.1-B8.4; code:webmcp-provider.php:79-127 |
| RT-26 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-01 | PASS | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-02 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-03 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-04 | PASS | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-05 | N-A (client fixture scope does not trigger this rule) | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-06 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-07 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-08 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-09 | N-A (client fixture scope does not trigger this rule) | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-10 | PASS | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-11 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-12 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-13 | N-A (client fixture scope does not trigger this rule) | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-14 | N-A (client fixture scope does not trigger this rule) | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-15 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-16 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-17 | PASS | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-18 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-19 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-20 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-21 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-22 | PASS | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| TEST-23 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-24 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-25 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-26 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-27 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-28 | N-A | N-A | client fixture scope does not trigger this rule |
| TEST-29 | N-A | N-A | mode excludes create |
| TEST-30 | N-A | N-A | mode excludes create |
| TEST-31 | N-A | N-A | mode excludes create |
| TEST-32 | PASS | PASS | test:provider-fixture.test.mjs:34-137; provider-fixture-contract.test.php:112-230; live:verify-provider-fixture 38/38 |
| LIFE-01 | N-A | N-A | mode excludes create |
| LIFE-02 | N-A | N-A | mode excludes create |
| LIFE-03 | N-A | N-A | mode excludes create |
| LIFE-04 | N-A | N-A | mode excludes create |
| LIFE-05 | N-A | N-A | mode excludes create |
| LIFE-06 | N-A | N-A | client fixture scope does not trigger this rule |
| LIFE-07 | N-A | N-A | mode excludes create |
| LIFE-08 | N-A | N-A | mode excludes create |
| LIFE-09 | N-A | N-A | mode excludes create |
