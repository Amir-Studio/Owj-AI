# Owj app integration

1. Copy `src/` into the Owj React/Vite project (for example `src/ai/`) or add this repository as a local workspace package.
2. Create one engine instance:

```js
import { createOwjAI, createBrowserMemoryStorage } from './ai/index.js';
export const owjAI = createOwjAI({ storage: createBrowserMemoryStorage() });
```

3. After a completed study session or a meaningful plan/exam change:

```js
const result = await owjAI.analyze({
  userId: authUser.id,
  profile,
  sessions,
  plans,
  exams,
});
setInsights(result);
```

Use the authenticated user's stable ID. Never use one shared ID for all users. For Capacitor, provide an async adapter with `getItem`, `setItem`, and `removeItem` backed by Capacitor Preferences or encrypted storage.

The engine runs locally; online Supabase sync is a separate optional layer. Do not upload local memory by default. If cross-device sync is later enabled, require clear consent and per-user RLS. Never put Supabase service-role keys in frontend code.


## Optional neural forecasting API (v0.7)
The core engine exposes an isolated per-user neural model lifecycle:

```js
const training = await owjAI.trainNeuralModel(userId, completedWeeklyExamples);
const estimate = await owjAI.predictNeuralModel(userId, currentWeekFeatures);
const metrics = await owjAI.getNeuralMetrics(userId);
```

Call training only after a full next-week outcome has been observed. Do not build labels from partial weeks or put next-week outcomes into current-week features. Keep examples for one authenticated user only. The engine persists model weights in that user's local memory, preserves them during subsequent analysis, and deletes them when that user's memory is cleared. Until the model has at least 30 valid weekly examples and a temporal validation set, prediction returns an insufficient-training status. Keep the deterministic engine's recommendations as the fallback; do not block planning on neural availability.
