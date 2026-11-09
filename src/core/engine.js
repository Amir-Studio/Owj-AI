import { summarizeFeedback, getPlanFitAdjustment } from './feedback.js';
import { createWeeklyForecast, settleWeeklyForecasts, summarizeForecastAccuracy } from './forecast.js';
import { createStudyNeuralModel } from '../neural/study-model.js';
import { diagnoseSubjectLearning } from './diagnosis.js';
import { buildHybridDecision } from './decision.js';

const DAY = 86_400_000;
const ENGINE_VERSION = '0.9.1';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const round = n => Math.round(n);
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const toDate = value => {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const dayKey = value => value.toISOString().slice(0, 10);
const weekKey = value => {
  const d = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `owj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

function normalizeInput(raw, now) {
  const sessions = raw.sessions.filter(item => item && typeof item === 'object').map((item, index) => {
    const startedAt = toDate(item.startedAt ?? item.date ?? item.completedAt ?? item.createdAt);
    const actualMinutes = clamp(finite(item.actualMinutes ?? item.durationMinutes ?? item.minutes), 0, 24 * 60);
    const plannedMinutes = clamp(finite(item.plannedMinutes), 0, 24 * 60);
    return {
      id: String(item.id ?? index),
      subject: String(item.subject ?? '').trim() || 'Unspecified',
      startedAt,
      actualMinutes,
      plannedMinutes,
      completed: item.completed !== false && item.status !== 'abandoned' && item.status !== 'missed',
      status: String(item.status ?? '')
    };
  }).filter(item => item.startedAt && item.startedAt <= now);

  // Sync retries can deliver the same session more than once. Keep one
  // canonical record per stable session ID so totals are not inflated.
  const uniqueSessions = new Map();
  for (const session of sessions) uniqueSessions.set(session.id, session);

  const plans = raw.plans.filter(item => item && typeof item === 'object').map((item, index) => ({
    id: String(item.id ?? index),
    subject: String(item.subject ?? '').trim(),
    plannedMinutes: clamp(finite(item.plannedMinutes ?? item.durationMinutes), 0, 24 * 60),
    actualMinutes: clamp(finite(item.actualMinutes), 0, 24 * 60),
    status: String(item.status ?? '')
  }));

  const exams = raw.exams.filter(item => item && typeof item === 'object').map((item, index) => ({
    id: String(item.id ?? index),
    subject: String(item.subject ?? '').trim() || 'General',
    title: String(item.title ?? '').trim(),
    date: toDate(item.date ?? item.examDate),
    targetMinutes: clamp(finite(item.targetMinutes, 300), 30, 100_000)
  })).filter(item => item.date && item.date >= new Date(now.getTime() - DAY));

  const normalizedAssessments = (Array.isArray(raw.assessments) ? raw.assessments : [])
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const date = toDate(item.date ?? item.takenAt ?? item.createdAt);
      const directPercent = item.scorePercent == null ? null : Number(item.scorePercent);
      const score = item.score == null ? null : Number(item.score);
      const maxScore = item.maxScore == null ? null : Number(item.maxScore);
      const hasDirectPercent = Number.isFinite(directPercent) && directPercent >= 0 && directPercent <= 100;
      const hasValidRatio = Number.isFinite(score) && Number.isFinite(maxScore)
        && maxScore > 0 && score >= 0 && score <= maxScore;
      const scorePercent = hasDirectPercent ? directPercent
        : hasValidRatio ? score / maxScore * 100 : null;
      return {
        id: String(item.id ?? index),
        subject: String(item.subject ?? '').trim(),
        date, scorePercent,
        type: String(item.type ?? 'assessment')
      };
    }).filter(item => item.subject && item.date && item.date <= now && item.scorePercent != null);
  // Stable assessment IDs prevent sync retries from making the evidence look
  // stronger than it really is. When duplicates conflict, retain the newest.
  const assessmentById = new Map();
  for (const assessment of normalizedAssessments) {
    const previous = assessmentById.get(assessment.id);
    if (!previous || assessment.date > previous.date) assessmentById.set(assessment.id, assessment);
  }
  const assessments = [...assessmentById.values()];
  const profile = raw.profile ?? {};
  const subjects = [...new Set((Array.isArray(profile.subjects) ? profile.subjects : [])
    .filter(value => value != null).map(value => String(typeof value === 'object' && value ? value.name ?? value.subject ?? '' : value).trim())
    .filter(Boolean))];
  return {
    userId: raw.userId,
    profile: {
      dailyAvailableMinutes: clamp(finite(profile.dailyAvailableMinutes, 240), 30, 24 * 60),
      subjects
    },
    sessions: [...uniqueSessions.values()],
    plans,
    exams,
    assessments
  };
}

export function assessDataQuality(rawSessions = [], now = new Date()) {
  const sessions = Array.isArray(rawSessions) ? rawSessions : [];
  const seenIds = new Set();
  let invalidRecords = 0;
  let futureRecords = 0;
  let duplicateRecords = 0;
  let missingStableIds = 0;
  let validRecords = 0;

  for (const item of sessions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalidRecords += 1;
      continue;
    }
    const startedAt = toDate(item.startedAt ?? item.date ?? item.completedAt ?? item.createdAt);
    const rawMinutes = item.actualMinutes ?? item.durationMinutes ?? item.minutes;
    const minutes = Number(rawMinutes);
    if (!startedAt || rawMinutes == null || String(rawMinutes).trim() === '' || !Number.isFinite(minutes) || minutes < 0) {
      invalidRecords += 1;
      continue;
    }
    if (startedAt > now) {
      futureRecords += 1;
      continue;
    }
    validRecords += 1;
    if (item.id == null || String(item.id).trim() === '') {
      missingStableIds += 1;
    } else {
      const id = String(item.id);
      if (seenIds.has(id)) duplicateRecords += 1;
      seenIds.add(id);
    }
  }

  const accepted = Math.max(0, validRecords - duplicateRecords);
  const total = sessions.length;
  const usablePercent = total ? round(accepted / total * 100) : null;
  const status = total === 0 ? 'no_data'
    : usablePercent >= 95 && missingStableIds === 0 ? 'high'
      : usablePercent >= 80 ? 'medium' : 'low';
  return {
    status, totalRecords: total, usableRecords: accepted,
    invalidRecords, futureRecords, duplicateRecords, missingStableIds,
    usablePercent
  };
}

export function analyzeData(input, now = new Date()) {
  input = normalizeInput({ ...input, sessions: input.sessions ?? [], plans: input.plans ?? [], exams: input.exams ?? [] }, now);
  const sessions = input.sessions.filter(s => s.startedAt && s.startedAt <= now);
  const recent = sessions.filter(s => s.startedAt >= new Date(now.getTime() - 7 * DAY));
  const previous = sessions.filter(s => s.startedAt >= new Date(now.getTime() - 14 * DAY) && s.startedAt < new Date(now.getTime() - 7 * DAY));
  const subjectMap = new Map();
  for (const session of sessions) {
    const entry = subjectMap.get(session.subject) ?? {
      subject: session.subject, totalMinutes: 0, sessions: 0, completedSessions: 0,
      activeDays: new Set(), lastStudiedAt: null
    };
    entry.totalMinutes += session.actualMinutes;
    entry.sessions += 1;
    if (session.completed) entry.completedSessions += 1;
    if (session.actualMinutes > 0) entry.activeDays.add(dayKey(session.startedAt));
    if (!entry.lastStudiedAt || session.startedAt > entry.lastStudiedAt) entry.lastStudiedAt = session.startedAt;
    subjectMap.set(session.subject, entry);
  }
  for (const subject of input.profile.subjects) {
    if (!subjectMap.has(subject)) subjectMap.set(subject, {
      subject, totalMinutes: 0, sessions: 0, completedSessions: 0,
      activeDays: new Set(), lastStudiedAt: null
    });
  }
  const assessmentMap = new Map();
  for (const assessment of input.assessments ?? []) {
    const daysOld = Math.max(0, (now - assessment.date) / DAY);
    const weight = Math.exp(-daysOld / 60);
    const entry = assessmentMap.get(assessment.subject) ?? {
      weightedScore: 0, totalWeight: 0, squaredWeight: 0, count: 0, latestAssessmentAt: null
    };
    entry.weightedScore += assessment.scorePercent * weight;
    entry.totalWeight += weight;
    entry.squaredWeight += weight * weight;
    entry.count += 1;
    if (!entry.latestAssessmentAt || assessment.date > entry.latestAssessmentAt) entry.latestAssessmentAt = assessment.date;
    assessmentMap.set(assessment.subject, entry);
    if (!subjectMap.has(assessment.subject)) subjectMap.set(assessment.subject, {
      subject: assessment.subject, totalMinutes: 0, sessions: 0, completedSessions: 0,
      activeDays: new Set(), lastStudiedAt: null
    });
  }
  const subjects = [...subjectMap.values()].map(item => {
    const assessment = assessmentMap.get(item.subject);
    const observedPerformance = assessment?.totalWeight
      ? assessment.weightedScore / assessment.totalWeight : null;
    const effectiveAssessmentCount = assessment?.squaredWeight
      ? assessment.totalWeight ** 2 / assessment.squaredWeight : 0;
    const daysSinceAssessment = assessment?.latestAssessmentAt
      ? Math.max(0, (now - assessment.latestAssessmentAt) / DAY) : Infinity;
    // Shrink sparse or stale evidence toward a neutral 70% prior. This avoids
    // treating one unusually easy/hard quiz as a definitive subject diagnosis.
    const recencyFactor = Number.isFinite(daysSinceAssessment)
      ? Math.exp(-daysSinceAssessment / 120) : 0;
    const assessmentConfidence = assessment
      ? clamp(effectiveAssessmentCount / (effectiveAssessmentCount + 2) * recencyFactor, 0, 0.85)
      : 0;
    const estimatedPerformance = observedPerformance == null
      ? null : 70 + (observedPerformance - 70) * assessmentConfidence;
    return ({
      subject: item.subject,
      totalMinutes: round(item.totalMinutes),
      sessions: item.sessions,
      completedSessions: item.completedSessions,
      activeDays: item.activeDays.size,
      averageMinutes: item.sessions ? round(item.totalMinutes / item.sessions) : 0,
      lastStudiedAt: item.lastStudiedAt?.toISOString() ?? null,
      assessmentCount: assessment?.count ?? 0,
      recentPerformancePercent: observedPerformance == null ? null : round(observedPerformance),
      estimatedPerformancePercent: estimatedPerformance == null ? null : round(estimatedPerformance),
      assessmentConfidence: round(assessmentConfidence * 100) / 100,
      effectiveAssessmentCount: round(effectiveAssessmentCount * 100) / 100,
      latestAssessmentAt: assessment?.latestAssessmentAt?.toISOString() ?? null
    });
  }).sort((a, b) => b.totalMinutes - a.totalMinutes || a.subject.localeCompare(b.subject));

  const sessionPlanned = sessions.reduce((sum, s) => sum + s.plannedMinutes, 0);
  const sessionActual = sessions.reduce((sum, s) => sum + s.actualMinutes, 0);
  const planPlanned = input.plans.reduce((sum, p) => sum + p.plannedMinutes, 0);
  const planActual = input.plans.reduce((sum, p) => sum + p.actualMinutes, 0);
  const planned = sessionPlanned || planPlanned;
  const actual = sessionPlanned ? sessionActual : planActual;
  const totalMinutes = sessions.reduce((sum, s) => sum + s.actualMinutes, 0);
  const completedSessions = sessions.filter(s => s.completed).length;
  const activeDays7d = new Set(recent.filter(s => s.actualMinutes > 0).map(s => dayKey(s.startedAt))).size;
  const overview = {
    totalSessions: sessions.length,
    completedSessions,
    totalMinutes: round(totalMinutes),
    totalMinutes7d: round(recent.reduce((sum, s) => sum + s.actualMinutes, 0)),
    totalMinutesPrevious7d: round(previous.reduce((sum, s) => sum + s.actualMinutes, 0)),
    sessions7d: recent.length,
    activeDays7d,
    completionRate: sessions.length ? round(completedSessions / sessions.length * 100) : 0,
    averageSessionMinutes: sessions.length ? round(average(sessions.map(s => s.actualMinutes))) : 0,
    plannedVsActualPercent: planned > 0 ? round(actual / planned * 100) : null,
    dataThrough: sessions.length ? sessions.reduce((latest, s) => s.startedAt > latest ? s.startedAt : latest, sessions[0].startedAt).toISOString() : null
  };
  const diagnosedSubjects = subjects.map(subject => ({
    ...subject,
    learningDiagnosis: diagnoseSubjectLearning({ subject: subject.subject, sessions: input.sessions, assessments: input.assessments ?? [], now })
  }));
  return { subjects: diagnosedSubjects, overview };
}

export function detectPatterns(input, data, memory = {}, now = new Date()) {
  input = normalizeInput({ ...input, sessions: input.sessions ?? [], plans: input.plans ?? [], exams: input.exams ?? [] }, now);
  const sessions = input.sessions.filter(s => s.startedAt && s.startedAt <= now && s.startedAt >= new Date(now.getTime() - 30 * DAY) && s.actualMinutes > 0);
  const hourTotals = new Map();
  const activeDays = new Set();
  const weekdayTotals = new Map();
  for (const session of sessions) {
    const hour = session.startedAt.getHours();
    hourTotals.set(hour, (hourTotals.get(hour) ?? 0) + session.actualMinutes);
    const weekday = session.startedAt.getDay();
    weekdayTotals.set(weekday, (weekdayTotals.get(weekday) ?? 0) + session.actualMinutes);
    activeDays.add(dayKey(session.startedAt));
  }
  const preferredStudyHours = [...hourTotals].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([hour, minutes]) => ({ hour, minutes, sharePercent: round(minutes / Math.max(1, sessions.reduce((sum, s) => sum + s.actualMinutes, 0)) * 100) }));
  const preferredWeekdays = [...weekdayTotals].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([day, minutes]) => ({ day, minutes }));
  const consistencyScore = round(activeDays.size / 30 * 100);
  const studied = data.subjects.filter(s => s.totalMinutes > 0);
  const total = Math.max(1, data.overview.totalMinutes);
  const concentration = studied.length > 1 ? round(studied[0].totalMinutes / total * 100) : studied.length ? 100 : 0;
  const abandonedPlans = input.plans.filter(p => ['abandoned', 'missed'].includes(p.status)).length;
  const signals = [];
  if (data.overview.totalSessions >= 5 && data.overview.completionRate < 60) signals.push({ code: 'LOW_COMPLETION', severity: 'warning' });
  if (sessions.length >= 5 && activeDays.size < 4) signals.push({ code: 'LOW_CONSISTENCY', severity: 'info' });
  if (studied.length > 1 && concentration >= 65) signals.push({ code: 'SUBJECT_IMBALANCE', severity: 'info' });
  if (abandonedPlans >= 2) signals.push({ code: 'REPEATED_ABANDONMENT', severity: 'warning' });
  const previousConsistency = memory?.patterns?.consistencyScore;
  return {
    preferredStudyHours, preferredWeekdays, activeDays30d: activeDays.size, consistencyScore,
    consistencyChange: Number.isFinite(previousConsistency) ? consistencyScore - previousConsistency : null,
    completionRate: data.overview.completionRate, subjectConcentrationPercent: concentration,
    abandonedPlans, signals,
    sampleSize: sessions.length,
    reliability: sessions.length >= 20 ? 'high' : sessions.length >= 8 ? 'medium' : 'low'
  };
}

export function predictStudyTrend(data, memory = {}) {
  const current = data.overview.totalMinutes7d;
  const previous = data.overview.totalMinutesPrevious7d;
  const snapshots = (memory?.snapshots ?? [])
    .filter(s => s && Number.isFinite(s.totalMinutes7d) && typeof s.weekKey === 'string' && !Number.isNaN(Date.parse(s.weekKey)))
    .slice(-12);
  const distinctWeeks = [...new Map(snapshots.map(s => [s.weekKey, s])).values()]
    .sort((a, b) => Date.parse(a.weekKey) - Date.parse(b.weekKey));
  const points = distinctWeeks.map(s => ({
    x: Date.parse(s.weekKey) / (7 * DAY),
    y: s.totalMinutes7d
  }));
  let direction = 'insufficient_data';
  let estimatedNextWeekMinutes = null;
  let confidence = 0.15;
  let method = 'insufficient_history';
  let slope = null;

  if (points.length >= 3 && points.at(-1).x - points[0].x >= 2) {
    const xMean = average(points.map(point => point.x));
    const yMean = average(points.map(point => point.y));
    const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
    slope = denominator
      ? points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator
      : 0;
    const predicted = clamp(current + slope, 0, Math.max(6000, current * 2 + 120));
    estimatedNextWeekMinutes = round(predicted);
    const relativeSlope = slope / Math.max(60, yMean);
    direction = relativeSlope > 0.08 ? 'increasing' : relativeSlope < -0.08 ? 'decreasing' : 'stable';
    confidence = clamp(0.35 + points.length * 0.06, 0.35, 0.8);
    method = 'gap_aware_weekly_linear_trend';
  } else if (previous > 0) {
    const change = (current - previous) / previous;
    direction = change > 0.08 ? 'increasing' : change < -0.08 ? 'decreasing' : 'stable';
    estimatedNextWeekMinutes = round(current * (direction === 'increasing' ? 1.03 : direction === 'decreasing' ? 0.97 : 1));
    confidence = 0.25;
    method = 'week_over_week';
  }
  return {
    direction, currentWeekMinutes: current, previousWeekMinutes: previous,
    changePercent: previous > 0 ? round((current - previous) / previous * 100) : null,
    estimatedNextWeekMinutes, slopeMinutesPerWeek: slope == null ? null : round(slope),
    confidence: round(confidence * 100) / 100, method,
    note: method === 'insufficient_history'
      ? 'برای تشخیص روند، هنوز دادهٔ هفتگی کافی وجود ندارد.'
      : 'این تخمین آماری است؛ تغییر ساعت مطالعه به‌تنهایی به معنی بهتر یا بدتر شدن یادگیری نیست.'
  };
}

export function rankPriorities(input, data, patterns, now = new Date()) {
  input = normalizeInput({ ...input, sessions: input.sessions ?? [], plans: input.plans ?? [], exams: input.exams ?? [] }, now);
  const bySubject = new Map(data.subjects.map(s => [s.subject, s]));
  const items = [];
  for (const exam of input.exams) {
    const daysLeft = Math.max(0, Math.ceil((exam.date - now) / DAY));
    const studied = bySubject.get(exam.subject)?.totalMinutes ?? 0;
    const preparation = clamp(studied / exam.targetMinutes * 100, 0, 100);
    const urgency = daysLeft <= 1 ? 100 : daysLeft <= 3 ? 92 : daysLeft <= 7 ? 78 : daysLeft <= 14 ? 58 : daysLeft <= 30 ? 38 : 18;
    const score = round(clamp(urgency * 0.62 + (100 - preparation) * 0.38, 0, 100));
    items.push({
      id: 'exam-' + exam.id, type: 'exam', reasonCode: 'EXAM_URGENCY_AND_PREPARATION_GAP', subject: exam.subject,
      title: exam.title || 'آمادگی آزمون ' + exam.subject, daysLeft,
      studyTargetProgressPercent: round(preparation), score,
      priority: score >= 80 ? 'critical' : score >= 65 ? 'high' : score >= 45 ? 'medium' : 'low',
      reason: `${daysLeft} روز تا آزمون باقی مانده و بر اساس زمان مطالعهٔ ثبت‌شده، ${round(preparation)}٪ از هدف زمانی تعیین‌شده پوشش داده شده است.`
    });
  }

  for (const subject of data.subjects) {
    const estimate = subject.estimatedPerformancePercent;
    const evidenceConfidence = subject.assessmentConfidence ?? 0;
    // Require a meaningful estimated gap and some recent evidence. Low-volume
    // or stale assessments are deliberately prevented from dominating plans.
    if (estimate != null && estimate < 65 && evidenceConfidence >= 0.2) {
      const gap = Math.max(0, 70 - estimate);
      const score = round(clamp(30 + gap * 0.9 + evidenceConfidence * 10, 30, 85));
      items.push({
        id: 'performance-' + encodeURIComponent(subject.subject),
        type: 'assessment_gap', reasonCode: 'LOW_ASSESSMENT_PERFORMANCE',
        subject: subject.subject, title: 'تقویت عملکرد در ' + subject.subject,
        score, priority: score >= 65 ? 'high' : score >= 45 ? 'medium' : 'low',
        performancePercent: subject.recentPerformancePercent,
        estimatedPerformancePercent: estimate,
        assessmentConfidence: evidenceConfidence,
        assessmentCount: subject.assessmentCount,
        reason: `میانگین مشاهده‌شده ${subject.recentPerformancePercent}٪ و برآورد تعدیل‌شده با توجه به تعداد و تازگی آزمون‌ها ${estimate}٪ است؛ این نتیجه یک نشانهٔ قابل بازبینی است، نه حکم قطعی دربارهٔ تسلط.`
      });
    }
  }

  const recentBySubject = new Map();
  for (const session of input.sessions) {
    if (session.actualMinutes > 0 && session.startedAt >= new Date(now.getTime() - 30 * DAY)) {
      recentBySubject.set(session.subject, (recentBySubject.get(session.subject) ?? 0) + session.actualMinutes);
    }
  }
  const recentTotal = Math.max(1, [...recentBySubject.values()].reduce((sum, value) => sum + value, 0));
  for (const subject of data.subjects) {
    const recentMinutes = recentBySubject.get(subject.subject) ?? 0;
    const share = recentMinutes / recentTotal;
    const daysSince = subject.lastStudiedAt ? (now - new Date(subject.lastStudiedAt)) / DAY : Infinity;
    if (subject.sessions === 0 || (data.subjects.length > 1 && share < 0.12) || daysSince >= 7) {
      const score = round(clamp(35 + (subject.sessions === 0 ? 28 : 0) + (Number.isFinite(daysSince) ? Math.min(25, daysSince * 2) : 18) + (share < 0.12 ? 15 : 0), 0, 85));
      items.push({
        id: 'subject-' + encodeURIComponent(subject.subject), type: 'subject_gap', reasonCode: subject.sessions === 0 ? 'SUBJECT_NO_HISTORY' : 'SUBJECT_LOW_RECENCY_OR_SHARE',
        subject: subject.subject, title: 'بررسی وضعیت ' + subject.subject,
        score, priority: score >= 65 ? 'high' : score >= 45 ? 'medium' : 'low',
        reason: subject.sessions === 0
          ? 'برای این درس هنوز جلسه‌ای ثبت نشده؛ ابتدا مشخص کن واقعاً به زمان بیشتری نیاز دارد یا نه.'
          : `سهم مطالعه ${round(share * 100)}٪ است و آخرین جلسهٔ ثبت‌شده ${Number.isFinite(daysSince) ? round(daysSince) + ' روز پیش' : 'نامشخص'} بوده است.`
      });
    }
  }
  if (patterns.signals.some(s => s.code === 'LOW_COMPLETION')) {
    items.push({ id: 'habit-completion', type: 'habit', reasonCode: 'LOW_SESSION_COMPLETION', title: 'تنظیم واقع‌بینانه‌تر برنامه', score: 68, priority: 'high', reason: 'نرخ تکمیل جلسات پایین است؛ بهتر است حجم یا اندازهٔ بلوک‌های برنامه بازبینی شود.' });
  }
  return items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function proposeAdaptivePlan(input, data, priorities, patterns, now = new Date(), memory = {}) {
  const available = input.profile.dailyAvailableMinutes;
  const feedbackAdjustment = getPlanFitAdjustment(memory?.feedback ?? []);
  const completionFactor = data.overview.totalSessions < 4 ? 0.8
    : patterns.completionRate >= 85 ? 1
      : patterns.completionRate >= 65 ? 0.9 : 0.75;
  const capacity = Math.max(25, Math.round(available * 0.8 * completionFactor * feedbackAdjustment.factor / 5) * 5);
  const candidates = [...new Set([
    ...priorities.filter(item => item.subject).sort((a, b) => b.score - a.score).map(item => item.subject),
    ...input.profile.subjects,
    ...data.subjects.map(item => item.subject)
  ])].slice(0, 6);
  if (!candidates.length) return {
    status: 'insufficient_data', recommendedDailyMinutes: capacity, blocks: [], feedbackAdjustment,
    rationale: 'برای پیشنهاد برنامه، ابتدا نام درس‌ها یا چند جلسهٔ مطالعه ثبت شود.'
  };

  const priorityScore = subject => Math.max(0, ...priorities.filter(p => p.subject === subject).map(p => p.score));
  const weights = candidates.map(subject => 1 + priorityScore(subject) / 50);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let remaining = capacity;
  const blocks = candidates.map((subject, index) => {
    const proposed = index === candidates.length - 1
      ? remaining
      : Math.floor((capacity * weights[index] / totalWeight) / 5) * 5;
    const minutes = Math.max(0, Math.min(remaining, proposed));
    remaining -= minutes;
    return {
      subject, suggestedMinutes: minutes,
      reasonCode: priorityScore(subject) >= 65 ? 'HIGH_PRIORITY_ALLOCATION' : 'BALANCED_SUBJECT_COVERAGE',
      reason: priorityScore(subject) >= 65
        ? 'زمان بیشتری گرفته چون در تحلیل فعلی اولویت بالاتری دارد.'
        : 'برای حفظ پیوستگی و تعادل مطالعه در برنامه قرار گرفته است.'
    };
  }).filter(block => block.suggestedMinutes > 0);
  return {
    status: 'proposal', createdAt: now.toISOString(), feedbackAdjustment,
    recommendedDailyMinutes: blocks.reduce((sum, block) => sum + block.suggestedMinutes, 0),
    blocks,
    rationale: 'این یک پیشنهاد قابل ویرایش است؛ برنامهٔ اصلی بدون تأیید کاربر تغییر نمی‌کند.'
  };
}

export function buildRecommendations(data, patterns, trend, priorities, proposal) {
  const recommendations = [];
  const add = (type, priority, title, reason, action) => recommendations.push({
    id: type + '-' + (recommendations.length + 1), type, reasonCode: type.toUpperCase(), priority, title, reason, action
  });
  if (!data.overview.totalSessions) {
    add('getting_started', 'medium', 'شروع ثبت مطالعه', 'هنوز دادهٔ کافی برای تحلیل الگوی مطالعه وجود ندارد.', 'یک جلسهٔ مطالعه ثبت کن تا تحلیل از دادهٔ واقعی شروع شود.');
  } else {
    if (patterns.reliability === 'low') add('data_quality', 'low', 'برای تحلیل دقیق‌تر داده جمع کن', 'تعداد جلسات ثبت‌شده هنوز کم است؛ نتیجه‌ها موقتی‌اند.', 'چند جلسهٔ واقعی دیگر ثبت کن و سپس روند را بررسی کن.');
    if (patterns.signals.some(s => s.code === 'LOW_COMPLETION')) add('planning', 'high', 'اندازهٔ برنامه را بازبینی کن', 'نرخ تکمیل جلسات پایین است.', 'به‌جای افزایش فشار، حجم برنامه را واقع‌بینانه‌تر کن.');
    if (trend.direction === 'decreasing') add('trend', 'medium', 'تغییر روند را بررسی کن', 'زمان مطالعهٔ هفتهٔ اخیر نسبت به مرجع کاهش داشته است.', 'علت تغییر را بررسی کن؛ صرفاً برای جبران، ساعت مطالعه را ناگهانی بالا نبر.');
    if (patterns.signals.some(s => s.code === 'SUBJECT_IMBALANCE')) add('balance', 'medium', 'تعادل درس‌ها را بررسی کن', 'زمان ثبت‌شده بین درس‌ها نامتوازن است.', 'با توجه به آزمون‌های پیش رو و میزان تسلط، توزیع زمان را بازبینی کن.');
  }
  for (const item of priorities.slice(0, 3)) add('priority', item.priority, item.title, item.reason, 'این مورد را در برنامهٔ بعدی بررسی کن.');
  if (proposal.status === 'proposal') add('plan_proposal', 'low', 'پیشنهاد برنامه آماده است', proposal.rationale, 'پیشنهاد را بررسی و در صورت تمایل ویرایش یا تأیید کن.');
  return recommendations;
}

export function createOwjAI({ storage, clock = () => new Date() } = {}) {
  const memoryStore = storage ?? (() => {
    const map = new Map();
    return {
      get: async key => map.get(key) ?? null,
      set: async (key, value) => map.set(key, value),
      remove: async key => map.delete(key)
    };
  })();
  const userQueues = new Map();
  const withUserLock = (userId, task) => {
    const previous = userQueues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    userQueues.set(userId, current);
    return current.finally(() => {
      if (userQueues.get(userId) === current) userQueues.delete(userId);
    });
  };
  const assertUserId = userId => {
    if (typeof userId !== 'string' || !userId.trim()) throw new TypeError('input.userId is required');
  };
  async function getMemory(userId) {
    assertUserId(userId);
    return memoryStore.get(userId);
  }
  async function clearMemory(userId) {
    assertUserId(userId);
    return withUserLock(userId, () => memoryStore.remove(userId));
  }
  async function trainNeuralModel(userId, examples, options = {}) {
    assertUserId(userId);
    if (!Array.isArray(examples)) throw new TypeError('examples must be an array');
    return withUserLock(userId, async () => {
      const stored = await memoryStore.get(userId);
      const memory = stored && typeof stored === 'object' ? stored : { schemaVersion: 3, snapshots: [], feedback: [], forecastHistory: [] };
      const neural = createStudyNeuralModel(memory.neuralModel);
      const result = neural.train(examples, options);
      if (result.status === 'trained') {
        const now = toDate(clock());
        await memoryStore.set(userId, {
          ...memory,
          schemaVersion: 3,
          engineVersion: ENGINE_VERSION,
          updatedAt: now.toISOString(),
          neuralModel: neural.exportModel()
        });
      }
      return {
        status: result.status,
        acceptedExamples: result.acceptedExamples ?? 0,
        trainingExamples: result.trainingExamples ?? 0,
        validationExamples: result.validationExamples ?? 0,
        epochs: result.epochs ?? 0,
        validation: result.validation ?? null
      };
    });
  }
  async function predictNeuralModel(userId, features) {
    assertUserId(userId);
    const stored = await memoryStore.get(userId);
    const neural = createStudyNeuralModel(stored?.neuralModel);
    return neural.predict(features);
  }
  async function getNeuralMetrics(userId) {
    assertUserId(userId);
    const stored = await memoryStore.get(userId);
    return createStudyNeuralModel(stored?.neuralModel).getMetrics();
  }
  async function recordFeedback(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('feedback event must be an object');
    assertUserId(event.userId);
    const kind = event.kind ?? 'recommendation';
    if (!['recommendation', 'plan_outcome'].includes(kind)) throw new TypeError('unsupported feedback kind');
    const now = event.createdAt ? toDate(event.createdAt) : toDate(clock());
    if (!now) throw new TypeError('createdAt must be a valid date');
    const entry = { id: String(event.id ?? makeId()), kind, createdAt: now.toISOString() };
    if (kind === 'recommendation') {
      if (typeof event.accepted !== 'boolean') throw new TypeError('recommendation feedback requires accepted boolean');
      entry.recommendationId = String(event.recommendationId ?? '');
      entry.accepted = event.accepted;
      if (event.usefulness != null) entry.usefulness = clamp(round(finite(event.usefulness)), 1, 5);
    } else {
      entry.plannedMinutes = clamp(finite(event.plannedMinutes), 0, 24 * 60);
      entry.actualMinutes = clamp(finite(event.actualMinutes), 0, 24 * 60);
      if (entry.plannedMinutes <= 0) throw new TypeError('plan outcome requires plannedMinutes > 0');
      entry.completed = event.completed === true;
      entry.subject = String(event.subject ?? '').trim();
    }
    return withUserLock(event.userId, async () => {
      const stored = await memoryStore.get(event.userId);
      const previous = stored && typeof stored === 'object' ? stored : { schemaVersion: 3, snapshots: [], feedback: [] };
      const previousFeedback = Array.isArray(previous.feedback) ? previous.feedback : [];
      const feedback = [...previousFeedback.filter(item => item && item.id !== entry.id), entry].slice(-100);
      await memoryStore.set(event.userId, { ...previous, schemaVersion: 3, engineVersion: ENGINE_VERSION, updatedAt: now.toISOString(), feedback });
      return summarizeFeedback(feedback);
    });
  }
  async function getFeedbackSummary(userId) {
    assertUserId(userId);
    const memory = await memoryStore.get(userId);
    return summarizeFeedback(memory?.feedback ?? []);
  }
  async function analyze(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('analyze expects an object');
    assertUserId(raw.userId);
    for (const key of ['sessions', 'plans', 'exams', 'assessments']) {
      if (raw[key] != null && !Array.isArray(raw[key])) throw new TypeError(key + ' must be an array');
    }
    const now = raw.now ? toDate(raw.now) : toDate(clock());
    if (!now) throw new TypeError('now must be a valid date');
    return withUserLock(raw.userId, async () => {
    const input = normalizeInput({ ...raw, sessions: raw.sessions ?? [], plans: raw.plans ?? [], exams: raw.exams ?? [] }, now);
    const storedMemory = await memoryStore.get(raw.userId);
    const old = {
      ...(storedMemory && typeof storedMemory === 'object' ? storedMemory : {}),
      snapshots: Array.isArray(storedMemory?.snapshots) ? storedMemory.snapshots : [],
      feedback: Array.isArray(storedMemory?.feedback) ? storedMemory.feedback : [],
      forecastHistory: Array.isArray(storedMemory?.forecastHistory)
        ? storedMemory.forecastHistory.filter(item => item && typeof item === 'object') : []
    };
    const dataQuality = assessDataQuality(raw.sessions ?? [], now);
    const data = analyzeData(input, now);
    const patterns = detectPatterns(input, data, old, now);
    const trend = predictStudyTrend(data, old);
    const priorities = rankPriorities(input, data, patterns, now);
    const feedbackSummary = summarizeFeedback(old?.feedback ?? []);
    const settledForecasts = settleWeeklyForecasts(old?.forecastHistory ?? [], input.sessions, now, toDate(raw.historyCompleteThrough));
    const forecastHistory = createWeeklyForecast(settledForecasts, trend, now).slice(-16);
    const forecastAccuracy = summarizeForecastAccuracy(forecastHistory);
    const planProposal = proposeAdaptivePlan(input, data, priorities, patterns, now, old ?? {});
    const recommendations = buildRecommendations(data, patterns, trend, priorities, planProposal);
    const neural = createStudyNeuralModel(old?.neuralModel);
    const assessmentValues = data.subjects
      .filter(subject => subject.recentPerformancePercent != null)
      .map(subject => subject.recentPerformancePercent);
    const upcomingExamDays = input.exams
      .map(exam => Math.max(0, Math.ceil((exam.date - now) / DAY)));
    const recentSessions = input.sessions.filter(session =>
      session.startedAt >= new Date(now.getTime() - 7 * DAY) && session.actualMinutes > 0
    );
    const neuralFeatures = {
      studyMinutes7d: clamp(data.overview.totalMinutes7d, 0, 4200),
      studyMinutesPrevious7d: clamp(data.overview.totalMinutesPrevious7d, 0, 4200),
      activeDays7d: clamp(data.overview.activeDays7d, 0, 7),
      sessions7d: clamp(data.overview.sessions7d, 0, 70),
      completionRate: data.overview.completionRate,
      plannedVsActualPercent: data.overview.plannedVsActualPercent == null
        ? null : clamp(data.overview.plannedVsActualPercent, 0, 150),
      assessmentPerformance: assessmentValues.length
        ? assessmentValues.reduce((sum, value) => sum + value, 0) / assessmentValues.length : null,
      daysUntilNextExam: upcomingExamDays.length ? clamp(Math.min(...upcomingExamDays), 0, 90) : null,
      consistencyScore: clamp(patterns.consistencyScore, 0, 100),
      averageSessionMinutes: clamp(data.overview.averageSessionMinutes, 0, 240),
      subjectsStudied7d: clamp(new Set(recentSessions.map(session => session.subject)).size, 0, 20),
      missedSessions7d: clamp(recentSessions.filter(session => !session.completed).length, 0, 70)
    };
    const neuralForecast = neural.predict(neuralFeatures);
    const hybridDecision = buildHybridDecision({
      subjects: data.subjects, priorities, patterns, trend, neuralForecast,
      dataQuality, overview: data.overview, feedback: feedbackSummary
    });
    const recentEvidence = input.sessions.filter(s => s.startedAt >= new Date(now.getTime() - 30 * DAY)).length;
    const evidenceCount = Math.min(1, recentEvidence / 20);
    const qualityFactor = dataQuality.status === 'high' ? 1
      : dataQuality.status === 'medium' ? 0.85
        : dataQuality.status === 'low' ? 0.65 : 0.4;
    const rawEvidenceScore = 0.15 + evidenceCount * 0.55
      + (data.subjects.length ? 0.1 : 0) + (old?.snapshots?.length >= 3 ? 0.1 : 0);
    const confidence = round(clamp(rawEvidenceScore * qualityFactor, 0.1, 0.9) * 100) / 100;
    const result = {
      id: makeId(), engineVersion: ENGINE_VERSION, createdAt: now.toISOString(),
      userId: raw.userId, overview: data.overview, subjects: data.subjects, dataQuality,
      patterns, trend, priorities, planProposal, recommendations, hybridDecision, confidence,
      confidenceType: 'heuristic_evidence_score',
      feedback: feedbackSummary, forecastAccuracy
    };
    const currentWeek = weekKey(now);
    const snapshots = [...(old?.snapshots ?? []).filter(s => s && typeof s === 'object' && s.weekKey !== currentWeek), {
      weekKey: currentWeek, createdAt: result.createdAt,
      totalMinutes7d: data.overview.totalMinutes7d,
      sessions7d: data.overview.sessions7d,
      completionRate: data.overview.completionRate
    }].slice(-12);
    const subjectMemory = Object.fromEntries(data.subjects.map(s => [s.subject, {
      totalMinutes: s.totalMinutes, sessions: s.sessions,
      lastStudiedAt: s.lastStudiedAt, averageMinutes: s.averageMinutes
    }]));
    await memoryStore.set(raw.userId, {
      schemaVersion: 3, engineVersion: ENGINE_VERSION, updatedAt: result.createdAt,
      feedback: old?.feedback ?? [], forecastHistory, neuralModel: old?.neuralModel ?? null,
      snapshots, subjects: subjectMemory,
      patterns: {
        preferredStudyHours: patterns.preferredStudyHours,
        consistencyScore: patterns.consistencyScore,
        completionRate: patterns.completionRate
      },
      importantInsights: recommendations.filter(r => ['high', 'critical'].includes(r.priority))
        .slice(0, 8).map(({ type, title, reason }) => ({ type, title, reason, createdAt: result.createdAt })),
      lastAnalysisId: result.id
    });
    return result;
    });
  }
  return Object.freeze({ analyze, getMemory, clearMemory, recordFeedback, getFeedbackSummary, trainNeuralModel, predictNeuralModel, getNeuralMetrics, version: ENGINE_VERSION });
}
