import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceWriter } from '../src/settings.mjs';

test('older in-flight preference save cannot overwrite a later theme/property generation', async () => {
  let state = { theme: 'dark', property: null };
  const entered = Promise.withResolvers(), first = Promise.withResolvers();
  const starts = [], completed = [];
  let disk;
  const writer = createPreferenceWriter({ read: () => state, write: async snapshot => {
    starts.push(snapshot);
    if (starts.length === 1) { entered.resolve(); await first.promise; }
    disk = snapshot; completed.push(snapshot);
  }});
  const old = writer.flush();
  await entered.promise;
  state = { theme: 'light', property: { latitude: 38.95, longitude: -105.1, elevationFt: 9210 } };
  const latest = writer.flush();
  await Promise.resolve();
  assert.equal(starts.length, 1, 'newer write must wait for the old response');
  first.resolve();
  await Promise.all([old, latest]);
  assert.equal(completed.length, 2);
  assert.equal(disk.theme, 'light');
  assert.equal(disk.property.elevationFt, 9210);
  assert.equal(completed[0].property, null, 'in-flight snapshot is not mutated by later UI state');
});

test('shutdown flush cancels debounce and persists the latest state without a delayed overwrite', async () => {
  let state = { theme: 'dark' };
  const writes = [];
  const writer = createPreferenceWriter({ read: () => state, write: async value => writes.push(value), delay: 60_000 });
  writer.schedule();
  state.theme = 'light';
  writer.schedule();
  await writer.flush();
  await writer.settled();
  assert.deepEqual(writes, [{ theme: 'light' }]);
});

test('failed preference save is reported and cannot poison a later successful save', async () => {
  let attempts = 0, state = { layout: 1 }, disk;
  const errors = [];
  const writer = createPreferenceWriter({ read: () => state, onError: error => errors.push(error.message), write: async value => {
    if (++attempts === 1) throw new Error('Network interrupted');
    disk = value;
  }});
  await assert.rejects(writer.flush(), /Network interrupted/);
  state.layout = 4;
  await writer.flush();
  assert.deepEqual(errors, ['Network interrupted']);
  assert.deepEqual(disk, { layout: 4 });
});
