import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHybridDecision } from '../src/index.js';

const subject = (name, code, confidence, days = 2) => ({
  subject: name,
  learningDiagnosis: {
    code, confidence, explanation: 'evidence', nextAction: 'review',
    evidence: { daysSinceLastStudy: days, assessmentCount: 3 }
  }
});

test('ranks repeated concept-gap evidence above maintenance', () => {
  const result = buildHybridDecision({
    subjects: [subject('Math', 'maintain', 0.7), subject('Chemistry', 'concept_gap', 0.75)],
    priorities: [{ subject: 'Math', score: 30 }, { subject: 'Chemistry', score: 75 }],
    dataQuality: { status: 'high' }, overview: { totalSessions: 40 }
  });
  assert.equal(result.primaryFocus.subject, 'Chemistry');
  assert.equal(result.rankedSubjectActions.length, 2);
});

test('reduces confidence when data quality and history are weak', () => {
  const result = buildHybridDecision({
    subjects: [subject('Physics', 'declining_performance', 0.8)],
    dataQuality: { status: 'low' }, overview: { totalSessions: 1 }
  });
  assert.ok(result.evidence.confidence < 0.5);
  assert.equal(result.evidence.grade, 'limited');
});

test('does not treat an untrained neural model as available', () => {
  const result = buildHybridDecision({
    subjects: [subject('Math', 'monitor', 0.4)],
    neuralForecast: { status: 'insufficient_training', nextWeekMinutes: null }
  });
  assert.equal(result.behavioralOutlook.neuralForecast.status, 'insufficient_training');
  assert.equal(result.behavioralOutlook.neuralForecast.reliability, 'unavailable');
});

test('reports disagreements without letting neural forecast override deterministic evidence', () => {
  const result = buildHybridDecision({
    subjects: [subject('Math', 'practice_gap', 0.6)],
    trend: { direction: 'decreasing' },
    neuralForecast: {
      status: 'experimental_estimate', nextWeekMinutes: 900,
      nextWeekMinutesRange: [700, 1100], nextWeekCompletionRate: 70,
      reliability: 'developing'
    },
    overview: { totalMinutes7d: 600, totalSessions: 15 },
    dataQuality: { status: 'medium' }
  });
  assert.equal(result.disagreements[0].code, 'TREND_NEURAL_DISAGREEMENT');
  assert.equal(result.primaryFocus.subject, 'Math');
});

test('validates its collection inputs', () => {
  assert.throws(() => buildHybridDecision({ subjects: {} }), /must be arrays/);
});
