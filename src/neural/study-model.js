const INPUT_SPECS = Object.freeze([
  ['studyMinutes7d', 0, 4200],
  ['studyMinutesPrevious7d', 0, 4200],
  ['activeDays7d', 0, 7],
  ['sessions7d', 0, 70],
  ['completionRate', 0, 100],
  ['plannedVsActualPercent', 0, 150],
  ['assessmentPerformance', 0, 100],
  ['daysUntilNextExam', 0, 90],
  ['consistencyScore', 0, 100],
  ['averageSessionMinutes', 0, 240],
  ['subjectsStudied7d', 0, 20],
  ['missedSessions7d', 0, 70]
]);
const INPUT_KEYS = Object.freeze(INPUT_SPECS.map(([key]) => key));
const OUTPUT_SCALE = 10080;
const MIN_EXAMPLES = 30;
const MIN_VALIDATION_EXAMPLES = 6;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sigmoid = value => 1 / (1 + Math.exp(-clamp(value, -25, 25)));
const tanh = value => Math.tanh(clamp(value, -15, 15));
const finite = value => typeof value === 'number' && Number.isFinite(value);

function normalizeFeatures(features) {
  return INPUT_SPECS.map(([key, min, max]) => (clamp(features[key], min, max) - min) / (max - min));
}

function validModel(saved) {
  if (!saved || saved.schemaVersion !== 2 || saved.hiddenSize !== 16) return false;
  const matrix = (value, rows, columns) => Array.isArray(value) && value.length === rows
    && value.every(row => Array.isArray(row) && row.length === columns && row.every(finite));
  const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(finite);
  return matrix(saved.weights1, 16, INPUT_KEYS.length)
    && vector(saved.bias1, 16)
    && matrix(saved.weights2, 2, 16)
    && vector(saved.bias2, 2)
    && Number.isInteger(saved.trainedExamples) && saved.trainedExamples >= 0;
}

function validExample(item) {
  if (!item || typeof item !== 'object' || !item.features || typeof item.features !== 'object') return false;
  const week = Date.parse(item.weekStart);
  if (!Number.isFinite(week) || new Date(week).toISOString().slice(0, 10) !== item.weekStart) return false;
  if (!INPUT_KEYS.every(key => finite(item.features[key]))) return false;
  if (!finite(item.nextWeekMinutes) || item.nextWeekMinutes < 0 || item.nextWeekMinutes > OUTPUT_SCALE) return false;
  if (!finite(item.nextWeekCompletionRate) || item.nextWeekCompletionRate < 0 || item.nextWeekCompletionRate > 100) return false;
  return true;
}

function seededRandom(seed = 731) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function initialize(seed = 731) {
  const random = seededRandom(seed);
  const hidden = 16;
  const inputLimit = Math.sqrt(6 / (INPUT_KEYS.length + hidden));
  const outputLimit = Math.sqrt(6 / (hidden + 2));
  return {
    schemaVersion: 2,
    inputKeys: [...INPUT_KEYS],
    hiddenSize: hidden,
    trainedExamples: 0,
    epochs: 0,
    validation: null,
    weights1: Array.from({ length: hidden }, () => Array.from({ length: INPUT_KEYS.length }, () => (random() * 2 - 1) * inputLimit)),
    bias1: Array.from({ length: hidden }, () => 0),
    weights2: Array.from({ length: 2 }, () => Array.from({ length: hidden }, () => (random() * 2 - 1) * outputLimit)),
    bias2: [0, 0]
  };
}

function forward(model, x) {
  const hidden = model.weights1.map((weights, i) =>
    tanh(weights.reduce((sum, weight, j) => sum + weight * x[j], model.bias1[i])));
  const output = model.weights2.map((weights, i) =>
    sigmoid(weights.reduce((sum, weight, j) => sum + weight * hidden[j], model.bias2[i])));
  return { hidden, output };
}

function targets(example) {
  return [example.nextWeekMinutes / OUTPUT_SCALE, example.nextWeekCompletionRate / 100];
}

