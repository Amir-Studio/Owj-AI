# Owj AI

**Owj AI** is the first-party, provider-independent intelligence engine for the Owj study planner.

The v0.5 engine is written in JavaScript and runs inside the Owj app. It validates study records, detects personal routines, estimates weekly trends, ranks exam and subject priorities, proposes a workload-aware plan, and stores compact user-specific memory on the device, records explicit user feedback, adjusts future workload cautiously from repeated plan outcomes, audits incoming data quality, prioritizes subjects using recency-weighted assessment evidence with sparse-sample shrinkage, and scores forecasts only when the history-completeness watermark confirms the full period is available.

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

The repository is source-first. For integration, add this repository as a workspace package or import its `src/` entry point into the Owj React/Vite project.

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
- [Data contract](docs/DATA-CONTRACT.md)
- [Owj integration](docs/INTEGRATION.md)
- [Privacy](docs/PRIVACY.md)
- [Roadmap](docs/ROADMAP.md)

## Honest capability boundary

This is an adaptive rules-and-statistics engine, not a trained neural network or general-purpose conversational model. It learns user-specific patterns by updating structured memory; it does not change model weights. Its forecasts describe study activity, not guaranteed learning outcomes or exam scores. It currently focuses on study analytics and planning, not arbitrary textbook question answering.

The user remains in control of every schedule change. Assessment estimates are intentionally conservative: a small or stale sample is pulled toward a neutral baseline instead of being treated as a reliable mastery verdict.
