# Owj Study Neural Model (v2)

The neural module is an optional on-device supervised model. It is a focused predictor for study activity, not a general-purpose tutor or a replacement for the explainable planning engine.

## Architecture

- Eight domain features: current and previous 7-day study minutes, active days, sessions, plan completion, planned-versus-actual percentage, recent assessment performance, and days until the next exam.
- Missingness indicators are appended to the eight normalized values, so a genuinely observed zero is distinguishable from unavailable data.
- Feed-forward network: 16 inputs → 16 tanh hidden units → 2 sigmoid outputs.
- Outputs: next-week study minutes (0–10,080) and expected plan completion (0–100%).
- Training: mini-batch back-propagation, Adam optimization, gradient clipping, learning-rate decay, shuffled training batches, chronological holdout, and early stopping.
- Validation: mean absolute error for each output, normalized MSE, and comparison with a simple validation-set mean baseline.
- Runtime: pure JavaScript; no remote inference API or ML dependency.

## Correct training labels

Each example must pair a feature snapshot available at the end of a week with outcomes observed only in the following week. If supplied, `weekEnding` dates are sorted and duplicate week labels are collapsed. Keep the feature snapshot free of future information.

```js
{
  weekEnding: '2026-10-25',
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

At least 12 valid examples are required to fit. With 20 or more, the final chronological portion is held out for validation. Smaller datasets do not produce a validation score. Prefer substantially more representative weeks before relying on any output.

## API

```js
import { createStudyNeuralModel } from '@owj/ai';

const neural = createStudyNeuralModel(savedWeights);
const training = neural.train(labeledWeeklyExamples, { epochs: 300 });
const estimate = neural.predict(currentFeatureSnapshot);
const weightsToPersist = neural.exportModel();
const metrics = neural.getMetrics();
```

`warmStart: true` may continue training from valid v2 weights; otherwise training starts from a fresh deterministic initialization. Persist exported weights under the authenticated user's own local memory namespace. Do not retrain on every render.

## Interpreting results

Predictions are marked experimental. Reliability labels are deliberately qualitative (`unvalidated`, `limited`, `developing`, `promising`) and depend on sample volume and whether validation errors beat a simple baseline. Error ranges are derived from holdout MAE; they are not statistical confidence intervals or guarantees. A model that does not beat the baseline should not be used to drive automatic schedule changes.

## Privacy and safeguards

Do not combine students' records without explicit, informed consent and a documented privacy policy. Prefer per-user models or a separately governed opt-in process. Keep raw records and weights scoped to the authenticated user, provide a way to clear them, and never infer study activity by scanning unrelated apps or device data.

## Integration status

The model is exported as an optional module. The deterministic analytics engine remains the trusted fallback. The Owj app still needs to construct correctly aligned weekly labels, persist each user's weights, and expose validation status. Synthetic unit tests verify implementation paths only; they do not demonstrate real-world predictive accuracy.
