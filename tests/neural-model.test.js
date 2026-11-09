import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyNeuralModel, STUDY_NEURAL_INPUTS } from '../src/index.js';

function makeExamples(count = 40) {
  return Array.from({ length: count }, (_, i) => {
    const studyMinutes7d = 500 + i * 65;
    const completionRate = 35 + (i % 10) * 5;
    return {
      features: {
        studyMinutes7d,
        studyMinutesPrevious7d: Math.max(0, studyMinutes7d - 120),
        activeDays7d: 2 + (i % 6),
        sessions7d: 5 + (i % 15),
        completionRate,
        plannedVsActualPercent: completionRate + 10,
        assessmentPerformance: 45 + (i % 8) * 6,
        daysUntilNextExam: 5 + (i % 30)
      },
      nextWeekMinutes: Math.min(9000, studyMinutes7d * 1.15),
      completionRate
    };
  });
}

test('neural model refuses to claim a trained prediction with sparse data', () => {
  const model = createStudyNeuralModel();
  const result = model.train(makeExamples(8));
  assert.equal(result.status, 'insufficient_training_data');
  assert.equal(model.predict({}).status, 'insufficient_training');
});

test('neural model trains, validates, predicts and exports portable weights', () => {
  const model = createStudyNeuralModel();
  const trained = model.train(makeExamples(), { epochs: 220, seed: 42 });
  assert.equal(trained.status, 'trained');
  assert.equal(trained.acceptedExamples, 40);
  assert.equal(trained.validation.examples, 8);
  assert.ok(trained.validation.meanAbsoluteStudyMinutesError >= 0);
  const prediction = model.predict(makeExamples()[39].features);
  assert.equal(prediction.status, 'experimental_estimate');
  assert.ok(prediction.nextWeekMinutes >= 0 && prediction.nextWeekMinutes <= 10080);
  assert.ok(prediction.completionRatePercent >= 0 && prediction.completionRatePercent <= 100);
  assert.ok(prediction.confidence <= 0.8);
  assert.equal(model.exportModel().schemaVersion, 1);
  assert.equal(STUDY_NEURAL_INPUTS.length, 8);
});

test('saved neural weights can be restored for local inference', () => {
  const first = createStudyNeuralModel();
  first.train(makeExamples(), { seed: 17 });
  const saved = first.exportModel();
  const second = createStudyNeuralModel(saved);
  assert.deepEqual(second.predict(makeExamples()[20].features), first.predict(makeExamples()[20].features));
});

test('ignores malformed feature payloads without crashing training', () => {
  const model = createStudyNeuralModel();
  const valid = makeExamples(12);
  const result = model.train([{ ...valid[0], features: null }, ...valid]);
  assert.equal(result.status, 'trained');
  assert.equal(result.acceptedExamples, 12);
});
