// IAPWS Ice Ih (2009 revision), equations 1-7; all inputs and outputs are SI.
const tripleTemperature = 273.16;
const triplePressure = 611.657;
const entropyConstant = -3327.33756492168;
const gCoefficients = [-632020.233335886, 0.655022213658955, -1.89369929326131e-8, 3.39746123271053e-15, -5.56464869058991e-22];
const t1 = [0.0368017112855051, 0.0510878114959572];
const t2 = [0.337315741065416, 0.335449415919309];
const r1 = [44.7050716285388, 65.6876847463481];
const r20 = [-72.597457432922, -78.100842711287];
const r21 = [-5.57107698030123e-5, 4.64578634580806e-5];
const r22 = [2.34801409215913e-11, -2.85651142904972e-11];
const add = ([a, b], [c, d]) => [a + c, b + d];
const scale = ([a, b], factor) => [a * factor, b * factor];
const multiply = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
const inverse = ([a, b]) => [a / (a * a + b * b), -b / (a * a + b * b)];
const logarithm = ([a, b]) => [Math.log(Math.hypot(a, b)), Math.atan2(b, a)];

function temperatureTerms(root, theta) {
  const minus = add(root, [-theta, 0]);
  const plus = add(root, [theta, 0]);
  const reciprocal = inverse(root);
  const value = add(
    add(multiply(minus, logarithm(minus)), multiply(plus, logarithm(plus))),
    add(scale(multiply(root, logarithm(root)), -2), scale(reciprocal, -theta * theta)),
  );
  const first = add(add(logarithm(plus), scale(logarithm(minus), -1)), scale(reciprocal, -2 * theta));
  const second = add(add(inverse(minus), inverse(plus)), scale(reciprocal, -2));
  return { value, first, second };
}

export function iceSublimationPressure(temperature) {
  if (!Number.isFinite(temperature) || temperature < 50 || temperature > tripleTemperature) {
    throw new RangeError("水冰昇華線溫度須介於 50 至 273.16 K。");
  }
  const theta = temperature / tripleTemperature;
  const sum = -21.2144006 * theta ** 0.00333333333
    + 27.3203819 * theta ** 1.20666667
    - 6.1059813 * theta ** 1.70333333;
  return triplePressure * Math.exp(sum / theta);
}

export function iceIhProperties(temperature, pressure) {
  if (!Number.isFinite(temperature) || temperature <= 0 || temperature > tripleTemperature
    || !Number.isFinite(pressure) || pressure <= 0 || pressure > 210e6) {
    throw new RangeError("Ice Ih 計算須在 0 < T ≤ 273.16 K、0 < P ≤ 210 MPa；僅用於一般冰的穩定區。");
  }
  const theta = temperature / tripleTemperature;
  const pi = (pressure - 101325) / triplePressure;
  let g0 = 0;
  let g0P = 0;
  let g0PP = 0;
  for (let index = 0; index < gCoefficients.length; index += 1) {
    g0 += gCoefficients[index] * pi ** index;
    if (index >= 1) g0P += index * gCoefficients[index] * pi ** (index - 1) / triplePressure;
    if (index >= 2) g0PP += index * (index - 1) * gCoefficients[index] * pi ** (index - 2) / triplePressure ** 2;
  }
  const r2 = add(add(r20, scale(r21, pi)), scale(r22, pi * pi));
  const r2P = scale(add(r21, scale(r22, 2 * pi)), 1 / triplePressure);
  const r2PP = scale(r22, 2 / triplePressure ** 2);
  const first = temperatureTerms(t1, theta);
  const second = temperatureTerms(t2, theta);
  const realSum = (key) => multiply(r1, first[key])[0] + multiply(r2, second[key])[0];
  const g = g0 - entropyConstant * temperature + tripleTemperature * realSum("value");
  const gT = -entropyConstant + realSum("first");
  const gTT = realSum("second") / tripleTemperature;
  const gP = g0P + tripleTemperature * multiply(r2P, second.value)[0];
  const gPP = g0PP + tripleTemperature * multiply(r2PP, second.value)[0];
  const gTP = multiply(r2P, second.first)[0];
  const h = g - temperature * gT;
  const cp = -temperature * gTT;
  const properties = {
    rho: 1 / gP, v: gP, h, s: -gT, u: h - pressure * gP,
    cp, cv: cp + temperature * gTP ** 2 / gPP,
  };
  if (Object.values(properties).some((value) => !Number.isFinite(value))
    || properties.rho <= 0 || properties.cp <= 0 || properties.cv <= 0 || gPP >= 0) {
    throw new Error("無法取得有效的 Ice Ih 性質。");
  }
  return properties;
}
