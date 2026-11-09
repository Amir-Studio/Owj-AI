const FEATURE_KEYS = Object.freeze([
  'studyMinutes7d', 'studyMinutesPrevious7d', 'activeDays7d',
  'sessions7d', 'completionRate', 'plannedVsActualPercent',
  'assessmentPerformance', 'daysUntilNextExam'
]);
const SCALES = Object.freeze([4200, 4200, 7, 70, 100, 150, 100, 90]);
const OUTPUT_SCALE = 10080;
const HIDDEN_SIZE = 16;
const INPUT_SIZE = FEATURE_KEYS.length * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback = NaN) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const sigmoid = z => 1 / (1 + Math.exp(-clamp(z, -25, 25)));
const tanh = z => Math.tanh(clamp(z, -15, 15));

function encode(features = {}) {
  if (!features || typeof features !== 'object' || Array.isArray(features)) features = {};
  const values = [];
  const missing = [];
  for (let i = 0; i < FEATURE_KEYS.length; i++) {
    const raw = features[FEATURE_KEYS[i]];
    const present = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw));
    values.push(present ? clamp(Number(raw) / SCALES[i], 0, 1) : 0);
    missing.push(present ? 0 : 1);
  }
  return values.concat(missing);
}

function validExample(item) {
  if (!item || typeof item !== 'object' || !item.features || typeof item.features !== 'object' || Array.isArray(item.features)) return false;
  if (item.nextWeekMinutes == null || item.nextWeekMinutes === '' || item.completionRate == null || item.completionRate === '') return false;
  const minutes = Number(item.nextWeekMinutes);
  const completion = Number(item.completionRate);
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= OUTPUT_SCALE
    && Number.isFinite(completion) && completion >= 0 && completion <= 100;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
}

