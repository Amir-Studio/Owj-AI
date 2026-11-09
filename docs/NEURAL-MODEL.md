# Owj Study Neural Model v2

Owj's optional neural component is a local, provider-independent feed-forward network. It is a forecasting component for study behavior, not a general-purpose tutor and not a predictor of exam grades.

## Architecture

- 12 validated inputs: study minutes in current/previous 7 days, active days, sessions, previous-period completion rate, planned-versus-actual percentage, recent assessment performance, days until exam, consistency score, average session length, subjects studied and missed sessions.
- Network: 12 inputs → 16 tanh hidden units → 2 sigmoid outputs.
- Outputs: next-week study minutes and next-week plan-completion percentage.
- Training: supervised mini-batch backpropagation, deterministic initialization, bounded gradients, chronological 80/20 train/validation split, early stopping and deduplication by week.
- Runtime: JavaScript, no cloud inference, external model API or third-party ML dependency.

## Critical data contract

Every sample must be a completed historical week, with features measured at the end of that week and labels measured in the following week. Required shape:

```js
{
  weekStart: '2025-01-06',
  features: {
    studyMinutes7d: 1200,
    studyMinutesPrevious7d: 1050,
    activeDays7d: 5,
    sessions7d: 18,
    completionRate: 78,
    plannedVsActualPercent: 82,
    assessmentPerformance: 64,
    daysUntilNextExam: 12,
    consistencyScore: 75,
    averageSessionMinutes: 42,
    subjectsStudied7d: 4,
    missedSessions7d: 2
  },
  nextWeekMinutes: 1320,
  nextWeekCompletionRate: 80
}
```

The future labels must never appear in the feature object. In particular, `features.completionRate` is the completed input week's rate, while `nextWeekCompletionRate` is the next week's outcome. This distinction prevents direct target leakage.

Samples are sorted by week and duplicate weeks are collapsed. The latest 20% is held out for temporal validation; do not randomly mix future weeks into training. At least 30 valid weekly examples are required, and 50+ is a more useful initial target. All 12 input fields must be numeric and valid. Missing values are not silently converted to zero.

## API

```js
import { createStudyNeuralModel } from '@owj/ai';

const neural = createStudyNeuralModel(savedWeights);
const training = neural.train(labeledWeeklyExamples);
const estimate = neural.predict(currentFeatureSnapshot);
const weightsToPersist = neural.exportModel();
const metrics = neural.getMetrics();
```

Persist weights only in the authenticated user's own local memory namespace. Reuse saved weights on later launches. Retrain only after a new completed weekly label exists, not on every render. Schema v1 weights are intentionally rejected; they must be retrained using the corrected v2 target contract.

## Reliability and limits

The model reports holdout MAE for both outputs and compares them with a simple training-mean baseline. It never fabricates a probability-style confidence score. A result is marked `promising_not_proven` only when the holdout has at least 10 examples, both errors beat the baseline, and errors are below conservative thresholds. Even then, the label is not proof of generalization.

The repository contains implementation and synthetic tests, not a production-trained model or real student dataset. Synthetic tests verify code paths, not real-world predictive quality. Do not present forecasts as grades, mastery, or guaranteed outcomes. Before production use, evaluate on consented, representative student data across multiple exam periods and compare against simple baselines.

Prefer per-user local models. Do not pool student records without explicit informed consent, data minimization, access controls and a documented retention/deletion policy. Students should be able to inspect and clear their learning data.
