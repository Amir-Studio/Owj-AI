# Data contract

Pass only records collected by Owj or explicitly authorized by the user. Missing arrays default to empty arrays.

```js
{
  userId: 'stable-auth-user-id',
  now: '2026-11-09T12:00:00.000Z', // optional
  profile: { dailyAvailableMinutes: 240, subjects: ['Math', 'Physics'] },
  sessions: [{ id: 's1', subject: 'Math', actualMinutes: 50, startedAt: '2026-11-08T10:00:00Z', completed: true }],
  plans: [{ id: 'p1', subject: 'Math', plannedMinutes: 60, actualMinutes: 50, status: 'completed' }],
  exams: [{ id: 'e1', subject: 'Math', date: '2026-11-20', targetMinutes: 600 }]
}
```

Session duration aliases: `durationMinutes` or `minutes`. Date aliases: `date` or `completedAt`. Use consistent subject names and timezone-aware ISO timestamps. A stable authenticated user ID is mandatory for memory isolation.
