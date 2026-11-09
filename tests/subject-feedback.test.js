import test from 'node:test';
import assert from 'node:assert/strict';
import { getSubjectPlanFitAdjustments, proposeAdaptivePlan, getPlanFitAdjustment, summarizeFeedback } from '../src/index.js';

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

test('feeds subject feedback into future proposal weights without changing saved plans', () => {
  const input = {
    profile: { dailyAvailableMinutes: 240, subjects: ['Math', 'Physics'] },
    sessions: [], plans: [], exams: []
  };
  const data = {
    overview: { totalSessions: 10, completionRate: 80 },
    subjects: [{ subject: 'Math' }, { subject: 'Physics' }]
  };
  const patterns = { completionRate: 80, signals: [] };
  const weakMathFeedback = [
    outcome('Math', 60, 30, false),
    outcome('Math', 60, 35, false),
    outcome('Math', 60, 25, false),
    outcome('Physics', 60, 60, true),
    outcome('Physics', 60, 65, true),
    outcome('Physics', 60, 55, true)
  ];
  const baseline = proposeAdaptivePlan(input, data, [], patterns);
  const adapted = proposeAdaptivePlan(input, data, [], patterns, new Date('2026-01-01T00:00:00Z'), { feedback: weakMathFeedback });
  const baselineMath = baseline.blocks.find(item => item.subject === 'Math').suggestedMinutes;
  const adaptedMath = adapted.blocks.find(item => item.subject === 'Math').suggestedMinutes;
  assert.ok(adaptedMath < baselineMath);
  assert.equal(adapted.subjectFitAdjustments.Math.factor, 0.85);
  assert.equal(adapted.blocks.reduce((sum, item) => sum + item.suggestedMinutes, 0), adapted.recommendedDailyMinutes);
});


test('ignores incomplete legacy outcomes instead of learning that they were zero-minute sessions', () => {
  const mixed = [
    outcome('Math', 60, 0, false),
    { kind: 'plan_outcome', subject: 'Math', plannedMinutes: 60, completed: false },
    { kind: 'plan_outcome', subject: 'Math', plannedMinutes: 60, actualMinutes: NaN, completed: false },
    outcome('Math', 60, 60, true),
    outcome('Math', 60, 60, true)
  ];
  const subjectFit = getSubjectPlanFitAdjustments(mixed);
  assert.equal(subjectFit.Math.sampleSize, 3);
  assert.equal(subjectFit.Math.factor, 1);
  const globalFit = getPlanFitAdjustment(mixed);
  assert.equal(globalFit.sampleSize, 3);
  assert.equal(globalFit.factor, 1);
  const summary = summarizeFeedback(mixed);
  assert.equal(summary.planOutcomeCount, 3);
  assert.equal(summary.medianActualToPlannedRatio, 1);
});
