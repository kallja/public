// Decoder for BLE TPMS frames advertised under Bluetooth company ID 0x022B
// (e.g. Autel MX-Sensor BLE). Ported from Aliaksandr Anufryieu's MIT-licensed
// decoder; see LICENSE.
//
// Advertisement manufacturer data under company ID 0x022B, after the two
// company-ID bytes:
//
//   offset  size  field
//   0       1     unknown / protocol sub-type
//   1       1     unknown / counter
//   2       1     status; < 0x05 means asleep and the rest is stale
//   3       2     pressure, uint16 LE
//   5       1     temperature, uint8
//   6       2     battery millivolts, uint16 LE
//
// The formulas are reverse-engineered. "default" reads pressure as absolute
// kPa and temperature as degC + 50; "legacy" reproduces the original ESP32
// fit (psi = (raw - 100) / 7, degF = raw - 1).

export const COMPANY_ID = 0x022b;
export const MIN_SLEEP_PAYLOAD_LEN = 3;
export const MIN_PAYLOAD_LEN = 8;
export const STATUS_AWAKE_MIN = 0x05;

const PSI_PER_BAR = 14.503773773;
const ATMOSPHERE_KPA = 101.325;

export const PROFILES = {
  default: {
    name: 'default',
    pressureOffset: 100,
    pressureDivisor: 100,
    celsiusNative: true,
    temperatureOffset: 50,
  },
  legacy: {
    name: 'legacy',
    pressureOffset: 100,
    pressureDivisor: 7 * PSI_PER_BAR,
    celsiusNative: false,
    temperatureOffset: 1,
  },
};

const round = (value, digits) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const u16le = (data, i) => data[i] | (data[i + 1] << 8);

export function parseHex(text) {
  const clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (clean.length === 0) throw new Error('No hex digits found.');
  if (clean.length % 2 !== 0) throw new Error('Odd number of hex digits.');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function batteryPercentage(volts) {
  const curve = [
    [3.3, 100],
    [3.05, 97],
    [2.94, 91],
    [2.9, 75],
    [2.85, 25],
    [2.8, 17],
    [2.6, 0],
  ];
  if (volts >= curve[0][0]) return 100;
  if (volts < curve[curve.length - 1][0]) return 0;
  for (let i = 0; i < curve.length - 1; i++) {
    const [vHi, pHi] = curve[i];
    const [vLo, pLo] = curve[i + 1];
    if (vLo < volts && volts <= vHi) {
      return Math.round(pLo + ((volts - vLo) / (vHi - vLo)) * (pHi - pLo));
    }
  }
  return 0;
}

function withUnits(reading) {
  const bar = reading.pressureBar;
  return {
    ...reading,
    pressurePsi: bar == null ? null : round(bar * PSI_PER_BAR, 2),
    pressureKpa: bar == null ? null : round(bar * 100, 1),
  };
}

// mfrData: manufacturer data with the company-ID bytes already stripped.
export function decode(mfrData, profile = PROFILES.default) {
  if (!mfrData || mfrData.length < MIN_SLEEP_PAYLOAD_LEN) return null;

  const status = mfrData[2];
  const raw = { byte0: mfrData[0], byte1: mfrData[1], status };
  if (mfrData.length >= MIN_PAYLOAD_LEN) {
    raw.pressure = u16le(mfrData, 3);
    raw.temperature = mfrData[5];
    raw.battery_mv = u16le(mfrData, 6);
  }

  if (status < STATUS_AWAKE_MIN) {
    const volts = 'battery_mv' in raw ? raw.battery_mv / 1000 : null;
    const plausible = volts != null && volts >= 1.5 && volts <= 4.3;
    return withUnits({
      source: 'advertisement',
      awake: false,
      status,
      pressureBar: null,
      temperatureC: null,
      batteryVolts: plausible ? round(volts, 3) : null,
      batteryPercent: plausible ? batteryPercentage(volts) : null,
      raw,
      profile: profile.name,
    });
  }

  if (mfrData.length < MIN_PAYLOAD_LEN) return null;

  let pressureBar = (raw.pressure - profile.pressureOffset) / profile.pressureDivisor;
  // A deflated tyre reads slightly negative because of sensor offset; clamp.
  if (pressureBar > -0.2 && pressureBar < 0) pressureBar = 0;

  const temperatureC = profile.celsiusNative
    ? raw.temperature - profile.temperatureOffset
    : ((raw.temperature - profile.temperatureOffset - 32) * 5) / 9;

  const volts = raw.battery_mv / 1000;

  return withUnits({
    source: 'advertisement',
    awake: true,
    status,
    pressureBar: round(pressureBar, 3),
    temperatureC: round(temperatureC, 1),
    batteryVolts: round(volts, 3),
    batteryPercent: batteryPercentage(volts),
    raw,
    profile: profile.name,
  });
}

// Finds the 0x022B manufacturer-data element in a full advertisement (AD
// structures included) and decodes it.
export function decodeFullAdvertisement(payload, profile = PROFILES.default) {
  const n = payload.length;
  let i = 0;
  while (i < n) {
    const length = payload[i];
    if (length === 0 || i + 1 + length > n) break;
    const adType = payload[i + 1];
    if (adType === 0xff && length >= 3) {
      const body = payload.subarray(i + 2, i + 1 + length);
      if (body.length >= 2 && u16le(body, 0) === COMPANY_ID) {
        return decode(body.subarray(2), profile);
      }
    }
    i += 1 + length;
  }
  // Not a well-formed AD stream: hunt for the company-ID marker.
  for (let j = 0; j + 1 < n; j++) {
    if (payload[j] === 0x2b && payload[j + 1] === 0x02) {
      return decode(payload.subarray(j + 2), profile);
    }
  }
  return null;
}

// --- GATT TPData indication (characteristic 0213) -------------------------
// TPData { int32 pressure = 1; sint32 temperature = 2; }, usually nested
// inside outer messages. Pressure is absolute kPa, temperature whole degC.

function readVarint(data, i) {
  let shift = 0;
  let value = 0n;
  while (i < data.length) {
    const byte = data[i++];
    value |= BigInt(byte & 0x7f) << BigInt(shift);
    if (!(byte & 0x80)) return [value, i];
    shift += 7;
    if (shift > 63) return null;
  }
  return null;
}

function collectProtobuf(data) {
  const varints = new Map();
  const submessages = [];
  let i = 0;
  const n = data.length;
  while (i < n) {
    const key = readVarint(data, i);
    if (!key) break;
    const tag = Number(key[0]);
    i = key[1];
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      const got = readVarint(data, i);
      if (!got) break;
      varints.set(fieldNumber, got[0]);
      i = got[1];
    } else if (wireType === 2) {
      const got = readVarint(data, i);
      if (!got) break;
      const length = Number(got[0]);
      i = got[1];
      if (i + length > n) break;
      submessages.push(data.subarray(i, i + length));
      i += length;
    } else if (wireType === 5) {
      i += 4;
    } else if (wireType === 1) {
      i += 8;
    } else {
      break;
    }
  }
  return { varints, submessages };
}