function metricsFor(model, examples, baseline) {
  if (!examples.length) return null;
  let minuteError = 0;
  let completionError = 0;
  let squaredError = 0;
  let baselineMinuteError = 0;
  let baselineCompletionError = 0;
  for (const item of examples) {
    const output = forward(model, normalizeFeatures(item.features)).output;
    const predictedMinutes = output[0] * OUTPUT_SCALE;
    const predictedCompletion = output[1] * 100;
    minuteError += Math.abs(predictedMinutes - item.nextWeekMinutes);
    completionError += Math.abs(predictedCompletion - item.nextWeekCompletionRate);
    squaredError += ((output[0] - item.nextWeekMinutes / OUTPUT_SCALE) ** 2
      + (output[1] - item.nextWeekCompletionRate / 100) ** 2) / 2;
    baselineMinuteError += Math.abs(baseline.minutes - item.nextWeekMinutes);
    baselineCompletionError += Math.abs(baseline.completion - item.nextWeekCompletionRate);
  }
  const n = examples.length;
  const maeMinutes = minuteError / n;
  const maeCompletion = completionError / n;
  const baselineMinutes = baselineMinuteError / n;
  const baselineCompletion = baselineCompletionError / n;
  return {
    examples: n,
    meanSquaredError: Number((squaredError / n).toFixed(6)),
    meanAbsoluteStudyMinutesError: Math.round(maeMinutes),
    meanAbsoluteCompletionRateError: Number(maeCompletion.toFixed(2)),
    baselineStudyMinutesError: Math.round(baselineMinutes),
    baselineCompletionRateError: Number(baselineCompletion.toFixed(2)),
    beatsBaseline: maeMinutes < baselineMinutes && maeCompletion < baselineCompletion
  };
}

function trainBatch(model, batch, learningRate) {
  const gradW1 = model.weights1.map(row => row.map(() => 0));
  const gradB1 = model.bias1.map(() => 0);
  const gradW2 = model.weights2.map(row => row.map(() => 0));
  const gradB2 = model.bias2.map(() => 0);
  for (const example of batch) {
    const x = normalizeFeatures(example.features);
    const { hidden, output } = forward(model, x);
    const target = targets(example);
    const delta2 = output.map((value, i) => (value - target[i]) * value * (1 - value));
    const delta1 = hidden.map((value, j) =>
      (delta2[0] * model.weights2[0][j] + delta2[1] * model.weights2[1][j]) * (1 - value * value));
    for (let i = 0; i < 2; i++) {
      gradB2[i] += delta2[i];
      for (let j = 0; j < hidden.length; j++) gradW2[i][j] += delta2[i] * hidden[j];
    }
    for (let i = 0; i < hidden.length; i++) {
      gradB1[i] += delta1[i];
      for (let j = 0; j < x.length; j++) gradW1[i][j] += delta1[i] * x[j];
    }
  }
  const scale = learningRate / batch.length;
  const apply = (weights, gradients) => {
    for (let i = 0; i < weights.length; i++) {
      for (let j = 0; j < weights[i].length; j++) {
        weights[i][j] -= clamp(gradients[i][j] * scale, -0.5, 0.5);
      }
    }
  };
  for (let i = 0; i < 2; i++) {
    model.bias2[i] -= clamp(gradB2[i] * scale, -0.5, 0.5);
    for (let j = 0; j < model.weights2[i].length; j++) {
      model.weights2[i][j] -= clamp(gradW2[i][j] * scale, -0.5, 0.5);
    }
  }
  for (let i = 0; i < model.weights1.length; i++) {
    model.bias1[i] -= clamp(gradB1[i] * scale, -0.5, 0.5);
    for (let j = 0; j < model.weights1[i].length; j++) {
      model.weights1[i][j] -= clamp(gradW1[i][j] * scale, -0.5, 0.5);
    }
  }
}

