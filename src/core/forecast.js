const DAY = 86_400_000;
const round = value => Math.round(value);
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const weekStart = date => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
};

export function createWeeklyForecast(history = [], trend, now = new Date()) {
  if (!trend || !Number.isFinite(trend.estimatedNextWeekMinutes) || trend.method === 'insufficient_history') return history;
  const currentWeek = weekStart(now).toISOString().slice(0, 10);
  if (history.some(item => item.issuedWeekKey === currentWeek)) return history;
  const targetStart = new Date(weekStart(now).getTime() + 7 * DAY);
  const targetEnd = new Date(targetStart.getTime() + 7 * DAY);
  return [...history, {
    id: 'forecast-' + currentWeek,
    issuedWeekKey: currentWeek,
    issuedAt: now.toISOString(),
    targetStartAt: targetStart.toISOString(),
    targetEndAt: targetEnd.toISOString(),
    predictedMinutes: round(Math.max(0, trend.estimatedNextWeekMinutes)),
    method: trend.method,
    confidenceAtIssue: trend.confidence,
    actualMinutes: null
  }];
}

export function settleWeeklyForecasts(history = [], sessions = [], now = new Date(), historyCompleteThrough = null) {
  const coverage = historyCompleteThrough instanceof Date
    ? historyCompleteThrough
    : historyCompleteThrough == null ? null : new Date(historyCompleteThrough);
  return history.map(forecast => {
    const start = new Date(forecast.targetStartAt);
    const end = new Date(forecast.targetEndAt);
    if (forecast.actualMinutes != null || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
      || end <= start || end > now || !coverage || Number.isNaN(coverage.getTime()) || coverage < end) return forecast;
    const actualMinutes = round(sessions.reduce((sum, session) => {
      const date = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt);
      return date >= start && date < end ? sum + Math.max(0, Number(session.actualMinutes) || 0) : sum;
    }, 0));
    const absoluteErrorMinutes = Math.abs(forecast.predictedMinutes - actualMinutes);
    return {
      ...forecast, actualMinutes, evaluatedAt: now.toISOString(),
      absoluteErrorMinutes,
      absolutePercentageError: actualMinutes > 0
        ? round(absoluteErrorMinutes / actualMinutes * 10000) / 100
        : null
    };
  });
}

export function summarizeForecastAccuracy(history = []) {
  const evaluated = history.filter(item => Number.isFinite(item.actualMinutes));
  const errors = evaluated.map(item => item.absoluteErrorMinutes);
  const percentageErrors = evaluated.filter(item => Number.isFinite(item.absolutePercentageError))
    .map(item => item.absolutePercentageError);
  return {
    status: evaluated.length >= 3 ? 'measured' : 'collecting',
    evaluatedForecasts: evaluated.length,
    meanAbsoluteErrorMinutes: average(errors) == null ? null : round(average(errors)),
    meanAbsolutePercentageError: average(percentageErrors) == null ? null : round(average(percentageErrors) * 100) / 100,
    note: evaluated.length >= 3
      ? 'خطای پیش‌بینی از نتیجه‌های واقعی محاسبه شده است؛ این معیار با داده‌های بیشتر قابل اتکاتر می‌شود.'
      : 'هنوز پیش‌بینی‌های کافی به پایان نرسیده‌اند تا دقت مدل سنجیده شود.'
  };
}
