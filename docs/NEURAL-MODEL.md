# Owj Study Neural Model

The optional neural component is a small, provider-independent feed-forward network that runs in JavaScript on-device.

## Architecture

- Inputs (8): study minutes in the current and previous 7 days, active days, sessions, completion rate, planned-versus-actual percentage, recent assessment performance, and days until the next exam.
- Network: 8 inputs → 12 tanh hidden units → 2 sigmoid outputs.
- Outputs: estimated study minutes for the next 7 days and estimated plan completion rate.
- Training: supervised back-propagation with mini-batches, deterministic initialization, bounded inputs/outputs, a chronological validation tail, and early stopping.
- Runtime: no hosted model, API key, or third-party ML dependency.

## Honest data requirements

The repository contains the model implementation and synthetic unit-test fixtures; it does **not** contain a trained production model or real student training dataset. A model needs at least 12 valid labeled weekly examples to fit; at least 20 are recommended so a chronological holdout can be used. More diverse, consented, representative examples are needed before trusting its predictions.

Each training example must pair a feature snapshot from the end of a week with the actual outcomes in the following week:

```js
{
  features: {
    studyMinutes7d: 1200,
    studyMinutesPrevious7d: 1050,
    activeDays7d: 5,
    sessions7d: 18,
    completionRate: 78,
    plannedVsActualPercent: 82,
    assessmentPerformance: 64,
    daysUntilNextExam: 12
  },
  nextWeekMinutes: 1320,
  completionRate: 80
}
```

Never use future-week information in the input features. Do not mix users' records into one training set without explicit, informed consent and a documented privacy policy. Prefer per-user models or a separately governed, anonymized opt-in training process.

## API

```js
import { createStudyNeuralModel } from '@owj/ai';

const neural = createStudyNeuralModel(savedWeights);
const training = neural.train(labeledWeeklyExamples);
const estimate = neural.predict(currentFeatureSnapshot);
const weightsToPersist = neural.exportModel();
const metrics = neural.getMetrics();
```

The caller must persist exported weights in the authenticated user's own local memory namespace. Reuse the same weights on later launches. Retrain only when new labeled outcomes are available, not on every render.

The predict method reports insufficient training until at least 12 examples have been used. Its output is explicitly experimental and confidence is capped. Validation metrics must be monitored on real chronological holdout data; synthetic tests prove code paths, not predictive quality.

## Integration status

The model is exported as an optional module. The existing deterministic analytics engine remains the trusted fallback and is not silently replaced by neural predictions. The Owj app still needs to collect correctly aligned weekly labels, persist each user's weights, and display model status and uncertainty before using predictions in planning.
