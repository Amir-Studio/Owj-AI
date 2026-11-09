import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyNeuralModel, STUDY_NEURAL_INPUTS } from '../src/index.js';

function makeExamples(count = 50) {
  return Array.from({ length: count }, (_, i) => {
    const studyMinutes7d = 500 + i * 42;
    const completionRate = 40 + (i % 8) * 5;
    return {
      weekStart: new Date(Date.UTC(2025, 0, 6 + i * 7)).toISOString().slice(0, 10),
      features: {
        studyMinutes7d,
        studyMinutesPrevious7d: Math.max(0, studyMinutes7d - 100),
        activeDays7d: 2 + (i % 6),
        sessions7d: 5 + (i % 15),
        completionRate,
        plannedVsActualPercent: completionRate + 8,
        assessmentPerformance: 45 + (i % 8) * 6,
        daysUntilNextExam: 5 + (i % 30),
        consistencyScore: 35 + (i % 10) * 6,
        averageSessionMinutes: 25 + (i % 8) * 5,
        subjectsStudied7d: 2 + (i % 5),
        missedSessions7d: i % 6
      },
      nextWeekMinutes: Math.min(9000, studyMinutes7d * 1.08),
      nextWeekCompletionRate: Math.min(95, completionRate + 4)
    };
  });
}

test('model requires enough complete weekly labels and rejects legacy leaked labels', () => {
  const model = createStudyNeuralModel();
  assert.equal(model.train(makeExamples(8)).status, 'insufficient_training_data');
  const legacy = makeExamples(40).map(({ nextWeekCompletionRate, ...item }) => item);
  assert.equal(model.train(legacy).status, 'insufficient_training_data');
  assert.equal(model.predict({}).status, 'insufficient_training');
});

test('model trains chronologically and evaluates on a held-out future period', () => {
  const model = createStudyNeuralModel();
  const trained = model.train(makeExamples(), { epochs: 180, seed: 42 });
  assert.equal(trained.status, 'trained');
  assert.equal(trained.acceptedExamples, 50);
  assert.equal(trained.trainingExamples, 40);
  assert.equal(trained.validationExamples, 10);
  assert.equal(trained.validation.examples, 10);
  assert.ok(trained.validation.meanAbsoluteStudyMinutesError >= 0);
  assert.ok(typeof trained.validation.beatsBaseline === 'boolean');
  assert.ok(Number.isFinite(trained.validation.baseline.meanMinutes));
  assert.ok(Number.isFinite(trained.validation.baseline.meanCompletionRate));
  const metrics = model.getMetrics();
  assert.equal(metrics.trainingRange.through < metrics.validationRange.from, true);
  const prediction = model.predict(makeExamples()[49].features);
  assert.ok(['experimental_estimate', 'baseline_fallback'].includes(prediction.status));
  if (prediction.status === 'baseline_fallback') {
    assert.equal(prediction.predictor, 'training_mean_baseline');
    assert.equal(prediction.reliability, 'limited');
  }
  assert.ok(prediction.nextWeekMinutes >= 0 && prediction.nextWeekMinutes <= 10080);
  assert.ok(prediction.nextWeekCompletionRate >= 0 && prediction.nextWeekCompletionRate <= 100);
  assert.ok(['limited', 'developing', 'promising_not_proven'].includes(prediction.reliability));
  assert.equal(model.exportModel().schemaVersion, 3);
  assert.equal(STUDY_NEURAL_INPUTS.length, 12);
});

test('saved model weights restore identical predictions', () => {
  const first = createStudyNeuralModel();
  first.train(makeExamples(), { seed: 17 });
  const second = createStudyNeuralModel(first.exportModel());
  assert.deepEqual(second.predict(makeExamples()[20].features), first.predict(makeExamples()[20].features));
});

test('duplicate weeks collapse and malformed records are ignored', () => {
  const model = createStudyNeuralModel();
  const valid = makeExamples(40);
  const malformed = { ...valid[0], features: null };
  const duplicate = { ...valid[0], nextWeekMinutes: 9999 };
  const result = model.train([malformed, ...valid, duplicate]);
  assert.equal(result.status, 'trained');
  assert.equal(result.acceptedExamples, 40);
});

test('missing inference fields are reported rather than silently converted to zero', () => {
  const model = createStudyNeuralModel();
  model.train(makeExamples(), { seed: 19, epochs: 120 });
  assert.equal(model.predict({ studyMinutes7d: 100 }).status, 'invalid_features');
  assert.ok(['experimental_estimate', 'baseline_fallback'].includes(model.predict(makeExamples()[10].features).status));
});

test('invalid or obsolete serialized weights are safely rejected', () => {
  const model = createStudyNeuralModel({ schemaVersion: 2, hiddenSize: 16, weights1: [[NaN]] });
  assert.equal(model.getMetrics().trainedExamples, 0);
  assert.equal(model.predict({}).status, 'insufficient_training');
});

test('minimum 30-week dataset remains eligible after the holdout split', () => {
  const model = createStudyNeuralModel();
  const result = model.train(makeExamples(30), { seed: 23, epochs: 100 });
  assert.equal(result.status, 'trained');
  assert.equal(result.trainingExamples, 24);
  assert.equal(result.validationExamples, 6);
  assert.ok(['experimental_estimate', 'baseline_fallback'].includes(model.predict(makeExamples(29)[28].features).status));
  assert.equal(model.getMetrics().totalExamples, 30);
});
