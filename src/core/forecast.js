const DAY = 86_400_000;
const round = value => Math.round(value);
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const weekStart = date => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
};

export function createWeeklyForecast(history = [], trend, now = new Date()) {
  if (!Array.isArray(history)) history = [];
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
  if (!Array.isArray(history)) history = [];
  if (!Array.isArray(sessions)) sessions = [];
  const coverage = historyCompleteThrough instanceof Date
    ? historyCompleteThrough
    : historyCompleteThrough == null ? null : new Date(historyCompleteThrough);
  return history.filter(forecast => forecast && typeof forecast === 'object').map(forecast => {
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
  if (!Array.isArray(history)) history = [];
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

/**
 * Corrects systematic weekly forecast bias using only forecasts whose target
 * periods are explicitly marked complete. Fewer than three outcomes never
 * alter the forecast.
 */
export function calibrateWeeklyForecast(trend, history = []) {
  if (!trend || !Number.isFinite(trend.estimatedNextWeekMinutes)) {
    return { trend, status: 'unavailable', evaluatedForecasts: 0, biasCorrectionMinutes: 0, meanAbsoluteErrorMinutes: null, rangeMinutes: null };
  }
  const evaluated = (Array.isArray(history) ? history : [])
    .filter(item => item && Number.isFinite(item.predictedMinutes) && Number.isFinite(item.actualMinutes)
      && item.actualMinutes >= 0 && item.predictedMinutes >= 0)
    .slice(-12);
  if (evaluated.length < 3) {
    return { trend, status: 'collecting', evaluatedForecasts: evaluated.length, biasCorrectionMinutes: 0, meanAbsoluteErrorMinutes: null, rangeMinutes: null };
  }
  const signedErrors = evaluated.map(item => item.predictedMinutes - item.actualMinutes).sort((a, b) => a - b);
  const absoluteErrors = evaluated.map(item => Math.abs(item.predictedMinutes - item.actualMinutes)).sort((a, b) => a - b);
  const medianOf = values => {
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };
  const bias = medianOf(signedErrors);
  const mae = Math.round(absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length);
  const correctedMinutes = Math.round(Math.max(0, trend.estimatedNextWeekMinutes - bias));
  const meanActual = evaluated.reduce((sum, item) => sum + item.actualMinutes, 0) / evaluated.length;
  const relativeError = mae / Math.max(60, meanActual);
  const confidenceFactor = Math.max(0.35, Math.min(1, 1 - relativeError));
  const calibratedTrend = {
    ...trend,
    rawEstimatedNextWeekMinutes: trend.estimatedNextWeekMinutes,
    estimatedNextWeekMinutes: correctedMinutes,
    confidence: Math.round((Number(trend.confidence) || 0) * confidenceFactor * 100) / 100,
    calibration: {
      status: 'calibrated',
      evaluatedForecasts: evaluated.length,
      biasCorrectionMinutes: Math.round(bias),
      meanAbsoluteErrorMinutes: mae,
      rangeMinutes: [Math.max(0, correctedMinutes - mae), correctedMinutes + mae],
      confidenceFactor: Math.round(confidenceFactor * 100) / 100
    }
  };
  return {
    trend: calibratedTrend,
    status: 'calibrated',
    evaluatedForecasts: evaluated.length,
    biasCorrectionMinutes: Math.round(bias),
    meanAbsoluteErrorMinutes: mae,
    rangeMinutes: calibratedTrend.calibration.rangeMinutes
  };
}
