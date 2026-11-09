const FEATURE_SPECS = Object.freeze([
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
const FEATURE_KEYS = Object.freeze(FEATURE_SPECS.map(([key]) => key));
const OUTPUT_SCALE = 10080;
const HIDDEN_SIZE = 20;
const INPUT_SIZE = FEATURE_KEYS.length * 2;
const MIN_EXAMPLES = 30;
const MIN_VALIDATION = 6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);
const sigmoid = z => 1 / (1 + Math.exp(-clamp(z, -25, 25)));
const tanh = z => Math.tanh(clamp(z, -15, 15));

function encode(features = {}) {
  const values = [];
  const missing = [];
  for (const [key, min, max] of FEATURE_SPECS) {
    const raw = features?.[key];
    const present = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw));
    values.push(present ? (clamp(Number(raw), min, max) - min) / (max - min) : 0);
    missing.push(present ? 0 : 1);
  }
  return values.concat(missing);
}

function validFeatures(features) {
  if (!features || typeof features !== 'object' || Array.isArray(features)) return false;
  const present = FEATURE_KEYS.filter(key => features[key] !== null && features[key] !== undefined
    && features[key] !== '' && Number.isFinite(Number(features[key])));
  return present.length >= 8;
}

function validExample(item) {
  if (!item || typeof item !== 'object' || !validFeatures(item.features)) return false;
  if (typeof item.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.weekStart)) return false;
  const parsed = Date.parse(item.weekStart);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== item.weekStart) return false;
  return isFiniteNumber(item.nextWeekMinutes) && item.nextWeekMinutes >= 0 && item.nextWeekMinutes <= OUTPUT_SCALE
    && isFiniteNumber(item.nextWeekCompletionRate) && item.nextWeekCompletionRate >= 0 && item.nextWeekCompletionRate <= 100;
}

function randomGenerator(seed = 731) {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
}

function initialize(seed = 731) {
  const random = randomGenerator(seed);
  const limit1 = Math.sqrt(6 / (INPUT_SIZE + HIDDEN_SIZE));
  const limit2 = Math.sqrt(6 / (HIDDEN_SIZE + 2));
  return {
    schemaVersion: 3,
    featureKeys: [...FEATURE_KEYS],
    inputSize: INPUT_SIZE,
    hiddenSize: HIDDEN_SIZE,
    trainedExamples: 0,
    epochs: 0,
    validation: null,
    weights1: Array.from({ length: HIDDEN_SIZE }, () => Array.from({ length: INPUT_SIZE }, () => (random() * 2 - 1) * limit1)),
    bias1: Array(HIDDEN_SIZE).fill(0),
    weights2: Array.from({ length: 2 }, () => Array.from({ length: HIDDEN_SIZE }, () => (random() * 2 - 1) * limit2)),
    bias2: [0, 0]
  };
}

function validModel(value) {
  const matrix = (rows, rowCount, columnCount) => Array.isArray(rows) && rows.length === rowCount
    && rows.every(row => Array.isArray(row) && row.length === columnCount && row.every(isFiniteNumber));
  const vector = (values, length) => Array.isArray(values) && values.length === length && values.every(isFiniteNumber);
  return value?.schemaVersion === 3 && value.inputSize === INPUT_SIZE && value.hiddenSize === HIDDEN_SIZE
    && matrix(value.weights1, HIDDEN_SIZE, INPUT_SIZE) && vector(value.bias1, HIDDEN_SIZE)
    && matrix(value.weights2, 2, HIDDEN_SIZE) && vector(value.bias2, 2)
    && Number.isInteger(value.trainedExamples) && value.trainedExamples >= 0;
}

function forward(model, x) {
  const hidden = model.weights1.map((row, i) => tanh(row.reduce((sum, weight, j) => sum + weight * x[j], model.bias1[i])));
  const output = model.weights2.map((row, i) => sigmoid(row.reduce((sum, weight, j) => sum + weight * hidden[j], model.bias2[i])));
  return { hidden, output };
}

function baselineScore(training, evaluation) {
  if (!training.length || !evaluation.length) return null;
  const meanMinutes = training.reduce((sum, item) => sum + item.nextWeekMinutes, 0) / training.length;
  const meanCompletion = training.reduce((sum, item) => sum + item.nextWeekCompletionRate, 0) / training.length;
  return {
    meanAbsoluteStudyMinutesError: Math.round(evaluation.reduce((sum, item) => sum + Math.abs(meanMinutes - item.nextWeekMinutes), 0) / evaluation.length),
    meanAbsoluteCompletionRateError: Number((evaluation.reduce((sum, item) => sum + Math.abs(meanCompletion - item.nextWeekCompletionRate), 0) / evaluation.length).toFixed(2))
  };
}

