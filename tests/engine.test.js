import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOwjAI, analyzeData, detectPatterns, rankPriorities, predictStudyTrend
} from '../src/index.js';

const now = new Date('2026-11-09T12:00:00Z');
const input = {
  userId: 'u1',
  now: now.toISOString(),
  profile: { dailyAvailableMinutes: 240, subjects: ['Math', 'Physics', 'Chemistry'] },
  sessions: [
    { id: '1', subject: 'Math', actualMinutes: 60, plannedMinutes: 60, startedAt: '2026-11-08T08:00:00Z' },
    { id: '2', subject: 'Physics', actualMinutes: 30, plannedMinutes: 45, startedAt: '2026-11-07T17:00:00Z', completed: false },
    { id: '3', subject: 'Math', actualMinutes: 45, plannedMinutes: 45, startedAt: '2026-11-05T08:30:00Z' },
    { id: 'future', subject: 'Math', actualMinutes: 180, startedAt: '2026-11-12T08:00:00Z' }
  ],
  plans: [{ status: 'missed' }],
  exams: [{ subject: 'Physics', date: '2026-11-15', targetMinutes: 300 }]
};

test('aggregates valid sessions and excludes future records', () => {
  const data = analyzeData(input, now);
  assert.equal(data.overview.totalSessions, 3);
  assert.equal(data.overview.totalMinutes, 135);
  assert.equal(data.overview.completionRate, 67);
  assert.equal(data.overview.plannedVsActualPercent, 90);
  assert.equal(data.subjects.find(s => s.subject === 'Chemistry').sessions, 0);
});

test('deduplicates retried sessions by stable ID', () => {
  const duplicated = {
    userId: 'u1',
    profile: { subjects: ['Math'] },
    sessions: [
      { id: 'same-session', subject: 'Math', actualMinutes: 50, startedAt: '2026-11-08T10:00:00Z' },
      { id: 'same-session', subject: 'Math', actualMinutes: 50, startedAt: '2026-11-08T10:00:00Z' }
    ]
  };
  const data = analyzeData(duplicated, now);
  assert.equal(data.overview.totalSessions, 1);
  assert.equal(data.overview.totalMinutes, 50);
});

test('detects patterns and ranks upcoming exams', () => {
  const data = analyzeData(input, now);
  const patterns = detectPatterns(input, data, {}, now);
  const priorities = rankPriorities(input, data, patterns, now);
  assert.equal(patterns.abandonedPlans, 1);
  const examPriority = priorities.find(item => item.type === 'exam' && item.subject === 'Physics');
  assert.ok(examPriority);
  assert.equal(examPriority.studyTargetProgressPercent, 10);
  assert.equal('preparationPercent' in examPriority, false);
  assert.ok(priorities.some(item => item.type === 'subject_gap' && item.subject === 'Chemistry'));
});

test('adaptive proposal stays within its recommended capacity', () => {
  const ai = createOwjAI({ clock: () => now });
  return ai.analyze(input).then(result => {
    const sum = result.planProposal.blocks.reduce((total, block) => total + block.suggestedMinutes, 0);
    assert.equal(sum, result.planProposal.recommendedDailyMinutes);
    assert.ok(sum <= 240);
    assert.ok(result.planProposal.blocks.some(block => block.subject === 'Chemistry'));
  });
});

test('trend avoids a confident forecast without enough history', () => {
  const data = analyzeData(input, now);
  const trend = predictStudyTrend(data, {});
  assert.equal(trend.method, 'insufficient_history');
  assert.equal(trend.confidence, 0.15);
});

test('engine persists isolated per-user memory and one snapshot per week', async () => {
  const ai = createOwjAI({ clock: () => now });
  const first = await ai.analyze(input);
  const second = await ai.analyze(input);
  const memory = await ai.getMemory('u1');
  assert.ok(first.planProposal);
  assert.ok(Array.isArray(first.recommendations));
  assert.equal(memory.lastAnalysisId, second.id);
  assert.equal(memory.snapshots.length, 1);
  assert.equal(await ai.getMemory('u2'), null);
});

test('requires user ID, validates arrays and supports clearing memory', async () => {
  const ai = createOwjAI();
  await assert.rejects(() => ai.analyze({ sessions: [] }), /userId/);
  await assert.rejects(() => ai.analyze({ userId: 'u1', sessions: {} }), /sessions must be an array/);
  await ai.analyze(input);
  await ai.clearMemory('u1');
  assert.equal(await ai.getMemory('u1'), null);
});


test('records recommendation feedback and summarizes usefulness', async () => {
  const ai = createOwjAI({ clock: () => now });
  await ai.recordFeedback({ userId: 'u-feedback', id: 'r1', kind: 'recommendation', recommendationId: 'priority-1', accepted: true, usefulness: 5 });
  await ai.recordFeedback({ userId: 'u-feedback', id: 'r2', kind: 'recommendation', recommendationId: 'priority-2', accepted: false, usefulness: 3 });
  const summary = await ai.getFeedbackSummary('u-feedback');
  assert.equal(summary.recommendationCount, 2);
  assert.equal(summary.acceptanceRatePercent, 50);
  assert.equal(summary.averageUsefulness, 4);
});

test('plan outcomes gradually adjust future workload without overreacting to sparse data', async () => {
  const ai = createOwjAI({ clock: () => now });
  const base = {
    userId: 'u-fit', now: now.toISOString(),
    profile: { dailyAvailableMinutes: 300, subjects: ['Math'] },
    sessions: [], plans: [], exams: []
  };
  const before = await ai.analyze(base);
  assert.equal(before.planProposal.feedbackAdjustment.status, 'insufficient_feedback');
  for (let i = 0; i < 3; i++) {
    await ai.recordFeedback({
      userId: 'u-fit', id: 'plan-' + i, kind: 'plan_outcome',
      plannedMinutes: 100, actualMinutes: 40, completed: false, subject: 'Math'
    });
  }
  const after = await ai.analyze(base);
  assert.equal(after.planProposal.feedbackAdjustment.factor, 0.85);
  assert.ok(after.planProposal.recommendedDailyMinutes < before.planProposal.recommendedDailyMinutes);
  assert.equal(after.feedback.planOutcomeCount, 3);
});

test('rejects malformed feedback and keeps feedback isolated by user', async () => {
  const ai = createOwjAI({ clock: () => now });
  await assert.rejects(() => ai.recordFeedback({ userId: 'u1', kind: 'recommendation' }), /accepted boolean/);
  await assert.rejects(() => ai.recordFeedback({ userId: 'u1', kind: 'plan_outcome', plannedMinutes: 0 }), /plannedMinutes/);
  await ai.recordFeedback({ userId: 'u1', kind: 'recommendation', accepted: true });
  assert.equal((await ai.getFeedbackSummary('u2')).totalEvents, 0);
});
