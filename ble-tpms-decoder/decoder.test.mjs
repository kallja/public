import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHex, decode, decodeAny, decodeLines, decodeProtobuf, PROFILES } from './decoder.js';

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
  const r = decodeProtobuf(parseHex('12 08 E2 01 05 08 8F 04 10 28'));
  assert.equal(r.raw.f1, 527);
  assert.equal(r.pressureBar, 4.257);
  assert.equal(r.temperatureC, 20);
  assert.equal(r.batteryVolts, null);
});

test('should decode a 0x05 protobuf frame in auto mode', () => {
  const r = decodeAny(parseHex('0x2B020512102A0E08FA021016180320961728013003'), 'auto');
  assert.equal(r.source, 'protobuf');
  assert.equal(r.pressureBar, 2.767);
  assert.equal(r.temperatureC, 11);
  assert.equal(r.batteryVolts, 2.966);
  assert.deepEqual(r.raw, { f1: 378, f2: 22, f3: 3, f4: 2966, f5: 1, f6: 3 });
});

test('should decode a 0x05 protobuf frame without the company ID', () => {
  const r = decodeAny(parseHex('0512102A0E08890310261803209B1728013003'), 'protobuf');
  assert.equal(r.pressureBar, 2.917);
  assert.equal(r.temperatureC, 19);
});

test('should not treat fixed-layout frames as protobuf', () => {
  assert.equal(decodeProtobuf(parseHex('0201060BFF2B0201020A860148EA0B')), null);
  assert.equal(decodeProtobuf(parseHex('01020A860148EA0B')), null);
  assert.equal(decodeProtobuf(parseHex('2B0201FE03')), null);
});

test('should decode one frame per line and report bad lines', () => {
  const results = decodeLines(
    '0x2B020512102A0E08FA021016180320961728013003\n\n  0201060BFF2B0201020A860148EA0B  \r\nABC\n2B02',
    'auto',
  );
  assert.equal(results.length, 4);
  assert.equal(results[0].reading.temperatureC, 11);
  assert.equal(results[1].reading.pressureBar, 2.9);
  assert.equal(results[1].input, '0201060BFF2B0201020A860148EA0B');
  assert.match(results[2].error, /Odd number/);
  assert.match(results[3].error, /Could not decode/);
});

test('should reject odd-length hex', () => {
  assert.throws(() => parseHex('ABC'));
});
