import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwjAI } from '../src/index.js';

function examples(count = 50) {
  return Array.from({ length: count }, (_, i) => ({
    weekStart: new Date(Date.UTC(2025, 0, 6 + i * 7)).toISOString().slice(0, 10),
    features: {
      studyMinutes7d: 400 + i * 35,
      studyMinutesPrevious7d: 350 + i * 30,
      activeDays7d: 2 + i % 6,
      sessions7d: 4 + i % 12,
      completionRate: 45 + i % 8 * 5,
      plannedVsActualPercent: 50 + i % 7 * 6,
      assessmentPerformance: 50 + i % 6 * 5,
      daysUntilNextExam: 4 + i % 25,
      consistencyScore: 40 + i % 9 * 6,
      averageSessionMinutes: 25 + i % 7 * 6,
      subjectsStudied7d: 2 + i % 4,
      missedSessions7d: i % 5
    },
    nextWeekMinutes: 450 + i * 37,
    nextWeekCompletionRate: 50 + i % 8 * 4
  }));
}

test('Owj stores and restores a separate neural model for each user', async () => {
  const owj = createOwjAI({ clock: () => new Date('2026-01-01T12:00:00.000Z') });
  const trained = await owj.trainNeuralModel('student-a', examples(), { seed: 11 });
  assert.equal(trained.status, 'trained');
  assert.equal(trained.acceptedExamples, 50);
  const prediction = await owj.predictNeuralModel('student-a', examples()[49].features);
  assert.equal(prediction.status, 'experimental_estimate');
  assert.equal((await owj.predictNeuralModel('student-b', examples()[49].features)).status, 'insufficient_training');
  assert.equal((await owj.getNeuralMetrics('student-a')).trainedExamples, 40);
});

test('normal analysis does not erase a trained neural model', async () => {
  const owj = createOwjAI({ clock: () => new Date('2026-01-01T12:00:00.000Z') });
  await owj.trainNeuralModel('student-a', examples(), { seed: 7 });
  await owj.analyze({
    userId: 'student-a',
    profile: { dailyAvailableMinutes: 180, subjects: ['Math'] },
    sessions: [], plans: [], exams: [], assessments: []
  });
  assert.equal((await owj.getNeuralMetrics('student-a')).trainedExamples, 40);
});

test('clearing one user memory removes their neural weights only', async () => {
  const owj = createOwjAI({ clock: () => new Date('2026-01-01T12:00:00.000Z') });
  await owj.trainNeuralModel('student-a', examples(), { seed: 7 });
  await owj.trainNeuralModel('student-b', examples(), { seed: 8 });
  await owj.clearMemory('student-a');
  assert.equal((await owj.predictNeuralModel('student-a', examples()[49].features)).status, 'insufficient_training');
  assert.equal((await owj.getNeuralMetrics('student-b')).trainedExamples, 40);
});
