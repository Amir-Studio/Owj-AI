# Quality gates and model limits

## Feedback integrity

A plan outcome is usable only when both `plannedMinutes` and `actualMinutes` are finite numeric values, the planned duration is greater than zero, and both values are within the supported 0–1440 minute daily range (planned duration: 1–1440). Missing or malformed measurements, or a missing boolean completion state, are rejected at the API boundary and ignored if encountered in legacy memory.

Global and subject-level adaptation use only valid outcomes. Subject-level adaptation additionally requires a non-empty subject name and at least three observations. Up to the latest eight valid observations per subject are used. Sparse evidence leaves the allocation factor unchanged.

## Continuous integration

GitHub Actions runs `npm test` and `npm run lint` on pushes and pull requests to `main`, across Node.js 18, 20, and 22. The lint script imports source modules to catch syntax and module-loading errors; the test suite exercises behavior.

## What a passing test suite does not prove

- Synthetic fixtures do not demonstrate improved learning outcomes.
- Neural forecasts remain experimental until evaluated on representative, consented student data.
- Heuristic calibration is not a causal model and does not guarantee better schedules.
- Forecast error ranges are empirical summaries, not statistical confidence intervals.
- Production readiness still requires end-to-end testing inside the Android app, migration testing on real stored memory, privacy review, and monitored pilot use.
