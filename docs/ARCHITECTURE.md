# Architecture

Owj AI v0.1 is a deterministic JavaScript engine executed by the Owj app. It does not call a hosted LLM. The app passes Owj-owned profile, session, plan and exam records. The engine validates, aggregates, detects patterns, estimates trends, ranks priorities, proposes a plan, creates explainable recommendations, and stores compact summaries in per-user device memory.

## Flow

1. Validate explicit Owj data.
2. Aggregate total and weekly study time by subject.
3. Detect preferred study hours, consistency, completion and subject imbalance.
4. Compare current and previous periods and stored snapshots.
5. Rank upcoming exams and low-coverage subjects.
6. Propose a workload-aware plan; never silently overwrite user plans.
7. Persist summaries and selected insights locally.

Run analysis after meaningful events (session completion, plan/exam changes, or user-requested review), not every render or network status change. Internet can be used for optional Supabase sync; analysis itself runs locally.

## Memory

Memory is keyed by authenticated user ID and stores aggregate snapshots, subject summaries and selected patterns—not full raw session history. Browser localStorage is the starter adapter; Capacitor Preferences or encrypted storage can replace it.

## Limits

This is an adaptive rules-and-statistics engine, not a trained neural network or general-purpose conversational model. It learns user-specific patterns by updating structured memory; it does not change model weights. Confidence depends on data volume and quality.
