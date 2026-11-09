# Owj AI

**Owj AI** is the first-party, provider-independent intelligence engine for the Owj study planner.

The v0.10.0 hybrid decision engine is written in JavaScript and runs inside the Owj app. It validates study records, detects personal routines, diagnoses subject-level learning signals from repeated assessments and practice exposure, estimates weekly trends, ranks exam and subject priorities, proposes a workload-aware plan, and stores compact user-specific memory on the device, records explicit user feedback, adjusts future workload cautiously from validated plan outcomes, calibrates per-subject allocation from each subject's recent completion history, and corrects systematic weekly forecast bias from completed outcomes, audits incoming data quality, prioritizes subjects using recency-weighted assessment evidence with sparse-sample shrinkage, and scores forecasts only when the history-completeness watermark confirms the full period is available.

## Product principles

- No OpenAI, Gemini, external LLM, or hosted model API dependency.
- Analysis is triggered by meaningful app events or a user-requested review.
- The engine runs locally; internet can be used separately for optional Supabase synchronization.
- Memory is isolated per authenticated user and stored on the device by default.
- Recommendations expose their reasons and forecast confidence.
- Proposed plans never silently overwrite saved plans.
- The engine never scans other apps, messages, files, or arbitrary device activity.

## Intelligence pipeline

```text
Owj profile + sessions + plans + exams
                 |
          Data validation
                 |
      Behavioral analytics
                 |
       Pattern detection
                 |
     Weekly trend estimation
                 |
       Priority ranking
                 |
      Adaptive plan proposal
                 |
    Explainable recommendations
                 |
       On-device memory
```

## Quick start

Requires Node.js 18+.

```bash
npm install
npm test
npm run lint
```

The optional v0.7 neural module is a supervised feed-forward predictor (24 encoded inputs, 20 hidden units, 2 outputs) with Adam training, missing-value indicators, chronological validation, and baseline comparison. It remains experimental until trained and evaluated on representative, consented student data. It does not replace the explainable analytics engine.\n\nThe repository is source-first. For integration, add this repository as a workspace package or import its `src/` entry point into the Owj React/Vite project.

```js
import { createOwjAI, createBrowserMemoryStorage } from '@owj/ai';

const owjAI = createOwjAI({
  storage: createBrowserMemoryStorage(),
});

const result = await owjAI.analyze({
  userId: authenticatedUser.id,
  profile: { dailyAvailableMinutes: 240, subjects: ['Math', 'Physics'] },
  sessions: [],
  plans: [],
  exams: [],
});

console.log(result.recommendations);
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Neural model](docs/NEURAL-MODEL.md)
- [Data contract](docs/DATA-CONTRACT.md)
- [Owj integration](docs/INTEGRATION.md)
- [Privacy](docs/PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)

## Honest capability boundary

The core analytics engine is deterministic and explainable. The optional neural module can learn model weights from correctly labeled weekly outcomes, but the repository does not include a production-trained model or real student dataset. It is not a general-purpose conversational model. Its forecasts describe study activity, not guaranteed learning outcomes or exam scores. It currently focuses on study analytics, behavioral forecasting and planning, not arbitrary textbook question answering.

The user remains in control of every schedule change. Assessment estimates are intentionally conservative: a small or stale sample is pulled toward a neutral baseline instead of being treated as a reliable mastery verdict.
\n## Neural forecasting\n\nThe core API exposes `trainNeuralModel(userId, weeklyExamples)`, `predictNeuralModel(userId, features)` and `getNeuralMetrics(userId)`. Models are persisted separately per user in local memory and survive routine analysis calls. See [the neural model guide](docs/NEURAL-MODEL.md) for the strict leakage-safe weekly label contract.\n

## Subject diagnosis v0.8

Each configured subject receives an evidence-backed diagnosis with a transparent evidence summary and a suggested next action. The engine distinguishes insufficient evidence, low practice exposure, possible concept gaps despite practice, review risk, declining assessment performance, monitoring, and maintenance. It avoids definitive claims from a single assessment. This layer is deterministic and explainable; it does not replace the experimental neural forecaster.


## Hybrid decision engine v0.10.0

The analysis result now includes `hybridDecision`: an explainable, confidence-weighted synthesis of subject diagnoses, exam priorities, recency, consistency, data quality, trend signals, and (only when trained) the neural behavior forecast. It surfaces the leading focus, ranked subject actions, evidence strength, and disagreements between signals. Neural forecasts remain advisory. If the network fails to beat the training-only baseline on both held-out targets, inference falls back to the training mean and the hybrid layer ignores the neural signal. Forecasts cannot override the user's available time or deterministic planning, and they never change the saved plan automatically. Completed forecast history can correct persistent over- or under-estimation after at least three evaluated weeks; per-subject allocation calibration requires at least three outcomes for that subject.
