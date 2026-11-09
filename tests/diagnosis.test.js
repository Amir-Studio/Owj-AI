import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwjAI, diagnoseSubjectLearning } from '../src/index.js';

const now = new Date('2026-11-09T12:00:00Z');
const assessmentSet = (scores, subject = 'Chemistry') => scores.map((score, index) => ({
  id: subject + '-' + index,
  subject,
  scorePercent: score,
  date: new Date(Date.UTC(2026, 10, 1 + index)).toISOString()
}));

test('does not diagnose mastery from one assessment', () => {
  const result = diagnoseSubjectLearning({
    subject: 'Chemistry', now,
    assessments: assessmentSet([42])
  });
  assert.equal(result.code, 'insufficient_evidence');
  assert.equal(result.confidence, 0.25);
});

test('separates repeated low performance after meaningful practice from low practice', () => {
  const assessments = assessmentSet([48, 45, 42]);
  const practiced = diagnoseSubjectLearning({
    subject: 'Chemistry', now, assessments,
    sessions: [{ subject: 'Chemistry', actualMinutes: 210, startedAt: '2026-11-08T10:00:00Z' }]
  });
  const underPracticed = diagnoseSubjectLearning({
    subject: 'Chemistry', now, assessments,
    sessions: [{ subject: 'Chemistry', actualMinutes: 45, startedAt: '2026-11-08T10:00:00Z' }]
  });
  assert.equal(practiced.code, 'concept_gap');
  assert.equal(underPracticed.code, 'practice_gap');
});

test('flags a review risk without claiming proven forgetting', () => {
  const result = diagnoseSubjectLearning({
    subject: 'Math', now,
    assessments: assessmentSet([82, 86, 84], 'Math'),
    sessions: [{ subject: 'Math', actualMinutes: 90, startedAt: '2026-10-15T10:00:00Z' }]
  });
  assert.equal(result.code, 'forgetting_risk');
  assert.match(result.explanation, /هنوز افت واقعی اثبات نشده/);
});

test('detects a meaningful decline between prior and recent assessments', () => {
  const result = diagnoseSubjectLearning({
    subject: 'Physics', now,
    assessments: assessmentSet([85, 86, 84, 65, 62, 60], 'Physics')
  });
  assert.equal(result.code, 'declining_performance');
  assert.equal(result.evidence.assessmentTrend, 'declining');
});

test('analysis attaches a transparent diagnosis to each configured subject', async () => {
  const ai = createOwjAI({ clock: () => now });
  const result = await ai.analyze({
    userId: 'diagnosis-test',
    now: now.toISOString(),
    profile: { subjects: ['Chemistry'] },
    sessions: [{ id: 's1', subject: 'Chemistry', actualMinutes: 200, startedAt: '2026-11-08T10:00:00Z' }],
    assessments: assessmentSet([48, 45, 42]),
    plans: [], exams: []
  });
  const chemistry = result.subjects.find(item => item.subject === 'Chemistry');
  assert.equal(chemistry.learningDiagnosis.code, 'concept_gap');
  assert.ok(chemistry.learningDiagnosis.evidence.assessmentCount >= 2);
});
