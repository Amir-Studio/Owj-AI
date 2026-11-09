import test from 'node:test';
import assert from 'node:assert/strict';
import { getSubjectPlanFitAdjustments } from '../src/index.js';

const outcome = (subject, plannedMinutes, actualMinutes, completed = true) => ({
  kind: 'plan_outcome', subject, plannedMinutes, actualMinutes, completed
});

test('does not adjust a subject with fewer than three outcomes', () => {
  const result = getSubjectPlanFitAdjustments([
    outcome('Math', 60, 20, false),
    outcome('Math', 60, 30, false)
  ]);
  assert.equal(result.Math.factor, 1);
  assert.equal(result.Math.status, 'insufficient_feedback');
});

test('reduces only the repeatedly overestimated subject allocation', () => {
  const result = getSubjectPlanFitAdjustments([
    outcome('Math', 60, 30, false),
    outcome('Math', 60, 35, false),
    outcome('Math', 60, 25, false),
    outcome('Physics', 60, 60, true),
    outcome('Physics', 60, 65, true),
    outcome('Physics', 60, 55, true)
  ]);
  assert.equal(result.Math.factor, 0.85);
  assert.equal(result.Physics.factor, 1);
  assert.equal(result.Math.sampleSize, 3);
});

test('caps evidence to the latest eight outcomes per subject', () => {
  const entries = [
    ...Array.from({ length: 8 }, () => outcome('Chemistry', 60, 60, true)),
    outcome('Chemistry', 60, 0, false),
    outcome('Chemistry', 60, 0, false),
    outcome('Chemistry', 60, 0, false)
  ];
  const result = getSubjectPlanFitAdjustments(entries);
  assert.equal(result.Chemistry.sampleSize, 8);
  assert.equal(result.Chemistry.factor, 1);
});
