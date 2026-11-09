const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const isValidPlanOutcome = item => item?.kind === 'plan_outcome'
  && Number.isFinite(item.plannedMinutes) && item.plannedMinutes > 0
  && Number.isFinite(item.actualMinutes) && item.actualMinutes >= 0;
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function summarizeFeedback(entries = []) {
  const events = Array.isArray(entries) ? entries : [];
  const recommendations = events.filter(item => item?.kind === 'recommendation' && typeof item.accepted === 'boolean');
  const rated = recommendations.filter(item => Number.isFinite(item.usefulness));
  const outcomes = events.filter(isValidPlanOutcome);
  const ratios = outcomes.map(item => clamp(item.actualMinutes / item.plannedMinutes, 0, 2));
  return {
    totalEvents: events.length,
    recommendationCount: recommendations.length,
    acceptedRecommendations: recommendations.filter(item => item.accepted).length,
    acceptanceRatePercent: recommendations.length
      ? Math.round(recommendations.filter(item => item.accepted).length / recommendations.length * 100)
      : null,
    ratedRecommendations: rated.length,
    averageUsefulness: rated.length ? Math.round(average(rated.map(item => clamp(item.usefulness, 1, 5))) * 100) / 100 : null,
    planOutcomeCount: outcomes.length,
    planCompletionRatePercent: outcomes.length
      ? Math.round(outcomes.filter(item => item.completed).length / outcomes.length * 100)
      : null,
    medianActualToPlannedRatio: median(ratios),
    reliability: events.length >= 20 ? 'high' : events.length >= 8 ? 'medium' : 'low'
  };
}

export function getPlanFitAdjustment(entries = []) {
  const outcomes = (Array.isArray(entries) ? entries : [])
    .filter(isValidPlanOutcome)
    .slice(-8);
  if (outcomes.length < 3) {
    return { factor: 1, sampleSize: outcomes.length, status: 'insufficient_feedback', reason: 'برای تنظیم ظرفیت بر اساس نتیجهٔ برنامه، حداقل سه نتیجهٔ ثبت‌شده لازم است.' };
  }
  const ratios = outcomes.map(item => clamp(item.actualMinutes / item.plannedMinutes, 0, 2));
  const typicalRatio = median(ratios);
  const completionRate = outcomes.filter(item => item.completed).length / outcomes.length;
  let factor = 1;
  if (typicalRatio < 0.65 || completionRate < 0.4) factor = 0.85;
  else if (typicalRatio < 0.8 || completionRate < 0.6) factor = 0.92;
  else if (typicalRatio > 1.25 && completionRate >= 0.8) factor = 1.05;
  return {
    factor, sampleSize: outcomes.length, status: 'feedback_adjusted',
    typicalActualToPlannedRatio: Math.round(typicalRatio * 100) / 100,
    completionRatePercent: Math.round(completionRate * 100),
    reason: factor < 1
      ? 'ظرفیت پیشنهادی کمی کاهش یافته؛ چند برنامهٔ اخیر کمتر از مقدار تعیین‌شده اجرا شده‌اند.'
      : factor > 1
        ? 'با توجه به اجرای پایدار برنامه‌های اخیر، ظرفیت فقط اندکی افزایش یافته است.'
        : 'نتایج اخیر با ظرفیت فعلی سازگارند؛ تغییری در ظرفیت اعمال نشده است.'
  };
}

/**
 * Learns conservative, subject-specific plan sizing from completed outcomes.
 * A subject needs at least three observations; sparse feedback never changes
 * allocation. Factors affect relative proposal weights, not saved plans.
 */
export function getSubjectPlanFitAdjustments(entries = []) {
  const outcomes = (Array.isArray(entries) ? entries : [])
    .filter(item => isValidPlanOutcome(item) && typeof item.subject === 'string' && item.subject.trim())
    .slice(-100);
  const bySubject = new Map();
  for (const item of outcomes) {
    const subject = item.subject.trim();
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject).push(item);
  }
  return Object.fromEntries([...bySubject].map(([subject, records]) => {
    const recent = records.slice(-8);
    if (recent.length < 3) return [subject, {
      factor: 1, sampleSize: recent.length, status: 'insufficient_feedback'
    }];
    const ratios = recent.map(item => clamp(item.actualMinutes / item.plannedMinutes, 0, 2));
    const typicalRatio = median(ratios);
    const completionRate = recent.filter(item => item.completed === true).length / recent.length;
    const factor = typicalRatio < 0.65 || completionRate < 0.4 ? 0.85
      : typicalRatio < 0.8 || completionRate < 0.6 ? 0.92
        : typicalRatio > 1.25 && completionRate >= 0.8 ? 1.03 : 1;
    return [subject, {
      factor, sampleSize: recent.length, status: 'subject_feedback_adjusted',
      typicalActualToPlannedRatio: Math.round(typicalRatio * 100) / 100,
      completionRatePercent: Math.round(completionRate * 100)
    }];
  }));
}
