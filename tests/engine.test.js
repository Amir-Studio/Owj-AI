import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOwjAI, analyzeData, assessDataQuality, detectPatterns, rankPriorities, predictStudyTrend
} from '../src/index.js';

import { createWeeklyForecast, settleWeeklyForecasts, summarizeForecastAccuracy } from '../src/core/forecast.js';

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
  assert.equal(examPriority.reasonCode, 'EXAM_URGENCY_AND_PREPARATION_GAP');
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
  assert.ok(first.planProposal.blocks.every(block => typeof block.reasonCode === 'string'));
  assert.ok(first.recommendations.every(item => typeof item.reasonCode === 'string'));
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


test('stores a weekly forecast once and measures it against actual future sessions', () => {
  const trend = { estimatedNextWeekMinutes: 420, confidence: 0.4, method: 'weekly_linear_trend' };
  const history = createWeeklyForecast([], trend, now);
  assert.equal(history.length, 1);
  assert.equal(history[0].targetStartAt, '2026-11-16T00:00:00.000Z');
  assert.equal(createWeeklyForecast(history, trend, new Date('2026-11-12T12:00:00Z')).length, 1);

  const sessions = [
    { startedAt: new Date('2026-11-16T08:00:00Z'), actualMinutes: 60 },
    { startedAt: new Date('2026-11-20T08:00:00Z'), actualMinutes: 120 },
    { startedAt: new Date('2026-11-23T08:00:00Z'), actualMinutes: 999 }
  ];
  const evaluationDate = new Date('2026-11-24T00:00:00Z');
  assert.equal(settleWeeklyForecasts(history, sessions, evaluationDate)[0].actualMinutes, null);
  const settled = settleWeeklyForecasts(history, sessions, evaluationDate, evaluationDate);
  assert.equal(settled[0].actualMinutes, 180);
  assert.equal(settled[0].absoluteErrorMinutes, 240);
  assert.equal(summarizeForecastAccuracy(settled).evaluatedForecasts, 1);
  assert.equal(summarizeForecastAccuracy(settled).status, 'collecting');
});


test('trend regression accounts for missing calendar weeks', () => {
  const data = { overview: { totalMinutes7d: 300, totalMinutesPrevious7d: 250 } };
  const memory = { snapshots: [
    { weekKey: '2026-10-05', totalMinutes7d: 100 },
    { weekKey: '2026-10-19', totalMinutes7d: 200 },
    { weekKey: '2026-11-02', totalMinutes7d: 300 }
  ] };
  const trend = predictStudyTrend(data, memory);
  assert.equal(trend.method, 'gap_aware_weekly_linear_trend');
  assert.equal(trend.slopeMinutesPerWeek, 50);
});

test('assesses malformed, future, duplicate and unstable session records', () => {
  const quality = assessDataQuality([
    { id: 's1', subject: 'Math', actualMinutes: 30, startedAt: '2026-11-08T10:00:00Z' },
    { id: 's1', subject: 'Math', actualMinutes: 30, startedAt: '2026-11-08T10:00:00Z' },
    { subject: 'Physics', actualMinutes: 20, startedAt: '2026-11-07T10:00:00Z' },
    { id: 'future', actualMinutes: 20, startedAt: '2026-11-12T10:00:00Z' },
    { id: 'bad', actualMinutes: -2, startedAt: 'not-a-date' }
  ], now);
  assert.equal(quality.totalRecords, 5);
  assert.equal(quality.usableRecords, 2);
  assert.equal(quality.duplicateRecords, 1);
  assert.equal(quality.missingStableIds, 1);
  assert.equal(quality.futureRecords, 1);
  assert.equal(quality.invalidRecords, 1);
  assert.equal(quality.status, 'low');
});


test('serializes concurrent feedback writes without losing events', async () => {
  const ai = createOwjAI({ clock: () => now });
  await Promise.all(Array.from({ length: 20 }, (_, index) => ai.recordFeedback({
    userId: 'u-concurrent', id: 'event-' + index, kind: 'recommendation',
    recommendationId: 'rec-' + index, accepted: index % 2 === 0
  })));
  const summary = await ai.getFeedbackSummary('u-concurrent');
  assert.equal(summary.totalEvents, 20);
  assert.equal(summary.recommendationCount, 20);
  assert.equal(summary.acceptanceRatePercent, 50);
});


test('preserves feedback when analysis and feedback arrive concurrently', async () => {
  const ai = createOwjAI({ clock: () => now });
  const payload = { ...input, userId: 'u-race' };
  await Promise.all([
    ai.analyze(payload),
    ai.recordFeedback({
      userId: 'u-race', id: 'parallel-event', kind: 'recommendation',
      recommendationId: 'rec-1', accepted: true
    })
  ]);
  const memory = await ai.getMemory('u-race');
  assert.equal(memory.feedback.length, 1);
  assert.equal(memory.feedback[0].id, 'parallel-event');
  assert.equal(memory.snapshots.length, 1);
});

test('recovers safely from malformed optional memory collections', async () => {
  let saved = {
    schemaVersion: 3,
    snapshots: [null, { weekKey: 'broken', totalMinutes7d: 'not-a-number' }],
    feedback: { invalid: true },
    forecastHistory: [null, { targetStartAt: 'bad', targetEndAt: 'bad' }],
    patterns: 'invalid'
  };
  const storage = {
    async get() { return saved; },
    async set(_userId, value) { saved = value; },
    async remove() { saved = null; }
  };
  const ai = createOwjAI({ storage, clock: () => now });
  const result = await ai.analyze({ ...input, userId: 'u-corrupt' });
  assert.equal(result.feedback.totalEvents, 0);
  assert.equal(saved.schemaVersion, 3);
  assert.ok(Array.isArray(saved.snapshots));
  assert.ok(Array.isArray(saved.forecastHistory));
});


test('uses recent assessment performance to prioritize weak subjects', async () => {
  const ai = createOwjAI({ clock: () => now });
  const result = await ai.analyze({
    userId: 'u-assessments',
    profile: { dailyAvailableMinutes: 180, subjects: ['Math', 'Physics'] },
    sessions: [], plans: [], exams: [],
    assessments: [
      { id: 'm1', subject: 'Math', score: 4, maxScore: 10, date: '2026-11-08T10:00:00Z', type: 'quiz' },
      { id: 'm2', subject: 'Math', scorePercent: 35, date: '2026-11-06T10:00:00Z', type: 'quiz' },
      { id: 'p1', subject: 'Physics', scorePercent: 92, date: '2026-11-08T10:00:00Z', type: 'quiz' }
    ]
  });
  const math = result.subjects.find(subject => subject.subject === 'Math');
  const physics = result.subjects.find(subject => subject.subject === 'Physics');
  assert.equal(math.recentPerformancePercent, 38);
  assert.equal(math.assessmentCount, 2);
  assert.equal(physics.recentPerformancePercent, 92);
  const weakSubject = result.priorities.find(item => item.reasonCode === 'LOW_ASSESSMENT_PERFORMANCE');
  assert.equal(weakSubject.subject, 'Math');
  assert.equal(weakSubject.priority, 'high');
});