function score(model, examples) {
  if (!examples.length) return null;
  let minutesAbs = 0, completionAbs = 0, mse = 0;
  for (const item of examples) {
    const output = forward(model, encode(item.features)).output;
    const actualMinutes = item.nextWeekMinutes;
    const actualCompletion = item.nextWeekCompletionRate;
    const predictedMinutes = output[0] * OUTPUT_SCALE;
    const predictedCompletion = output[1] * 100;
    minutesAbs += Math.abs(predictedMinutes - actualMinutes);
    completionAbs += Math.abs(predictedCompletion - actualCompletion);
    mse += ((predictedMinutes - actualMinutes) / OUTPUT_SCALE) ** 2
      + ((predictedCompletion - actualCompletion) / 100) ** 2;
  }
  return {
    examples: examples.length,
    meanAbsoluteStudyMinutesError: Math.round(minutesAbs / examples.length),
    meanAbsoluteCompletionRateError: Number((completionAbs / examples.length).toFixed(2)),
    normalizedMeanSquaredError: Number((mse / (2 * examples.length)).toFixed(6))
  };
}

function createAdam() {
  const moments = new WeakMap();
  let stepCount = 0;
  return {
    beginStep() { stepCount++; },
    step(array, index, gradient, learningRate) {
      let state = moments.get(array);
      if (!state) {
        state = { m: Array(array.length).fill(0), v: Array(array.length).fill(0) };
        moments.set(array, state);
      }
      const beta1 = 0.9, beta2 = 0.999;
      state.m[index] = beta1 * state.m[index] + (1 - beta1) * gradient;
      state.v[index] = beta2 * state.v[index] + (1 - beta2) * gradient * gradient;
      const mHat = state.m[index] / (1 - Math.pow(beta1, stepCount));
      const vHat = state.v[index] / (1 - Math.pow(beta2, stepCount));
      array[index] -= learningRate * mHat / (Math.sqrt(vHat) + 1e-8);
    }
  };
}

function trainBatch(model, batch, optimizer, learningRate, gradientClip) {
  const gW1 = model.weights1.map(row => row.map(() => 0));
  const gB1 = model.bias1.map(() => 0);
  const gW2 = model.weights2.map(row => row.map(() => 0));
  const gB2 = model.bias2.map(() => 0);
  for (const item of batch) {
    const x = encode(item.features);
    const { hidden, output } = forward(model, x);
    const targets = [item.nextWeekMinutes / OUTPUT_SCALE, item.nextWeekCompletionRate / 100];
    const d2 = output.map((value, i) => 2 * (value - targets[i]) * value * (1 - value));
    const d1 = hidden.map((value, j) =>
      (d2[0] * model.weights2[0][j] + d2[1] * model.weights2[1][j]) * (1 - value * value));
    for (let i = 0; i < 2; i++) {
      gB2[i] += d2[i];
      for (let j = 0; j < HIDDEN_SIZE; j++) gW2[i][j] += d2[i] * hidden[j];
    }
    for (let i = 0; i < HIDDEN_SIZE; i++) {
      gB1[i] += d1[i];
      for (let j = 0; j < INPUT_SIZE; j++) gW1[i][j] += d1[i] * x[j];
    }
  }
  const gradients = [...gW1.flat(), ...gB1, ...gW2.flat(), ...gB2].map(value => value / batch.length);
  const norm = Math.sqrt(gradients.reduce((sum, value) => sum + value * value, 0));
  const scale = norm > gradientClip ? gradientClip / norm : 1;
  let cursor = 0;
  optimizer.beginStep();
  const apply = (arrays) => {
    for (const array of arrays) {
      for (let i = 0; i < array.length; i++) optimizer.step(array, i, gradients[cursor++] * scale, learningRate);
    }
  };
  apply([...model.weights1, model.bias1, ...model.weights2, model.bias2]);
}

function orderedExamples(raw) {
  const accepted = raw.filter(validExample).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const unique = new Map();
  for (const item of accepted) unique.set(item.weekStart, item);
  return [...unique.values()];
}

