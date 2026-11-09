const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value);
const diagnosisWeight = Object.freeze({
  concept_gap: 92,
  declining_performance: 84,
  practice_gap: 76,
  forgetting_risk: 68,
  monitor: 46,
  insufficient_evidence: 32,
  maintain: 18
});
const qualityFactor = status => status === 'high' ? 1 : status === 'medium' ? 0.82 : status === 'low' ? 0.62 : 0.4;

/**
 * Synthesizes independent Owj signals into an explainable, conservative
 * decision. It ranks review actions; it never changes a user's saved plan.
 */
export function buildHybridDecision({
  subjects = [], priorities = [], patterns = {}, trend = {},
  neuralForecast = {}, dataQuality = {}, overview = {}, feedback = {}
} = {}) {
  if (!Array.isArray(subjects) || !Array.isArray(priorities)) {
    throw new TypeError('subjects and priorities must be arrays');
  }
  const priorityBySubject = new Map();
  for (const item of priorities) {
    if (!item?.subject) continue;
    priorityBySubject.set(item.subject, Math.max(priorityBySubject.get(item.subject) ?? 0, Number(item.score) || 0));
  }
  const actions = subjects.map(subject => {
    const diagnosis = subject.learningDiagnosis ?? { code: 'insufficient_evidence', confidence: 0, nextAction: 'ابتدا دادهٔ معتبر ثبت کن.' };
    const diagnosisScore = diagnosisWeight[diagnosis.code] ?? 32;
    const priorityScore = priorityBySubject.get(subject.subject) ?? 0;
    const daysSince = diagnosis.evidence?.daysSinceLastStudy ?? null;
    const recencyScore = daysSince == null ? 38 : clamp(daysSince * 4, 0, 76);
    const evidence = clamp(Number(diagnosis.confidence) || 0, 0, 0.85);
    const diagnosisContribution = diagnosisScore * (0.45 + evidence * 0.55);
    const rawScore = diagnosisContribution * 0.52 + priorityScore * 0.38 + recencyScore * 0.10;
    const score = round(rawScore * (0.72 + qualityFactor(dataQuality.status) * 0.28));
    const reasons = [];
    if (diagnosis.code !== 'insufficient_evidence') reasons.push(diagnosis.explanation);
    if (priorityScore > 0) reasons.push('این درس در اولویت‌های آزمون و برنامه نیز امتیاز گرفته است.');
    if (daysSince != null && daysSince >= 7) reasons.push('از آخرین مطالعه فاصله افتاده است.');
    return {
      subject: subject.subject,
      score,
      priority: score >= 78 ? 'critical' : score >= 62 ? 'high' : score >= 42 ? 'medium' : 'low',
      diagnosisCode: diagnosis.code,
      diagnosisConfidence: evidence,
      prioritySignal: round(priorityScore),
      nextAction: diagnosis.nextAction,
      reasons,
      evidence: diagnosis.evidence ?? {}
    };
  }).sort((a, b) => b.score - a.score || a.subject.localeCompare(b.subject));

  const neuralAvailable = neuralForecast?.status === 'experimental_estimate'
    && Number.isFinite(neuralForecast.nextWeekMinutes);
  const quality = qualityFactor(dataQuality.status);
  const subjectEvidence = actions.length
    ? actions.reduce((sum, item) => sum + item.diagnosisConfidence, 0) / actions.length
    : 0;
  const historyEvidence = clamp((Number(overview.totalSessions) || 0) / 20, 0, 1);
  const feedbackCount = Number(feedback.recommendationCount) || 0;
  const feedbackAcceptance = feedback.acceptanceRatePercent;
  const confidence = Number((clamp(
    0.12 + quality * 0.30 + subjectEvidence * 0.28 + historyEvidence * 0.20
      + (neuralAvailable ? 0.10 : 0), 0.08, 0.88
  )).toFixed(2));
  const disagreements = [];
  if (trend.direction === 'decreasing' && neuralAvailable
      && neuralForecast.nextWeekMinutes > (Number(overview.totalMinutes7d) || 0) * 1.15) {
    disagreements.push({
      code: 'TREND_NEURAL_DISAGREEMENT',
      message: 'روند آماری اخیر کاهشی است، اما مدل عصبی افزایش فعالیت را تخمین می‌زند؛ فعلاً هیچ‌کدام را قطعی تلقی نکن.'
    });
  }
  if (patterns.signals?.some(signal => signal.code === 'LOW_COMPLETION')
      && neuralAvailable && neuralForecast.nextWeekCompletionRate >= 85) {
    disagreements.push({
      code: 'COMPLETION_SIGNAL_DISAGREEMENT',
      message: 'نرخ تکمیل فعلی پایین است، در حالی که مدل تکمیل بالاتری پیش‌بینی می‌کند؛ برنامه را فقط بر اساس پیش‌بینی خوش‌بینانه سنگین نکن.'
    });
  }
  const lead = actions[0] ?? null;
  const evidenceGrade = confidence >= 0.68 ? 'stronger' : confidence >= 0.42 ? 'moderate' : 'limited';
  return {
    version: '0.9.5',
    status: lead ? 'decision_available' : 'insufficient_subject_data',
    primaryFocus: lead ? {
      subject: lead.subject, score: lead.score, priority: lead.priority,
      diagnosisCode: lead.diagnosisCode, nextAction: lead.nextAction
    } : null,
    rankedSubjectActions: actions.slice(0, 6),
    behavioralOutlook: {
      trendDirection: trend.direction ?? 'insufficient_data',
      neuralForecast: neuralAvailable ? {
        status: neuralForecast.status,
        nextWeekMinutes: neuralForecast.nextWeekMinutes,
        nextWeekMinutesRange: neuralForecast.nextWeekMinutesRange,
        nextWeekCompletionRate: neuralForecast.nextWeekCompletionRate,
        reliability: neuralForecast.reliability
      } : { status: neuralForecast.status ?? 'unavailable', reliability: 'unavailable' }
    },
    evidence: {
      confidence, grade: evidenceGrade, dataQuality: dataQuality.status ?? 'unknown',
      subjectCount: subjects.length, totalSessions: Number(overview.totalSessions) || 0,
      feedbackCount,
      feedbackAcceptanceRatePercent: Number.isFinite(feedbackAcceptance) ? feedbackAcceptance : null
    },
    disagreements,
    guardrails: [
      'پیشنهادها بر اساس شواهد ثبت‌شده‌اند، نه قضاوت درباره توانایی ثابت دانش‌آموز.',
      'پیش‌بینی عصبی فقط یک سیگنال کمکی است و در نبود اعتبارسنجی مناسب کنار گذاشته می‌شود.',
      'هیچ برنامه‌ای بدون تأیید کاربر تغییر نمی‌کند.'
    ],
    feedbackCalibration: feedbackCount >= 5 && Number.isFinite(feedbackAcceptance)
      ? feedbackAcceptance < 35 ? 'low_acceptance_review_recommendation_relevance'
        : feedbackAcceptance > 80 ? 'high_acceptance_keep_monitoring' : 'mixed_acceptance'
      : 'insufficient_feedback'
  };
}