export function createStudyNeuralModel(savedModel = null) {
  let model = validModel(savedModel) ? structuredClone(savedModel) : initialize();

  function train(rawExamples, options = {}) {
    if (!Array.isArray(rawExamples)) throw new TypeError('training examples must be an array');
    const byWeek = new Map();
    for (const item of rawExamples) {
      if (validExample(item)) byWeek.set(item.weekStart, item);
    }
    const examples = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    if (examples.length < MIN_EXAMPLES) {
      return {
        status: 'insufficient_training_data',
        acceptedExamples: examples.length,
        minimumExamples: MIN_EXAMPLES,
        requiredFields: ['weekStart', 'features', 'nextWeekMinutes', 'nextWeekCompletionRate']
      };
    }

    const split = Math.floor(examples.length * 0.8);
    const training = examples.slice(0, split);
    const validation = examples.slice(split);
    if (validation.length < MIN_VALIDATION_EXAMPLES) {
      return { status: 'insufficient_validation_data', acceptedExamples: examples.length };
    }
    const candidate = initialize(options.seed ?? 731);
    const epochs = clamp(Math.floor(Number.isFinite(options.epochs) ? options.epochs : 240), 30, 1000);
    const learningRate = clamp(Number.isFinite(options.learningRate) ? options.learningRate : 0.025, 0.001, 0.08);
    const batchSize = clamp(Math.floor(Number.isFinite(options.batchSize) ? options.batchSize : 8), 1, 32);
    const baseline = {
      minutes: training.reduce((sum, item) => sum + item.nextWeekMinutes, 0) / training.length,
      completion: training.reduce((sum, item) => sum + item.nextWeekCompletionRate, 0) / training.length
    };
    let best = structuredClone(candidate);
    let bestLoss = Infinity;
    let staleEpochs = 0;
    let completedEpochs = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let start = 0; start < training.length; start += batchSize) {
        trainBatch(candidate, training.slice(start, start + batchSize), learningRate);
      }
      completedEpochs = epoch + 1;
      const validationMetrics = metricsFor(candidate, validation, baseline);
      const score = validationMetrics.meanSquaredError;
      if (score < bestLoss - 1e-8) {
        bestLoss = score;
        best = structuredClone(candidate);
        staleEpochs = 0;
      } else {
        staleEpochs++;
      }
      if (staleEpochs >= 70) break;
    }

    best.trainedExamples = training.length;
    best.epochs = completedEpochs;
    best.validation = metricsFor(best, validation, baseline);
    best.trainingRange = { from: training[0].weekStart, through: training.at(-1).weekStart };
    best.validationRange = { from: validation[0].weekStart, through: validation.at(-1).weekStart };
    model = best;
    return {
      status: 'trained',
      acceptedExamples: examples.length,
      trainingExamples: training.length,
      validationExamples: validation.length,
      epochs: completedEpochs,
      validation: structuredClone(best.validation),
      model: structuredClone(model)
    };
  }

  function predict(features) {
    if (model.trainedExamples < MIN_EXAMPLES || !model.validation) {
      return { status: 'insufficient_training', nextWeekMinutes: null, nextWeekCompletionRate: null, reliability: 'unvalidated' };
    }
    if (!features || !INPUT_KEYS.every(key => finite(features[key]))) {
      return { status: 'invalid_features', nextWeekMinutes: null, nextWeekCompletionRate: null, reliability: 'unavailable' };
    }
    const output = forward(model, normalizeFeatures(features)).output;
    const validation = model.validation;
    const reliable = validation.examples >= 10 && validation.beatsBaseline
      && validation.meanAbsoluteStudyMinutesError <= 720
      && validation.meanAbsoluteCompletionRateError <= 15;
    return {
      status: 'experimental_estimate',
      nextWeekMinutes: Math.round(output[0] * OUTPUT_SCALE),
      nextWeekCompletionRate: Number((output[1] * 100).toFixed(1)),
      reliability: reliable ? 'promising_not_proven' : 'low_or_unvalidated',
      validation: {
        examples: validation.examples,
        meanAbsoluteStudyMinutesError: validation.meanAbsoluteStudyMinutesError,
        meanAbsoluteCompletionRateError: validation.meanAbsoluteCompletionRateError,
        beatsBaseline: validation.beatsBaseline
      },
      trainedExamples: model.trainedExamples,
      warning: 'این پیش‌بینی آزمایشی است؛ کیفیت آن باید با داده‌های واقعی و آزمون زمانی مستقل تأیید شود.'
    };
  }

  return Object.freeze({
    train,
    predict,
    exportModel: () => structuredClone(model),
    getMetrics: () => ({
      trainedExamples: model.trainedExamples,
      epochs: model.epochs,
      validation: structuredClone(model.validation),
      trainingRange: model.trainingRange ?? null,
      validationRange: model.validationRange ?? null
    })
  });
}

export const STUDY_NEURAL_INPUTS = INPUT_KEYS;
