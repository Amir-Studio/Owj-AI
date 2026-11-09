# Architecture

Owj AI v0.3 is a deterministic, provider-independent JavaScript intelligence engine that runs inside Owj. It does not call a hosted LLM. The app explicitly passes profile, session, plan and exam records; the engine validates and normalizes them before analysis.

## Analysis pipeline

1. Normalize dates, durations, statuses and subject names; exclude future sessions, safely ignore malformed records, and deduplicate sync retries by stable session ID.
2. Aggregate total, recent-week and previous-week study activity, completion, and planned-versus-actual time.
3. Include profile subjects with no recorded sessions so missing data is visible rather than silently omitted.
4. Detect study-hour and weekday patterns, active-day consistency, subject concentration and repeated abandoned plans.
5. Estimate trends using distinct weekly memory snapshots when enough history exists; otherwise use a clearly marked low-confidence week-over-week comparison or return insufficient history.
6. Rank exams using urgency and a transparent preparation estimate; rank subjects using missing activity, recency and distribution.
7. Allocate a proposed daily workload by priority and completion history. The sum of proposed blocks is bounded by the recommended capacity.
8. Store compact weekly snapshots, subject aggregates and selected insights in per-user memory.

## Reliability

The engine distinguishes data volume from certainty. Forecasts expose their method and confidence, and recommendations include reasons. Study minutes are behavioral signals, not direct measures of learning or mastery; Owj should not present them as exam-score predictions.

## Triggering and connectivity

Run analysis after meaningful events (session completion, plan/exam changes, or a user-requested review), not on every render. The engine itself works locally and does not require internet. If product behavior requires analysis to be triggered only while connected, the Owj app should gate the call at its event/sync layer; it should not send private study records to a server merely to calculate local statistics. Supabase can be used separately for explicitly enabled sync.

## Memory and privacy

Memory is keyed by authenticated user ID and stores aggregate snapshots, subject summaries and selected patterns—not full raw session history. The browser adapter accepts both the legacy v1 and current v2 memory envelope so an engine upgrade does not silently erase existing user history. Browser localStorage is the starter adapter; Capacitor Preferences or encrypted storage can replace it. Clear memory on sign-out when the product's account-isolation policy requires it.

## Limits

This is an adaptive rules-and-statistics engine, not a trained neural network or general-purpose conversational model. It learns user-specific patterns by updating structured memory; it does not change model weights. More history improves pattern estimates but does not make study time equivalent to mastery. The engine currently focuses on study analytics and planning, not unrestricted textbook question answering.


## Feedback and calibration (v0.3)
The app may explicitly record recommendation acceptance/usefulness and completed or abandoned plan outcomes through `recordFeedback`. The engine stores a bounded history (last 100 events) in the user's local memory and exposes aggregate feedback metrics. After at least three plan outcomes, repeated under-completion can reduce the next proposed capacity modestly; repeated reliable completion can increase it by at most five percent. Sparse feedback never changes capacity. This is a conservative heuristic, not a statistically calibrated model.

Example:
```js
await owjAI.recordFeedback({
  userId: authUser.id,
  kind: 'plan_outcome',
  plannedMinutes: 90,
  actualMinutes: 65,
  completed: false,
  subject: 'Math'
});
```

The app should record outcomes only from explicit Owj plan/session events. Do not infer them by scanning other apps or device activity. Feedback remains per-user and local by default; the user should be able to review and clear it with the existing memory controls.
