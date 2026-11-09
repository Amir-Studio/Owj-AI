# Owj AI

**Owj AI** is the first-party, provider-independent intelligence engine for the Owj study planner.

The v0.1 engine is written in JavaScript and runs inside the Owj app. It analyzes only data explicitly passed by Owj, detects study patterns, estimates trends, ranks priorities, proposes adaptive plans, and saves compact user-specific memory on the device.

## Product principles

- No OpenAI, Gemini, external LLM, or hosted model API dependency.
- Analysis is triggered by meaningful app events or a user-requested review.
- The engine runs locally; internet can be used separately for optional Supabase synchronization.
- Memory is isolated per authenticated user and stored on the device by default.
- Recommendations include reasons. Proposed plans never silently overwrite saved plans.
- The engine never scans other apps, messages, files, or arbitrary device activity.

## Architecture

```text
Owj React / Capacitor app
       | profile, sessions, plans, exams
       v
     OwjAI
       +-- DataAnalyzer
       +-- PatternDetector
       +-- PredictionEngine
       +-- PriorityEngine
       +-- AdaptivePlanner
       +-- RecommendationEngine
       |
       v
  MemoryManager <--> on-device storage
       |
       v
  insights + evidence + proposed adjustments
```

## Quick start

Requires Node.js 18+.

```bash
npm install
npm test
npm run lint
```

The repository is source-first. For the first integration, copy `src/` into the Owj React/Vite project or add this repository as a workspace package.

```js
import { createOwjAI, createBrowserMemoryStorage } from './ai/index.js';

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

This is an adaptive rules-and-statistics engine, not a trained neural network or a general-purpose conversational model. It learns user-specific patterns by updating structured memory; it does not change model weights. Its confidence depends on data volume and quality. It currently focuses on study analytics and planning, not arbitrary textbook question answering or unrestricted chat.

The user remains in control of every schedule change.
