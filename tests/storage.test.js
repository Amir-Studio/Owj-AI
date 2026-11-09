import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/index.js';

function makeAdapter(seed = new Map()) {
  return {
    values: seed,
    async getItem(key) { return this.values.get(key) ?? null; },
    async setItem(key, value) { this.values.set(key, value); },
    async removeItem(key) { this.values.delete(key); }
  };
}

test('persists and restores current v2 engine memory', async () => {
  const adapter = makeAdapter();
  const firstInstance = createMemoryStorage(adapter);
  const memory = {
    schemaVersion: 2,
    engineVersion: '0.2.0',
    snapshots: [{ weekKey: '2026-11-09', totalMinutes7d: 420 }],
    lastAnalysisId: 'analysis-1'
  };

  await firstInstance.set('user-1', memory);
  const secondInstance = createMemoryStorage(adapter);

  assert.deepEqual(await secondInstance.get('user-1'), memory);
});

test('continues to read legacy v1 memory for migration', async () => {
  const adapter = makeAdapter(new Map([
    ['owj-ai-memory:v1:user-1', JSON.stringify({ schemaVersion: 1, snapshots: [] })]
  ]));
  const storage = createMemoryStorage(adapter);

  assert.deepEqual(await storage.get('user-1'), { schemaVersion: 1, snapshots: [] });
});

test('isolates users and removes only the selected user memory', async () => {
  const storage = createMemoryStorage(makeAdapter());
  await storage.set('user-1', { schemaVersion: 2, value: 'one' });
  await storage.set('user-2', { schemaVersion: 2, value: 'two' });

  await storage.remove('user-1');

  assert.equal(await storage.get('user-1'), null);
  assert.deepEqual(await storage.get('user-2'), { schemaVersion: 2, value: 'two' });
});

test('returns null for corrupt or unsupported stored records', async () => {
  const adapter = makeAdapter(new Map([
    ['owj-ai-memory:v1:broken', '{not-json'],
    ['owj-ai-memory:v1:future', JSON.stringify({ schemaVersion: 99 })]
  ]));
  const storage = createMemoryStorage(adapter);

  assert.equal(await storage.get('broken'), null);
  assert.equal(await storage.get('future'), null);
});

test('rejects invalid IDs and non-object memory values', async () => {
  const storage = createMemoryStorage(makeAdapter());

  await assert.rejects(() => storage.get(' '), /userId is required/);
  await assert.rejects(() => storage.set('user-1', null), /memory value must be an object/);
});
