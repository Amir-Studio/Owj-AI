const INPUT_KEYS = Object.freeze([
  'studyMinutes7d', 'studyMinutesPrevious7d', 'activeDays7d',
  'sessions7d', 'completionRate', 'plannedVsActualPercent',
  'assessmentPerformance', 'daysUntilNextExam'
]);
const INPUT_RANGES = Object.freeze([
  0, 0, 0, 0, 0, 0, 0, 0
]);
const INPUT_SCALES = Object.freeze([4200, 4200, 7, 70, 100, 150, 100, 90]);
const OUTPUT_SCALE = 10080;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sigmoid = value => 1 / (1 + Math.exp(-clamp(value, -30, 30)));
const tanh = value => Math.tanh(clamp(value, -20, 20));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeFeatures(features = {}) {
  return INPUT_KEYS.map((key, index) => {
    const value = finite(features[key], INPUT_RANGES[index]);
    return clamp(value / INPUT_SCALES[index], 0, 1);
  });
}

function validExample(item) {
  return item && typeof item === 'object' && item.features && typeof item.features === 'object' && !Array.isArray(item.features)
    && Number.isFinite(Number(item.nextWeekMinutes))
    && Number(item.nextWeekMinutes) >= 0
    && Number(item.nextWeekMinutes) <= OUTPUT_SCALE
    && Number.isFinite(Number(item.completionRate))
    && Number(item.completionRate) >= 0
    && Number(item.completionRate) <= 100;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function initialize(seed = 731) {
  const random = seededRandom(seed);
  const hidden = 12;
  return {
    schemaVersion: 1,
    inputKeys: [...INPUT_KEYS],
    hiddenSize: hidden,
    trainedExamples: 0,
    epochs: 0,
    validation: null,
    weights1: Array.from({ length: hidden }, () => Array.from({ length: INPUT_KEYS.length }, () => (random() - 0.5) * 0.5)),
    bias1: Array.from({ length: hidden }, () => 0),
    weights2: Array.from({ length: 2 }, () => Array.from({ length: hidden }, () => (random() - 0.5) * 0.5)),
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

function lossFor(model, examples) {
  if (!examples.length) return null;
  let total = 0;
  for (const example of examples) {
    const prediction = forward(model, normalizeFeatures(example.features)).output;
    const target = [Number(example.nextWeekMinutes) / OUTPUT_SCALE, Number(example.completionRate) / 100];
    total += (prediction[0] - target[0]) ** 2 + (prediction[1] - target[1]) ** 2;
  }
  return total / (examples.length * 2);
}

function trainBatch(model, batch, learningRate) {
  const gradW1 = model.weights1.map(row => row.map(() => 0));
  const gradB1 = model.bias1.map(() => 0);
  const gradW2 = model.weights2.map(row => row.map(() => 0));
  const gradB2 = model.bias2.map(() => 0);

  for (const example of batch) {
    const x = normalizeFeatures(example.features);
    const { hidden, output } = forward(model, x);
    const target = [Number(example.nextWeekMinutes) / OUTPUT_SCALE, Number(example.completionRate) / 100];
    const delta2 = output.map((value, i) => 2 * (value - target[i]) * value * (1 - value));
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
  for (let i = 0; i < model.weights2.length; i++) {
    model.bias2[i] -= scale * gradB2[i];
    for (let j = 0; j < model.weights2[i].length; j++) model.weights2[i][j] -= scale * gradW2[i][j];
  }
  for (let i = 0; i < model.weights1.length; i++) {
    model.bias1[i] -= scale * gradB1[i];
    for (let j = 0; j < model.weights1[i].length; j++) model.weights1[i][j] -= scale * gradW1[i][j];
  }
}

export function createStudyNeuralModel(savedModel = null) {
  let model = savedModel?.schemaVersion === 1
    && Array.isArray(savedModel.weights1) && Array.isArray(savedModel.weights2)
    ? structuredClone(savedModel) : initialize();

  function train(rawExamples, options = {}) {
    if (!Array.isArray(rawExamples)) throw new TypeError('training examples must be an array');
    const examples = rawExamples.filter(validExample);
    if (examples.length < 12) {
      return { status: 'insufficient_training_data', acceptedExamples: examples.length, minimumExamples: 12, model: structuredClone(model) };
    }

    const split = examples.length >= 20 ? Math.max(1, Math.floor(examples.length * 0.8)) : examples.length;
    const training = examples.slice(0, split);
    const validation = examples.slice(split);
    const candidate = initialize(options.seed ?? 731);
    const epochs = clamp(Math.floor(finite(options.epochs, 180)), 20, 800);
    const learningRate = clamp(finite(options.learningRate, 0.035), 0.001, 0.15);
    const batchSize = clamp(Math.floor(finite(options.batchSize, 8)), 1, 32);
    let best = structuredClone(candidate);
    let bestLoss = Infinity;
    let staleEpochs = 0;
    let completedEpochs = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let start = 0; start < training.length; start += batchSize) {
        trainBatch(candidate, training.slice(start, start + batchSize), learningRate);
      }
      completedEpochs = epoch + 1;
      const score = lossFor(candidate, validation.length ? validation : training);
      if (score < bestLoss - 1e-7) {
        bestLoss = score;
        best = structuredClone(candidate);
        staleEpochs = 0;
      } else {
        staleEpochs++;
      }
      if (staleEpochs >= 45) break;
    }

    best.trainedExamples = training.length;
    best.epochs = completedEpochs;
    const validationLoss = lossFor(best, validation);
    best.validation = validation.length ? {
      examples: validation.length,
      meanSquaredError: Number(validationLoss.toFixed(6)),
      meanAbsoluteStudyMinutesError: Math.round(validation.reduce((sum, item) =>
        sum + Math.abs(forward(best, normalizeFeatures(item.features)).output[0] * OUTPUT_SCALE - Number(item.nextWeekMinutes)), 0) / validation.length),
      meanAbsoluteCompletionRateError: Number((validation.reduce((sum, item) =>
        sum + Math.abs(forward(best, normalizeFeatures(item.features)).output[1] * 100 - Number(item.completionRate)), 0) / validation.length).toFixed(2))
    } : null;

    model = best;
    return { status: 'trained', acceptedExamples: examples.length, trainingExamples: training.length, epochs: completedEpochs, validation: best.validation, model: structuredClone(model) };
  }

  function predict(features) {
    if (model.trainedExamples < 12) {
      return { status: 'insufficient_training', confidence: 0, nextWeekMinutes: null, completionRatePercent: null };
    }
    const [minutes, completion] = forward(model, normalizeFeatures(features)).output;
    const validation = model.validation;
    const confidence = validation
      ? clamp(0.25 + Math.min(model.trainedExamples, 100) / 200 - validation.meanSquaredError, 0.1, 0.8)
      : 0.2;
    return {
      status: 'experimental_estimate',
      nextWeekMinutes: Math.round(minutes * OUTPUT_SCALE),
      completionRatePercent: Math.round(completion * 100),
      confidence: Number(confidence.toFixed(2)),
      trainedExamples: model.trainedExamples,
      warning: 'مدل فقط بر اساس داده‌های آموزشی معتبر است؛ پیش‌بینی، تضمین نتیجه یا نمره آزمون نیست.'
    };
  }

  return Object.freeze({
    train,
    predict,
    exportModel: () => structuredClone(model),
    getMetrics: () => ({ trainedExamples: model.trainedExamples, epochs: model.epochs, validation: model.validation })
  });
}

export const STUDY_NEURAL_INPUTS = INPUT_KEYS;
