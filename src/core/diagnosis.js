const DAY = 86_400_000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dateOf = value => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const scoreOf = item => {
  const direct = Number(item?.scorePercent);
  if (item?.scorePercent != null && Number.isFinite(direct) && direct >= 0 && direct <= 100) return direct;
  const score = Number(item?.score);
  const max = Number(item?.maxScore);
  return Number.isFinite(score) && Number.isFinite(max) && max > 0 && score >= 0 && score <= max
    ? score / max * 100 : null;
};

/**
 * Evidence-based subject diagnosis. This is deliberately conservative:
 * it describes observable learning signals, not a definitive diagnosis of ability.
 */
export function diagnoseSubjectLearning({ subject, sessions = [], assessments = [], now = new Date() } = {}) {
  if (typeof subject !== 'string' || !subject.trim()) throw new TypeError('subject is required');
  if (!Array.isArray(sessions) || !Array.isArray(assessments)) throw new TypeError('sessions and assessments must be arrays');
  const current = dateOf(now);
  if (!current) throw new TypeError('now must be a valid date');
  const subjectSessions = sessions.filter(item => item && String(item.subject ?? '').trim() === subject.trim())
    .map(item => ({ date: dateOf(item.startedAt ?? item.date ?? item.completedAt), minutes: Number(item.actualMinutes ?? item.durationMinutes ?? item.minutes) }))
    .filter(item => item.date && item.date <= current && Number.isFinite(item.minutes) && item.minutes > 0);
  const recentSessions = subjectSessions.filter(item => current - item.date <= 14 * DAY);
  const recentMinutes14d = Math.round(recentSessions.reduce((sum, item) => sum + item.minutes, 0));
  const lastStudiedAt = subjectSessions.reduce((latest, item) => !latest || item.date > latest ? item.date : latest, null);
  const scores = assessments.filter(item => item && String(item.subject ?? '').trim() === subject.trim())
    .map(item => ({ date: dateOf(item.date ?? item.takenAt ?? item.createdAt), score: scoreOf(item) }))
    .filter(item => item.date && item.date <= current && item.score != null)
    .sort((a, b) => a.date - b.date);
  const recentScores = scores.slice(-3);
  const priorScores = scores.slice(-6, -3);
  const averageRecent = recentScores.length
    ? recentScores.reduce((sum, item) => sum + item.score, 0) / recentScores.length : null;
  const averagePrior = priorScores.length
    ? priorScores.reduce((sum, item) => sum + item.score, 0) / priorScores.length : null;
  const trend = averageRecent == null || averagePrior == null ? 'unknown'
    : averageRecent - averagePrior >= 8 ? 'improving'
      : averagePrior - averageRecent >= 8 ? 'declining' : 'stable';
  const daysSinceStudy = lastStudiedAt ? Math.floor((current - lastStudiedAt) / DAY) : null;
  const confidence = Number(clamp((scores.length / (scores.length + 2)) * (recentScores.length ? 1 : 0.25), 0, 0.85).toFixed(2));

  let code = 'insufficient_evidence';
  let explanation = 'برای تشخیص قابل اتکا، حداقل دو ارزیابی تاریخ‌دار از این درس لازم است.';
  let nextAction = 'یک آزمونک هم‌سطح و کوتاه ثبت کن؛ فعلاً درباره تسلط قضاوت نمی‌کنیم.';
  if (scores.length >= 2 && averageRecent < 55 && recentMinutes14d >= 180) {
    code = 'concept_gap';
    explanation = 'با وجود تمرین ثبت‌شده، میانگین ارزیابی‌های اخیر پایین است؛ احتمال ضعف مفهومی یا روش حل وجود دارد.';
    nextAction = 'یک مبحث مشخص را با چند سؤال تشخیصی بررسی کن و خطاها را به مفهومی، محاسباتی و بی‌دقتی تفکیک کن.';
  } else if (scores.length >= 2 && averageRecent < 75 && recentMinutes14d < 180) {
    code = 'practice_gap';
    explanation = 'عملکرد هنوز تثبیت نشده و شواهد تمرین اخیر این درس کم است؛ داده فعلی برای نسبت‌دادن مشکل به مفهوم کافی نیست.';
    nextAction = 'یک نوبت تمرین هدفمند و سپس ارزیابی هم‌سطح انجام بده.';
  } else if (daysSinceStudy != null && daysSinceStudy >= 10 && averageRecent != null && averageRecent >= 65) {
    code = 'forgetting_risk';
    explanation = 'از آخرین مطالعه فاصله افتاده؛ خطر افت یادآوری وجود دارد، اما هنوز افت واقعی اثبات نشده است.';
    nextAction = 'مرور بازیابی‌محور کوتاه انجام بده و با چند سؤال بدون نگاه‌کردن به جزوه بسنج.';
  } else if (scores.length >= 2 && averageRecent >= 80 && recentMinutes14d >= 90) {
    code = 'maintain';
    explanation = 'ارزیابی‌های اخیر خوب‌اند و تمرین هم ثبت شده؛ هدف فعلاً حفظ تسلط است.';
    nextAction = 'مرور فاصله‌دار و آزمون ترکیبی را ادامه بده.';
  } else if (scores.length >= 2 && trend === 'declining') {
    code = 'declining_performance';
    explanation = 'میانگین ارزیابی‌های اخیر نسبت به ارزیابی‌های قبلی افت کرده است؛ علت هنوز مشخص نیست.';
    nextAction = 'سؤال‌های غلط اخیر را دسته‌بندی کن و یک ارزیابی هم‌سطح دیگر بگیر.';
  } else if (scores.length >= 2) {
    code = 'monitor';
    explanation = 'شواهد برای تشخیص ضعف مشخص کافی نیست؛ روند و میزان تمرین باید بیشتر مشاهده شود.';
    nextAction = 'با یک ارزیابی هم‌سطح دیگر و ثبت تمرین، تشخیص را دقیق‌تر کن.';
  }

  return {
    subject: subject.trim(), code, explanation, nextAction,
    evidence: {
      assessmentCount: scores.length,
      recentAssessmentAverage: averageRecent == null ? null : Math.round(averageRecent * 10) / 10,
      previousAssessmentAverage: averagePrior == null ? null : Math.round(averagePrior * 10) / 10,
      assessmentTrend: trend,
      recentStudyMinutes14d: recentMinutes14d,
      daysSinceLastStudy: daysSinceStudy
    },
    confidence
  };
}