export function createStudyNeuralModel(savedModel = null) {
  let model = validModel(savedModel) ? structuredClone(savedModel) : initialize();

  function train(rawExamples, config = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
    if (!Array.isArray(rawExamples)) throw new TypeError('training examples must be an array');
    const examples = orderedExamples(rawExamples);
    if (examples.length < MIN_EXAMPLES) {
      return {
        status: 'insufficient_training_data',
        acceptedExamples: examples.length,
        minimumExamples: MIN_EXAMPLES,
        requiredFields: ['weekStart', 'features', 'nextWeekMinutes', 'nextWeekCompletionRate']
      };
    }
    const splitAt = Math.floor(examples.length * 0.8);
    const training = examples.slice(0, splitAt);
    const validation = examples.slice(splitAt);
    if (validation.length < MIN_VALIDATION) return { status: 'insufficient_validation_data', acceptedExamples: examples.length };
    const candidate = config.warmStart && model.trainedExamples ? structuredClone(model) : initialize(config.seed ?? 731);
    const options = {
      epochs: clamp(Math.floor(Number.isFinite(config.epochs) ? config.epochs : 320), 40, 1200),
      learningRate: clamp(Number.isFinite(config.learningRate) ? config.learningRate : 0.006, 0.0005, 0.03),
      batchSize: clamp(Math.floor(Number.isFinite(config.batchSize) ? config.batchSize : 8), 1, 32),
      gradientClip: clamp(Number.isFinite(config.gradientClip) ? config.gradientClip : 1, 0.1, 5)
    };
    const random = randomGenerator(config.seed ?? 731);
    const optimizer = createAdam();
    const baseline = baselineScore(training, validation);
    let best = structuredClone(candidate);
    let bestLoss = Infinity, stale = 0, completedEpochs = 0;
    for (let epoch = 0; epoch < options.epochs; epoch++) {
      const shuffled = [...training];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const learningRate = options.learningRate * Math.max(0.25, 1 - epoch / options.epochs);
      for (let start = 0; start < shuffled.length; start += options.batchSize) {
        trainBatch(modelCandidate(), shuffled.slice(start, start + options.batchSize), optimizer, learningRate, options.gradientClip);
      }
      completedEpochs = epoch + 1;
      const evaluation = score(candidateModel, validation);
      if (evaluation.normalizedMeanSquaredError < bestLoss - 1e-8) {
        bestLoss = evaluation.normalizedMeanSquaredError;
        best = structuredClone(candidateModel);
        stale = 0;
      } else stale++;
      if (stale >= 65) break;
    }
    const evaluation = score(best, validation);
    const beatsBaseline = evaluation.meanAbsoluteStudyMinutesError <= baseline.meanAbsoluteStudyMinutesError
      && evaluation.meanAbsoluteCompletionRateError <= baseline.meanAbsoluteCompletionRateError;
    best.trainedExamples = training.length;
    best.epochs = completedEpochs;
    best.validation = { ...evaluation, baseline, beatsBaseline };
    best.trainingRange = { from: training[0].weekStart, through: training.at(-1).weekStart };
    best.validationRange = { from: validation[0].weekStart, through: validation.at(-1).weekStart };
    model = best;
    return {
      status: 'trained', acceptedExamples: examples.length, trainingExamples: training.length,
      validationExamples: validation.length, epochs: completedEpochs,
      validation: structuredClone(best.validation), model: structuredClone(model)
    };
  }

  function predict(features = {}) {
    if (model.trainedExamples < MIN_EXAMPLES || !model.validation) {
      return { status: 'insufficient_training', reliability: 'unavailable', nextWeekMinutes: null, nextWeekCompletionRate: null };
    }
    if (!validFeatures(features)) return { status: 'invalid_features', reliability: 'unavailable', nextWeekMinutes: null, nextWeekCompletionRate: null };
    const [minuteRatio, completionRatio] = forward(model, encode(features)).output;
    const minutes = Math.round(minuteRatio * OUTPUT_SCALE);
    const completion = Number((completionRatio * 100).toFixed(1));
    const metrics = model.validation;
    const reliability = metrics.beatsBaseline !== true ? 'limited'
      : model.trainedExamples >= 100 && metrics.meanAbsoluteStudyMinutesError < 600 && metrics.meanAbsoluteCompletionRateError < 12
        ? 'promising_not_proven' : 'developing';
    return {
      status: 'experimental_estimate',
      nextWeekMinutes: minutes,
      nextWeekMinutesRange: [Math.max(0, minutes - metrics.meanAbsoluteStudyMinutesError), Math.min(OUTPUT_SCALE, minutes + metrics.meanAbsoluteStudyMinutesError)],
      nextWeekCompletionRate: completion,
      completionRateRange: [Math.max(0, completion - metrics.meanAbsoluteCompletionRateError), Math.min(100, completion + metrics.meanAbsoluteCompletionRateError)],
      reliability,
      trainedExamples: model.trainedExamples,
      validation: {
        examples: metrics.examples,
        studyMinutesMAE: metrics.meanAbsoluteStudyMinutesError,
        completionRateMAE: metrics.meanAbsoluteCompletionRateError,
        beatsSimpleBaseline: metrics.beatsBaseline
      },
      warning: 'این تخمین آزمایشی است و فقط با داده‌های معتبر و نماینده قابل اتکاست؛ تضمین نمره یا نتیجه آزمون نیست.'
    };
  }

  return Object.freeze({
    train,
    predict,
    exportModel: () => structuredClone(model),
    getMetrics: () => ({
      trainedExamples: model.trainedExamples, epochs: model.epochs,
      validation: structuredClone(model.validation),
      trainingRange: model.trainingRange ?? null,
      validationRange: model.validationRange ?? null
    }),
    reset: () => { model = initialize(); return model.schemaVersion; }
  });
}

export const STUDY_NEURAL_INPUTS = FEATURE_KEYS;
