import { iceIhProperties, iceSublimationPressure } from "../assets/water-ice.js";
import initCoolProp from "../assets/coolprop/coolprop.js";

export async function runWaterTests() {
  let checks = 0;
  function assert(condition, label) {
    checks += 1;
    if (!condition) throw new Error(`FAIL: ${label}`);
  }
  function close(actual, expected, relative, absolute, label) {
    assert(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(absolute, relative * Math.abs(expected)),
      `${label}: ${actual} vs ${expected}`);
  }
  function rejects(action, label) {
    let failed = false;
    try { action(); } catch (error) { failed = error instanceof RangeError; }
    assert(failed, label);
  }

  // IAPWS Ice-2009, Table 6 (SI), not a comparison against another implementation.
  const referenceStates = [
    [273.16, 611.657, { rho: 916.709492200, v: .00109085812737, h: -333444.253966, u: -333444.921197, s: -1220.69433940, cp: 2096.78431622 }],
    [273.152519, 101325, { rho: 916.721463419, v: .00109084388214, h: -333354.873637, u: -333465.403393, s: -1220.76932550, cp: 2096.71391024 }],
    [100, 100e6, { rho: 941.678203297, v: .00106193389260, h: -483491.635676, u: -589685.024936, s: -2611.95122589, cp: 866.333195517 }],
  ];
  for (const [temperature, pressure, expected] of referenceStates) {
    const state = iceIhProperties(temperature, pressure);
    for (const [key, value] of Object.entries(expected)) {
      close(state[key], value, 6e-11, 1e-13, `Ice Table 6 ${temperature} K ${key}`);
    }
  }
  const triple = iceIhProperties(273.16, 611.657);
  const gPP = -1.28495941571e-13;
  const gTP = 1.74387964700e-7;
  close(triple.cv, triple.cp + 273.16 * gTP ** 2 / gPP, 1e-11, 1e-7, "Ice cv from Table 6 derivatives");
  for (const [temperature, pressure] of [[50, 1e-40], [230, 9], [260, 100e6]]) {
    const state = iceIhProperties(temperature, pressure);
    const increment = .001;
    const low = iceIhProperties(temperature - increment, pressure);
    const high = iceIhProperties(temperature + increment, pressure);
    close((high.h - low.h) / (2 * increment), state.cp, 2e-8, 1e-5, "cp = dh/dT");
    close((high.s - low.s) * temperature / (2 * increment), state.cp, 2e-8, 1e-5, "cp = T ds/dT");
  }
  for (const [temperature, pressure] of [[0, 1], [-1, 1], [273.17, 611], [250, 0], [250, -1], [250, 211e6], [NaN, 1], [250, Infinity]]) {
    rejects(() => iceIhProperties(temperature, pressure), "Reject ice out of domain");
  }
  for (const temperature of [49.999, 273.1601, NaN, Infinity]) {
    rejects(() => iceSublimationPressure(temperature), "Reject sublimation out of domain");
  }
  close(iceSublimationPressure(50), 1.9349584868088946e-40, 1e-12, 0, "Sublimation 50 K");
  close(iceSublimationPressure(230), 8.947352740189151, 1e-12, 0, "Sublimation 230 K");
  close(iceSublimationPressure(273.16), 611.657, 1e-12, 0, "Sublimation triple endpoint");

  const coolprop = await initCoolProp();
  const props = (output, key1 = "", value1 = 0, key2 = "", value2 = 0) => coolprop.PropsSI(output, key1, value1, key2, value2, "Water");
  const melting = coolprop.factory("HEOS", "Water");
  const parameters = coolprop.parameters;
  const meltingPressure = (temperature) => melting.melting_line(parameters.iP.value, parameters.iT.value, temperature);
  close(meltingPressure(251.165), 208566566.03297672, 1e-12, 1e-4, "Ice Ih melting low endpoint");
  close(meltingPressure(273.16), 611.657, 1e-12, 1e-8, "Ice Ih melting high endpoint");
  for (const line of ["melt", "sublimation"]) {
    for (let index = 0; index <= 400; index += 1) {
      const low = line === "melt" ? 251.165 : 50;
      const temperature = index === 400 ? 273.16 : low + (273.16 - low) * index / 400;
      const pressure = line === "melt" ? meltingPressure(temperature) : iceSublimationPressure(temperature);
      const state = iceIhProperties(temperature, pressure);
      assert(Object.values(state).every(Number.isFinite), `${line} finite properties ${index}`);
      assert(state.rho > 0 && state.cv > 0 && state.cp >= state.cv, `${line} positive response ${index}`);
      close(state.rho * state.v, 1, 1e-13, 0, `${line} density reciprocal`);
      close(state.h - pressure * state.v, state.u, 1e-13, 1e-9, `${line} h = u + pv`);
    }
  }

  close(props("Tcrit"), 647.096, 1e-10, 1e-6, "Water critical temperature");
  close(props("pcrit"), 22064000, 1e-9, 1, "Water critical pressure");
  close(props("rhomass_critical"), 322, 1e-9, 1e-5, "Water critical density");
  close(props("T", "P", 101325, "Q", 0), 373.124295848, 1e-9, 1e-6, "Normal boiling temperature");
  close(props("D", "T", 300, "P", 101325), 996.556935265, 1e-9, 1e-6, "Liquid density");
  close(props("H", "T", 300, "P", 101325), 112654.899655, 1e-8, .01, "Liquid enthalpy SI");
  close(props("V", "T", 300, "P", 101325), .000853742486286, 1e-8, 1e-11, "Liquid viscosity SI");
  close(props("U", "T", 273.16, "Q", 0), 0, 0, 1e-3, "Liquid internal energy reference");
  close(props("S", "T", 273.16, "Q", 0), 0, 0, 1e-5, "Liquid entropy reference");
  close(props("H", "T", 700, "P", 30e6), 2631439.82364, 1e-8, .1, "Supercritical water");
  assert(props("Phase", "T", 300, "P", 101325) === 0, "Liquid phase");
  assert(props("Phase", "T", 500, "P", 101325) === 5, "Vapor phase");
  assert(props("Phase", "P", 101325, "Q", .5) === 6, "Two-phase state");
  assert(props("Phase", "T", 700, "P", 30e6) === 1, "Supercritical phase");
  assert(props("Tmin") === 273.16, "Fluid lower bound used by solid tables");

  for (const phase of ["liquid", "gas"]) {
    for (const output of ["D", "H", "S", "U", "C", "O", "V"]) {
      assert(Number.isFinite(props(output, `T|${phase}`, 273.16, "P", 611.657)), `Triple-point coexisting ${phase} ${output}`);
    }
  }
  for (const quality of [0, 1]) {
    for (const output of ["T", "P", "D", "H", "S", "U", "C", "O", "V"]) {
      assert(Number.isFinite(props(output, "P", 101325, "Q", quality)), `VLE endpoint ${quality} ${output}`);
    }
  }
  const keys = ["T", "P", "D", "H", "S", "U", "Q"];
  const unsupported = new Set(["TH", "TU", "HU", "HQ", "SU", "SQ", "UQ"]);
  let flashPairs = 0;
  for (let first = 0; first < keys.length; first += 1) {
    for (let second = first + 1; second < keys.length; second += 1) {
      const one = keys[first];
      const two = keys[second];
      const saturated = two === "Q";
      const reference = Object.fromEntries(keys.slice(0, -1).map((key) =>
        [key, saturated ? props(key, "P", 101325, "Q", .5) : props(key, "T", 500, "P", 101325)]));
      reference.Q = .5;
      if (unsupported.has(one + two)) {
        let phase;
        try { phase = props("Phase", one, reference[one], two, reference[two]); } catch { phase = NaN; }
        assert(!Number.isFinite(phase), `Reject unsupported flash ${one}${two}`);
      } else {
        close(props("T", one, reference[one], two, reference[two]), reference.T, 1e-6, .002, `Flash ${one}${two} T`);
        close(props("P", one, reference[one], two, reference[two]), reference.P, 1e-5, 2, `Flash ${one}${two} P`);
        flashPairs += 1;
      }
    }
  }
  return { status: "PASS", checks, iceReferenceStates: 3, solidLineStates: 802, flashPairs, unsupportedFlashPairs: unsupported.size };
}
