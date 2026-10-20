import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHex, decode, decodeAny, decodeTpdata, PROFILES } from './decoder.js';

test('should decode an awake full advertisement', () => {
  const r = decodeAny(parseHex('0201060BFF2B0201020A860148EA0B'), 'auto');
  assert.equal(r.awake, true);
  assert.equal(r.pressureBar, 2.9);
  assert.equal(r.temperatureC, 22);
  assert.equal(r.batteryVolts, 3.05);
  assert.equal(r.batteryPercent, 97);
  assert.deepEqual(r.raw, { byte0: 1, byte1: 2, status: 10, pressure: 390, temperature: 72, battery_mv: 3050 });
});

test('should decode bare manufacturer data the same as the full advertisement', () => {
  const r = decodeAny(parseHex('01020A860148EA0B'), 'mfr');
  assert.equal(r.pressureBar, 2.9);
});

test('should apply the legacy formula', () => {
  const r = decode(parseHex('01020A860148EA0B'), PROFILES.legacy);
  assert.equal(r.pressurePsi, 41.42);
  assert.equal(r.temperatureC, 21.7);
});

test('should report a sleep frame without measurements', () => {
  const r = decodeAny(parseHex('2B0201FE03'), 'auto');
  assert.equal(r.awake, false);
  assert.equal(r.pressureBar, null);
  assert.equal(r.status, 3);
});

test('should decode a nested GATT TPData indication', () => {
  const r = decodeTpdata(parseHex('12 08 E2 01 05 08 8F 04 10 28'));
  assert.equal(r.raw.gatt_pressure, 527);
  assert.equal(r.pressureBar, 4.257);
  assert.equal(r.temperatureC, 20);
});

test('should reject odd-length hex', () => {
  assert.throws(() => parseHex('ABC'));
});