function initialize(seed = 731) {
  const random = randomGenerator(seed);
  const limit1 = Math.sqrt(6 / (INPUT_SIZE + HIDDEN_SIZE));
  const limit2 = Math.sqrt(6 / (HIDDEN_SIZE + 2));
  return {
    schemaVersion: 2,
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
  return value?.schemaVersion === 2 && value.inputSize === INPUT_SIZE && value.hiddenSize === HIDDEN_SIZE
    && Array.isArray(value.weights1) && value.weights1.length === HIDDEN_SIZE
    && value.weights1.every(row => Array.isArray(row) && row.length === INPUT_SIZE && row.every(Number.isFinite))
    && Array.isArray(value.bias1) && value.bias1.length === HIDDEN_SIZE && value.bias1.every(Number.isFinite)
    && Array.isArray(value.weights2) && value.weights2.length === 2
    && value.weights2.every(row => Array.isArray(row) && row.length === HIDDEN_SIZE && row.every(Number.isFinite))
    && Array.isArray(value.bias2) && value.bias2.length === 2 && value.bias2.every(Number.isFinite)
    && Number.isFinite(value.trainedExamples) && value.trainedExamples >= 0;
}

function forward(model, x) {
  const hidden = model.weights1.map((row, i) => tanh(row.reduce((sum, weight, j) => sum + weight * x[j], model.bias1[i])));
  const output = model.weights2.map((row, i) => sigmoid(row.reduce((sum, weight, j) => sum + weight * hidden[j], model.bias2[i])));
  return { hidden, output };
}

function score(model, examples) {
  if (!examples.length) return null;
  let minutesAbs = 0, completionAbs = 0, mse = 0;
  for (const item of examples) {
    const output = forward(model, encode(item.features)).output;
    const actualMinutes = Number(item.nextWeekMinutes);
    const actualCompletion = Number(item.completionRate);
    const predictedMinutes = output[0] * OUTPUT_SCALE;
    const predictedCompletion = output[1] * 100;
    minutesAbs += Math.abs(predictedMinutes - actualMinutes);
    completionAbs += Math.abs(predictedCompletion - actualCompletion);
    mse += ((predictedMinutes - actualMinutes) / OUTPUT_SCALE) ** 2 + ((predictedCompletion - actualCompletion) / 100) ** 2;
  }
  return {
    examples: examples.length,
    meanAbsoluteStudyMinutesError: Math.round(minutesAbs / examples.length),
    meanAbsoluteCompletionRateError: Number((completionAbs / examples.length).toFixed(2)),
    normalizedMeanSquaredError: Number((mse / (2 * examples.length)).toFixed(6))
  };
}

function baselineScore(training, evaluation) {
  if (!training.length || !evaluation.length) return null;
  const meanMinutes = training.reduce((sum, item) => sum + Number(item.nextWeekMinutes), 0) / training.length;
  const meanCompletion = training.reduce((sum, item) => sum + Number(item.completionRate), 0) / training.length;
  return {
    meanAbsoluteStudyMinutesError: Math.round(evaluation.reduce((sum, item) => sum + Math.abs(meanMinutes - Number(item.nextWeekMinutes)), 0) / evaluation.length),
    meanAbsoluteCompletionRateError: Number((evaluation.reduce((sum, item) => sum + Math.abs(meanCompletion - Number(item.completionRate)), 0) / evaluation.length).toFixed(2))
  };
}

function trainBatch(model, batch, optimizer, options) {
  const gW1 = model.weights1.map(row => row.map(() => 0));
  const gB1 = model.bias1.map(() => 0);
  const gW2 = model.weights2.map(row => row.map(() => 0));
  const gB2 = model.bias2.map(() => 0);

  for (const item of batch) {
    const x = encode(item.features);
    const { hidden, output } = forward(model, x);
    const targets = [Number(item.nextWeekMinutes) / OUTPUT_SCALE, Number(item.completionRate) / 100];
    const d2 = output.map((value, i) => 2 * (value - targets[i]) * value * (1 - value));
    const d1 = hidden.map((value, j) => (d2[0] * model.weights2[0][j] + d2[1] * model.weights2[1][j]) * (1 - value * value));
    for (let i = 0; i < 2; i++) {
      gB2[i] += d2[i];
      for (let j = 0; j < HIDDEN_SIZE; j++) gW2[i][j] += d2[i] * hidden[j];
    }
    for (let i = 0; i < HIDDEN_SIZE; i++) {
      gB1[i] += d1[i];
      for (let j = 0; j < INPUT_SIZE; j++) gW1[i][j] += d1[i] * x[j];
    }
  }

  const count = batch.length;
  const gradients = [...gW1.flat(), ...gB1, ...gW2.flat(), ...gB2].map(value => value / count);
  const norm = Math.sqrt(gradients.reduce((sum, value) => sum + value * value, 0));
  const clip = norm > options.gradientClip ? options.gradientClip / norm : 1;
  let cursor = 0;
  optimizer.beginStep();
  const apply = (array, shape) => {
    for (let i = 0; i < array.length; i++) {
      if (Array.isArray(array[i])) {
        for (let j = 0; j < array[i].length; j++) {
          const grad = gradients[cursor++] * clip;
          optimizer.step(array[i], j, grad, options);
        }
      } else {
        const grad = gradients[cursor++] * clip;
        optimizer.step(array, i, grad, options);
      }
    }
  };
  apply(model.weights1);
  apply(model.bias1);
  apply(model.weights2);
  apply(model.bias2);
}

function createAdam() {
  const moments = new WeakMap();
  let stepCount = 0;
  return {
    beginStep() { stepCount++; },
    step(array, index, gradient, options) {
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
      array[index] -= options.learningRate * mHat / (Math.sqrt(vHat) + 1e-8);
    }
  };
}

function orderedExamples(raw) {
  const accepted = raw.filter(validExample);
  if (accepted.every(item => item.weekEnding && Number.isFinite(Date.parse(item.weekEnding)))) {
    accepted.sort((a, b) => Date.parse(a.weekEnding) - Date.parse(b.weekEnding));
  }
  const unique = new Map();
  for (const item of accepted) {
    const key = item.weekEnding ? String(item.weekEnding) : null;
    if (key) unique.set(key, item);
    else unique.set(Symbol(), item);
  }
  return [...unique.values()];
}

export function createStudyNeuralModel(savedModel = null) {
  let model = validModel(savedModel) ? structuredClone(savedModel) : initialize();

  function train(rawExamples, config = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
    if (!Array.isArray(rawExamples)) throw new TypeError('training examples must be an array');
    const examples = orderedExamples(rawExamples);
    const minimum = 12;
    if (examples.length < minimum) {
      return { status: 'insufficient_training_data', acceptedExamples: examples.length, minimumExamples: minimum, model: structuredClone(model) };
    }

    const hasHoldout = examples.length >= 20;
    const splitAt = hasHoldout ? Math.max(12, Math.floor(examples.length * 0.8)) : examples.length;
    const training = examples.slice(0, splitAt);
    const validation = examples.slice(splitAt);
    const candidate = config.warmStart && model.trainedExamples ? structuredClone(model) : initialize(config.seed ?? 731);
    const options = {
      epochs: clamp(Math.floor(finite(config.epochs, 300)), 30, 1200),
      learningRate: clamp(finite(config.learningRate, 0.008), 0.0005, 0.04),
      batchSize: clamp(Math.floor(finite(config.batchSize, 8)), 1, 32),
      gradientClip: clamp(finite(config.gradientClip, 1), 0.1, 5)
    };
    const random = randomGenerator(config.seed ?? 731);
    const optimizer = createAdam();
    const baseline = baselineScore(training, validation.length ? validation : training);
    let best = structuredClone(candidate);
    let bestLoss = Infinity;
    let stale = 0;
    let completedEpochs = 0;

    for (let epoch = 0; epoch < options.epochs; epoch++) {
      const shuffled = [...training];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const rate = options.learningRate * Math.max(0.25, 1 - epoch / options.epochs);
      const epochOptions = { ...options, learningRate: rate };
      for (let start = 0; start < shuffled.length; start += options.batchSize) {
        trainBatch(candidate, shuffled.slice(start, start + options.batchSize), optimizer, epochOptions);
      }
      completedEpochs = epoch + 1;
      const evaluation = score(candidate, validation.length ? validation : training);
      const loss = evaluation.normalizedMeanSquaredError;
      if (loss < bestLoss - 1e-7) {
        bestLoss = loss;
        best = structuredClone(candidate);
        stale = 0;
      } else {
        stale++;
      }
      if (stale >= 60) break;
    }

    const evaluation = validation.length ? score(best, validation) : null;
    const comparison = validation.length ? baseline : null;
    const beatsBaseline = evaluation && comparison
      ? evaluation.meanAbsoluteStudyMinutesError <= comparison.meanAbsoluteStudyMinutesError
        && evaluation.meanAbsoluteCompletionRateError <= comparison.meanAbsoluteCompletionRateError
      : null;
    best.trainedExamples = training.length;
    best.epochs = completedEpochs;
    best.validation = evaluation ? { ...evaluation, baseline: comparison, beatsBaseline } : null;
    model = best;
    return {
      status: 'trained',
      acceptedExamples: examples.length,
      trainingExamples: training.length,
      validationExamples: validation.length,
      epochs: completedEpochs,
      validation: best.validation,
      model: structuredClone(model)
    };
  }

  function predict(features = {}) {
    if (model.trainedExamples < 12) {
      return { status: 'insufficient_training', reliability: 'unavailable', nextWeekMinutes: null, completionRatePercent: null };
    }
    const [minuteRatio, completionRatio] = forward(model, encode(features)).output;
    const minutes = Math.round(minuteRatio * OUTPUT_SCALE);
    const completion = Math.round(completionRatio * 100);
    const metrics = model.validation;
    const reliability = !metrics ? 'unvalidated'
      : model.trainedExamples < 30 || metrics.beatsBaseline !== true ? 'limited'
        : model.trainedExamples >= 100 && metrics.meanAbsoluteStudyMinutesError < 600 && metrics.meanAbsoluteCompletionRateError < 12 ? 'promising'
          : 'developing';
    return {
      status: 'experimental_estimate',
      nextWeekMinutes: minutes,
      nextWeekMinutesRange: metrics ? [
        Math.max(0, minutes - metrics.meanAbsoluteStudyMinutesError),
        Math.min(OUTPUT_SCALE, minutes + metrics.meanAbsoluteStudyMinutesError)
      ] : null,
      completionRatePercent: completion,
      completionRateRange: metrics ? [
        Math.max(0, Math.round(completion - metrics.meanAbsoluteCompletionRateError)),
        Math.min(100, Math.round(completion + metrics.meanAbsoluteCompletionRateError))
      ] : null,
      reliability,
      trainedExamples: model.trainedExamples,
      validation: metrics ? {
        studyMinutesMAE: metrics.meanAbsoluteStudyMinutesError,
        completionRateMAE: metrics.meanAbsoluteCompletionRateError,
        beatsSimpleBaseline: metrics.beatsBaseline
      } : null,
      warning: 'این تخمین آزمایشی است و فقط با داده‌های معتبر و نماینده قابل اتکاست؛ تضمین نمره یا نتیجه آزمون نیست.'
    };
  }

  return Object.freeze({
    train,
    predict,
    exportModel: () => structuredClone(model),
    getMetrics: () => ({ trainedExamples: model.trainedExamples, epochs: model.epochs, validation: model.validation }),
    reset: () => { model = initialize(); return model.schemaVersion; }
  });
}

export const STUDY_NEURAL_INPUTS = FEATURE_KEYS;
