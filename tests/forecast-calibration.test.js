import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateWeeklyForecast } from '../src/index.js';

const trend = { estimatedNextWeekMinutes: 900, confidence: 0.6, method: 'week_over_week' };

test('does not calibrate until at least three completed forecasts exist', () => {
  const result = calibrateWeeklyForecast(trend, [
    { predictedMinutes: 900, actualMinutes: 600 },
    { predictedMinutes: 800, actualMinutes: 700 }
  ]);
  assert.equal(result.status, 'collecting');
  assert.equal(result.trend, trend);
  assert.equal(result.biasCorrectionMinutes, 0);
});

test('corrects persistent overprediction and reports an empirical error range', () => {
  const result = calibrateWeeklyForecast(trend, [
    { predictedMinutes: 1000, actualMinutes: 700 },
    { predictedMinutes: 1100, actualMinutes: 800 },
    { predictedMinutes: 900, actualMinutes: 600 }
  ]);
  assert.equal(result.status, 'calibrated');
  assert.equal(result.biasCorrectionMinutes, 300);
  assert.equal(result.trend.estimatedNextWeekMinutes, 600);
  assert.deepEqual(result.rangeMinutes, [300, 900]);
  assert.ok(result.trend.confidence <= trend.confidence);
});

test('uses only the latest twelve valid completed forecasts', () => {
  const history = Array.from({ length: 15 }, (_, i) => ({
    predictedMinutes: i < 3 ? 5000 : 1000,
    actualMinutes: i < 3 ? 0 : 900
  }));
  const result = calibrateWeeklyForecast(trend, history);
  assert.equal(result.evaluatedForecasts, 12);
  assert.equal(result.biasCorrectionMinutes, 100);
  assert.equal(result.trend.estimatedNextWeekMinutes, 800);
});

test('rejects unusable history without producing non-finite values', () => {
  const result = calibrateWeeklyForecast(trend, [
    { predictedMinutes: NaN, actualMinutes: 500 },
    { predictedMinutes: 900, actualMinutes: -10 },
    null
  ]);
  assert.equal(result.status, 'collecting');
  assert.equal(result.trend.estimatedNextWeekMinutes, 900);
});
