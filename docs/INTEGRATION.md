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
