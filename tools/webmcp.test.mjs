// Run: node --test tools/webmcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepOk } from './webmcp.mjs';

test('stepOk: transport error is a failure', () => {
  assert.equal(stepOk({ name: 'x', error: 'boom' }), false);
});

test('stepOk: editor write refusal ({inserted:false, reason}) is a failure', () => {
  assert.equal(stepOk({ result: '{"inserted":false,"reason":"allowedBlocks or templateLock"}' }), false);
  assert.equal(stepOk({ result: '{"replaced":false,"reason":"Unknown clientId(s): abc"}' }), false);
});

test('stepOk: declined confirmation ({cancelled:true}) is a failure', () => {
  assert.equal(stepOk({ result: '{"cancelled":true}' }), false);
});

test('stepOk: successful write ({inserted:true, tree}) is ok', () => {
  assert.equal(stepOk({ result: '{"inserted":true,"tree":[]}' }), true);
  assert.equal(stepOk({ result: '{"saved":true,"postId":23,"status":"draft"}' }), true);
});

test('stepOk: a legit false field without a reason is not a failure', () => {
  // e.g. editor-context reporting isDirty:false — a real result, not a refusal.
  assert.equal(stepOk({ result: '{"isDirty":false,"blockCount":3}' }), true);
});

test('stepOk: opaque (non-JSON) string result is treated as ok', () => {
  assert.equal(stepOk({ result: 'done' }), true);
});
