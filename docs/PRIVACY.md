# Privacy and device memory

- Owj AI reads only the object passed to `analyze()`.
- It does not inspect other apps, notifications, messages, contacts, browsing history, or arbitrary files.
- Memory is stored under a namespaced key per authenticated user.
- The memory contains aggregates, snapshots, explicit feedback events and forecast evaluation summaries, not the full raw session history.
- Browser localStorage is not encrypted. For production Capacitor builds, consider encrypted app storage if the sensitivity warrants it.
- The host app must clear user-specific UI state on sign-out and must never use one shared user ID for every account.
- Supabase sync is not implemented by this package. If added later, make it explicit, minimal, and protected by per-user RLS.