function findTpdataFields(data, depth = 0) {
  if (depth > 5) return null;
  const { varints, submessages } = collectProtobuf(data);
  if (varints.has(1)) return [varints.get(1), varints.get(2) ?? null];
  for (const sub of submessages) {
    const found = findTpdataFields(sub, depth + 1);
    if (found) return found;
  }
  return null;
}

const unzigzag = (v) => Number((v >> 1n) ^ -(v & 1n));

export function decodeTpdata(payload) {
  const found = findTpdataFields(payload);
  if (!found) return null;
  const [pressureRawBig, temperatureRaw] = found;
  if (pressureRawBig < 0n || pressureRawBig > 100000n) return null;
  const pressureRaw = Number(pressureRawBig);

  const raw = { gatt_pressure: pressureRaw };
  let temperatureC = null;
  if (temperatureRaw != null) {
    temperatureC = unzigzag(temperatureRaw);
    raw.gatt_temperature = Number(temperatureRaw);
  }

  let pressureBar = (pressureRaw - ATMOSPHERE_KPA) / 100;
  if (pressureBar > -0.2 && pressureBar < 0) pressureBar = 0;

  return withUnits({
    source: 'gatt',
    awake: true,
    status: STATUS_AWAKE_MIN,
    pressureBar: round(pressureBar, 3),
    temperatureC,
    batteryVolts: null,
    batteryPercent: null,
    raw,
    profile: 'connection',
  });
}

// Decodes whatever was pasted: a full advertisement, bare manufacturer data
// (with or without the 2B 02 company ID), or a GATT TPData indication.
export function decodeAny(bytes, mode, profile = PROFILES.default) {
  if (mode === 'gatt') return decodeTpdata(bytes);
  if (mode === 'mfr') return decode(bytes, profile);
  return decodeFullAdvertisement(bytes, profile) ?? decode(bytes, profile);
}
