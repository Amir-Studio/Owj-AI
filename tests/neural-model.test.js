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

test('neural model refuses sparse or malformed training data', () => {
  const model = createStudyNeuralModel();
  const result = model.train(makeExamples(8));
  assert.equal(result.status, 'insufficient_training_data');
  assert.equal(model.predict({}).status, 'insufficient_training');
});

test('neural model trains on chronological data and reports holdout metrics', () => {
  const model = createStudyNeuralModel();
  const trained = model.train(makeExamples(), { epochs: 220, seed: 42 });
  assert.equal(trained.status, 'trained');
  assert.equal(trained.acceptedExamples, 50);
  assert.equal(trained.trainingExamples, 40);
  assert.equal(trained.validationExamples, 10);
  assert.equal(trained.validation.examples, 10);
  assert.ok(trained.validation.meanAbsoluteStudyMinutesError >= 0);
  assert.ok(typeof trained.validation.beatsBaseline === 'boolean');
  const prediction = model.predict(makeExamples()[49].features);
  assert.equal(prediction.status, 'experimental_estimate');
  assert.ok(prediction.nextWeekMinutes >= 0 && prediction.nextWeekMinutes <= 10080);
  assert.ok(prediction.nextWeekCompletionRate >= 0 && prediction.nextWeekCompletionRate <= 100);
  assert.ok(['promising_not_proven', 'low_or_unvalidated'].includes(prediction.reliability));
  assert.equal(model.exportModel().schemaVersion, 3);
  assert.equal(STUDY_NEURAL_INPUTS.length, 12);
});

test('saved neural weights restore identical local predictions', () => {
  const first = createStudyNeuralModel();
  first.train(makeExamples(), { seed: 17 });
  const second = createStudyNeuralModel(first.exportModel());
  assert.deepEqual(second.predict(makeExamples()[20].features), first.predict(makeExamples()[20].features));
});

test('malformed feature payloads and duplicate weeks are excluded', () => {
  const model = createStudyNeuralModel();
  const valid = makeExamples(40);
  const malformed = { ...valid[0], features: null };
  const duplicate = { ...valid[0], nextWeekMinutes: 9999 };
  const result = model.train([malformed, ...valid, duplicate]);
  assert.equal(result.status, 'trained');
  assert.equal(result.acceptedExamples, 40);
});

test('invalid inference features are not silently treated as zero', () => {
  const model = createStudyNeuralModel();
  model.train(makeExamples(), { seed: 19 });
  assert.equal(model.predict({ studyMinutes7d: 100 }).status, 'invalid_features');
});

test('old or malformed model weights are safely rejected', () => {
  const model = createStudyNeuralModel({ schemaVersion: 2, hiddenSize: 16, weights1: [[NaN]] });
  assert.equal(model.predict({}).status, 'insufficient_training');
});

test('missing features are represented separately from genuine zero values', () => {
  const model = createStudyNeuralModel();
  const trained = model.train(makeExamples(40), { seed: 7, epochs: 120 });
  assert.equal(trained.status, 'trained');
  const a = model.predict({ studyMinutes7d: 0 });
  const b = model.predict({});
  assert.ok(Number.isFinite(a.nextWeekMinutes));
  assert.ok(Number.isFinite(b.nextWeekMinutes));
});

test('rejects malformed or incompatible serialized weights safely', () => {
  const model = createStudyNeuralModel({ schemaVersion: 2, inputSize: 999, hiddenSize: 16, weights1: [], weights2: [] });
  assert.equal(model.getMetrics().trainedExamples, 0);
  assert.equal(model.predict({}).status, 'insufficient_training');
});
