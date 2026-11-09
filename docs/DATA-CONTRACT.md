# Data contract

Pass only records collected by Owj or explicitly authorized by the user. Missing arrays default to empty arrays.

```js
{
  userId: 'stable-auth-user-id',
  now: '2026-11-09T12:00:00.000Z', // optional
  historyCompleteThrough: '2026-11-24T00:00:00.000Z', // optional; required before a forecast period can be scored
  profile: { dailyAvailableMinutes: 240, subjects: ['Math', 'Physics'] },
  sessions: [{ id: 's1', subject: 'Math', actualMinutes: 50, startedAt: '2026-11-08T10:00:00Z', completed: true }],
  assessments: [{ id: 'a1', subject: 'Math', score: 7, maxScore: 10, date: '2026-11-08T12:00:00Z', type: 'quiz' }],
  plans: [{ id: 'p1', subject: 'Math', plannedMinutes: 60, actualMinutes: 50, status: 'completed' }],
  exams: [{ id: 'e1', subject: 'Math', date: '2026-11-20', targetMinutes: 600 }]
}
```

Session duration aliases: `durationMinutes` or `minutes`. Date aliases: `date` or `completedAt`. Use consistent subject names and timezone-aware ISO timestamps. A stable authenticated user ID is mandatory for memory isolation.

`historyCompleteThrough` is a completeness watermark, not the current time. Set it only when Owj knows that all study sessions through that timestamp have been synchronized or locally loaded. Forecast errors are not calculated for a target week until the watermark reaches the end of that week; this avoids treating a partial history as the user's true total.

Assessment records accept either `scorePercent` (0–100) or `score` plus `maxScore`, together with a subject and date. Recent results receive more weight than older ones. Stable duplicate assessment IDs are deduplicated, and invalid scores outside 0–100 (or score/maxScore outside its valid range) are ignored. Owj exposes both the observed weighted average and a conservative estimate that shrinks sparse or stale evidence toward a neutral baseline; the confidence field reflects evidence volume and freshness. These are planning signals, not definitive measures of mastery; use consistent test types and comparable scoring when possible.
