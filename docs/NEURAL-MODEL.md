# Owj Study Intelligence v0.8

The deterministic diagnosis layer is separate from the experimental neural forecaster. It classifies observable subject-level signals as insufficient evidence, practice gap, possible concept gap, review risk, declining performance, monitor, or maintain. It requires repeated dated assessments before making performance claims, uses recent logged practice as context, and returns its evidence and next action. A review-risk label is not proof that knowledge has been forgotten. These labels are decision support, not a measure of intelligence or fixed ability.

# Owj Study Neural Model v3

Owj's optional neural component is a local, provider-independent feed-forward network for forecasting study behavior. It is not a general-purpose tutor and does not predict exam grades.

## Architecture

- 12 study signals: study minutes in current/previous 7 days, active days, sessions, prior-week completion rate, planned-versus-actual percentage, assessment performance, days until exam, consistency score, average session length, subjects studied and missed sessions.
- Missingness mask: each feature has a companion indicator so a genuine zero is distinguishable from unavailable data.
- Network: 24 encoded inputs (12 values + 12 missing indicators) → 20 tanh hidden units → 2 sigmoid outputs.
- Optimizer: mini-batch Adam with gradient clipping, learning-rate decay, shuffled training batches and early stopping.
- Outputs: next-week study minutes and next-week plan-completion percentage.
- Runtime: JavaScript, no cloud inference or third-party ML dependency.

## Leakage-safe weekly data contract

Each record describes one completed week. Features are measured at the end of that week; labels are measured in the following week:

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

**Important:** `features.completionRate` is the completed input week's rate. `nextWeekCompletionRate` is the following week's outcome. The old ambiguous label format is rejected so the same week's completion rate cannot accidentally become both input and target.

At least 8 of the 12 numeric features are required for a sample; missing values are explicitly masked. Samples are sorted by week, duplicate weeks are collapsed, and the latest 20% are held out for temporal validation. At least 30 valid weekly examples are required. Do not randomly split future and past weeks.

## API

```js
const training = await owjAI.trainNeuralModel(userId, completedWeeklyExamples);
const estimate = await owjAI.predictNeuralModel(userId, currentWeekFeatures);
const metrics = await owjAI.getNeuralMetrics(userId);
```

Weights are stored inside that user's local memory envelope, preserved by ordinary analysis, and removed by clearing that user's memory. Schema v1/v2 weights are rejected and must be retrained with the v3 label contract. Train only after a complete future-week outcome is known; do not train on partial weeks or repeatedly on the same unfinished label.

## Evaluation and limitations

The holdout reports mean absolute error for both outputs and compares them against a simple training-mean baseline. Reliability is described as limited, developing or promising-not-proven; the model does not fabricate a probability confidence score. Prediction ranges are based on holdout MAE and are descriptive, not formal statistical confidence intervals.

The repository contains implementation and synthetic tests, not a production-trained model or real student dataset. Synthetic tests verify implementation paths, not real predictive quality. Before production use, evaluate on consented, representative student data across several exam periods and compare against simple baselines. The deterministic Owj engine remains the fallback when the neural model is untrained or weak.

Prefer per-user local models. Do not pool student records without explicit informed consent, data minimization, access controls and a documented retention/deletion policy. Students should be able to inspect and clear their learning data.


## Hybrid decision layer v0.9

`buildHybridDecision` combines deterministic subject diagnoses, exam/subject priorities, recency, behavioral consistency, data quality, weekly trend and optional neural forecasts. Subject scores are confidence-damped so sparse or stale evidence cannot dominate. The result exposes ranked actions, the lead focus, an overall evidence grade, and signal disagreements. Neural output is used only when the model has valid training and holdout metrics; otherwise the hybrid layer reports it as unavailable and continues with deterministic evidence. This layer is decision support, not an autonomous tutor or a guarantee of academic outcomes.
