import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from './manageReviews.js';

test('manage_reviews schema accepts a bare list_due call', () => {
  assert.equal(schema.safeParse({ operation: 'list_due' }).success, true);
  assert.equal(schema.safeParse({ operation: 'list_due', all: true, includeOnHold: false }).success, true);
});

test('manage_reviews schema rejects unknown fields', () => {
  const r = schema.safeParse({ operation: 'list_due', bogus: 1 });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /bogus|unrecognized/i);
});

test('manage_reviews schema rejects an unknown operation', () => {
  assert.equal(schema.safeParse({ operation: 'review_everything' }).success, false);
});

test('manage_reviews schema rejects list_due with a project', () => {
  const r = schema.safeParse({ operation: 'list_due', projectId: 'p1' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /list_due does not take a project/);
});

test('manage_reviews schema accepts mark_reviewed in both single and batch form', () => {
  assert.equal(schema.safeParse({ operation: 'mark_reviewed', projectId: 'p1' }).success, true);
  assert.equal(schema.safeParse({ operation: 'mark_reviewed', projectName: 'Taxes' }).success, true);
  assert.equal(schema.safeParse({ operation: 'mark_reviewed', projectIds: ['p1', 'p2'] }).success, true);
});

test('manage_reviews schema rejects mark_reviewed with no project', () => {
  const r = schema.safeParse({ operation: 'mark_reviewed' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /needs a project/);
});

test('manage_reviews schema rejects mixing projectIds with a single project', () => {
  const r = schema.safeParse({ operation: 'mark_reviewed', projectId: 'p1', projectIds: ['p2'] });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /Cannot combine projectIds/);
});

test('manage_reviews schema caps projectIds at 100 and rejects an empty batch', () => {
  const tooMany = Array.from({ length: 101 }, (_, i) => `p${i}`);
  assert.equal(schema.safeParse({ operation: 'mark_reviewed', projectIds: tooMany }).success, false);
  assert.equal(schema.safeParse({ operation: 'mark_reviewed', projectIds: [] }).success, false);
});

test('manage_reviews schema requires unit and steps for set_schedule', () => {
  assert.equal(schema.safeParse({ operation: 'set_schedule', projectId: 'p1' }).success, false);
  assert.equal(schema.safeParse({ operation: 'set_schedule', projectId: 'p1', unit: 'week' }).success, false);
  assert.equal(schema.safeParse({ operation: 'set_schedule', projectId: 'p1', unit: 'week', steps: 2 }).success, true);
});

test('manage_reviews schema rejects fractional or zero steps', () => {
  assert.equal(schema.safeParse({ operation: 'set_schedule', projectId: 'p1', unit: 'week', steps: 0 }).success, false);
  assert.equal(schema.safeParse({ operation: 'set_schedule', projectId: 'p1', unit: 'week', steps: 1.5 }).success, false);
});

test('manage_reviews schema rejects plural unit spellings (OmniFocus pluralizes internally)', () => {
  assert.equal(schema.safeParse({ operation: 'set_schedule', projectId: 'p1', unit: 'weeks', steps: 2 }).success, false);
});
