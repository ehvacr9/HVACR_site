import initCoolProp from "../assets/coolprop/coolprop.js";
import {
  waterMeltingBranches, waterMeltingPressure, validateWaterFluidState,
  waterViscosityInRange,
} from "../assets/water-phase-boundaries.js";

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
    let error;
    try { action(); } catch (caught) { error = caught; }
    assert(error instanceof RangeError, label);
  }
  const coolprop = await initCoolProp();
  const props = (output, key1 = "", value1 = 0, key2 = "", value2 = 0) => coolprop.PropsSI(output, key1, value1, key2, value2, "Water");
  const melting = coolprop.factory("HEOS", "Water");
  const parameters = coolprop.parameters;
  const meltingPressure = (temperature) => melting.melting_line(parameters.iP.value, parameters.iT.value, temperature);
  // IAPWS R14-08(2011), Table 3; rounded published pressures in MPa.
  for (const [ice, temperature, pressure] of [
    ["Ih", 260, 138.268], ["III", 254, 268.685], ["V", 265, 479.640],
    ["VI", 320, 1356.76], ["VII", 550, 6308.71],
  ]) {
    close(waterMeltingPressure(temperature, ice) / 1e6, pressure, 5e-6, 0, `Published melting check ice ${ice}`);
  }
  let allMeltingLineStates = 0;
  for (const branch of waterMeltingBranches) {
    let previousPressure = branch.id === "Ih" ? Infinity : 0;
    for (let index = 0; index <= 100; index += 1) {
      const temperature = index === 100 ? branch.temperatureMax
        : branch.temperatureMin + (branch.temperatureMax - branch.temperatureMin) * index / 100;
      const pressure = waterMeltingPressure(temperature, branch.id);
      assert(Number.isFinite(pressure) && pressure > 0
        && (branch.id === "Ih" ? pressure < previousPressure : pressure > previousPressure),
      `Solid boundary monotonic ${branch.id} ${index}`);
      previousPressure = pressure;
      if (branch.id === "Ih") close(pressure, meltingPressure(temperature), 1e-12, 1e-5, `Ih matches CoolProp ${index}`);
      if (branch.id !== "Ih" && temperature >= 273.16 && pressure * 1.001 <= 1e9) {
        validateWaterFluidState(temperature, pressure * 0.999);
        assert(true, `Accept fluid side of solid boundary ${branch.id} ${index}`);
        rejects(() => validateWaterFluidState(temperature, pressure * 1.001),
          `Reject solid side of boundary ${branch.id} ${index}`);
      }
      allMeltingLineStates += 1;
    }
    for (const temperature of [branch.temperatureMin - 0.001, branch.temperatureMax + 0.001, NaN, Infinity]) {
      rejects(() => waterMeltingPressure(temperature, branch.id), `Melting domain ${branch.id} ${temperature}`);
    }
  }
  rejects(() => waterMeltingPressure(300, "unknown"), "Reject unknown ice phase");
  for (const [temperature, pressure] of [[273.159, 1e5], [1273.001, 1e5], [300, 1e9 + 1],
    [300, 0], [300, Infinity], [NaN, 1e5], [280, 1e9]]) {
    rejects(() => validateWaterFluidState(temperature, pressure), `Reject invalid or solid water state ${temperature}, ${pressure}`);
  }
  for (const [temperature, pressure] of [[273.16, 1e5], [320, 1e9], [1273, 1e9], [500, 1e-5]]) {
    validateWaterFluidState(temperature, pressure);
    assert(true, `Accept stable fluid water state ${temperature}, ${pressure}`);
  }
  for (const [pressure, maximum] of [[300e6, 1173.15], [350e6, 873.15], [500e6, 433.15], [1e9, 373.15]]) {
    assert(waterViscosityInRange(maximum, pressure), `Viscosity upper endpoint ${pressure}`);
    assert(!waterViscosityInRange(maximum + 0.001, pressure), `Reject viscosity extrapolation ${pressure}`);
  }
  // IAPWS-95 (2018), Table 7. These are published T-rho reference points, not round trips.
  const singlePhaseReferences = [
    [300, 996.5560, 0.0992418352, 4.13018112, 0.393062643],
    [300, 1005.308, 20.0022515, 4.06798347, 0.387405401],
    [300, 1188.202, 700.004704, 3.46135580, 0.132609616],
    [500, 0.435, 0.0999679423, 1.50817541, 7.94488271],
    [500, 4.532, 0.999938125, 1.66991025, 6.82502725],
    [500, 838.025, 10.0003858, 3.22106219, 2.56690919],
    [500, 1084.564, 700.000405, 3.07437693, 2.03237509],
    [647, 358, 22.0384756, 6.18315728, 4.32092307],
    [900, 0.241, 0.100062559, 1.75890657, 9.16653194],
    [900, 52.615, 20.0000690, 1.93510526, 6.59070225],
    [900, 870.769, 700.000006, 2.66422350, 4.17223802],
  ];
  for (const [temperature, density, pressure, cv, entropy] of singlePhaseReferences) {
    close(props("P", "T", temperature, "D", density) / 1e6, pressure, 2e-8, 1e-7, `IAPWS-95 table 7 pressure ${temperature}/${density}`);
    close(props("O", "T", temperature, "D", density) / 1000, cv, 2e-8, 1e-8, `IAPWS-95 table 7 cv ${temperature}/${density}`);
    close(props("S", "T", temperature, "D", density) / 1000, entropy, 2e-8, 1e-8, `IAPWS-95 table 7 entropy ${temperature}/${density}`);
  }
  // IAPWS-95 (2018), Table 8: vapor pressure, liquid/vapor density, enthalpy and entropy.
  const saturationReferences = [
    [275, 0.000698451167, 999.887406, 0.00550664919, 7.75972202, 2504.28995, 0.0283094670, 9.10660121],
    [450, 0.932203564, 890.341250, 4.81200360, 749.161585, 2774.41078, 2.10865845, 6.60921221],
    [625, 16.9082693, 567.090385, 118.290280, 1686.26976, 2550.71625, 3.80194683, 5.18506121],
  ];
  for (const [temperature, pressure, liquidDensity, vaporDensity, liquidH, vaporH, liquidS, vaporS] of saturationReferences) {
    close(props("P", "T", temperature, "Q", 0) / 1e6, pressure, 1e-8, 0, `Published vapor pressure ${temperature}`);
    for (const [quality, density, enthalpy, entropy] of [[0, liquidDensity, liquidH, liquidS], [1, vaporDensity, vaporH, vaporS]]) {
      close(props("D", "T", temperature, "Q", quality), density, 1e-8, 0, `Published saturated density ${temperature}/${quality}`);
      close(props("H", "T", temperature, "Q", quality) / 1000, enthalpy, 1e-8, 0, `Published saturated enthalpy ${temperature}/${quality}`);
      close(props("S", "T", temperature, "Q", quality) / 1000, entropy, 1e-8, 0, `Published saturated entropy ${temperature}/${quality}`);
    }
  }
  // IAPWS viscosity (2008), Table 4, away from critical enhancement.
  for (const [temperature, density, viscosity] of [
    [298.15, 998, 889.735100], [298.15, 1200, 1437.649467], [373.15, 1000, 307.883622],
    [433.15, 1, 14.538324], [433.15, 1000, 217.685358], [873.15, 1, 32.619287],
    [873.15, 100, 35.802262], [873.15, 600, 77.430195], [1173.15, 1, 44.217245],
    [1173.15, 100, 47.640433], [1173.15, 400, 64.154608],
  ]) {
    close(props("V", "T", temperature, "D", density) * 1e6, viscosity, 1e-7, 1e-6, `Published viscosity ${temperature}/${density}`);
  }
  let saturationStates = 0;
  let previousVaporPressure = 0;
  for (let index = 0; index <= 120; index += 1) {
    const temperature = 273.16 + (647.096 - 0.001 - 273.16) * index / 120;
    const pressure = props("P", "T", temperature, "Q", 0);
    assert(pressure > previousVaporPressure, `Vapor pressure monotonic ${index}`);
    close(props("T", "P", pressure, "Q", 0), temperature, 0, 1e-7, `VLE T-P-T ${index}`);
    const endpoints = [0, 1].map((quality) => Object.fromEntries(["D", "H", "S", "U", "C", "O", "V"]
      .map((output) => [output, props(output, "T", temperature, "Q", quality)])));
    for (const endpoint of endpoints) {
      assert(Object.values(endpoint).every(Number.isFinite), `Complete finite saturated properties ${index}`);
      assert(endpoint.D > 0 && endpoint.C > 0 && endpoint.O > 0 && endpoint.V > 0, `Physical saturated properties ${index}`);
      close(endpoint.H - endpoint.U, pressure / endpoint.D, 1e-7, 1e-5, `h = u + Pv ${index}`);
    }
    for (const quality of [0.25, 0.5, 0.75]) {
      const mix = (key) => (1 - quality) * endpoints[0][key] + quality * endpoints[1][key];
      close(props("H", "P", pressure, "Q", quality), mix("H"), 1e-8, 1e-3, `Mixture enthalpy ${index}/${quality}`);
      close(props("S", "P", pressure, "Q", quality), mix("S"), 1e-8, 1e-5, `Mixture entropy ${index}/${quality}`);
      close(props("U", "P", pressure, "Q", quality), mix("U"), 1e-8, 1e-3, `Mixture internal energy ${index}/${quality}`);
      close(1 / props("D", "P", pressure, "Q", quality),
        (1 - quality) / endpoints[0].D + quality / endpoints[1].D, 1e-8, 1e-10, `Mixture volume ${index}/${quality}`);
    }
    previousVaporPressure = pressure;
    saturationStates += 1;
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
  assert(props("Tmin") === 273.16, "CoolProp fluid lower bound");
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
  return { status: "PASS", checks, engine: "CoolProp / IAPWS-95 + solid-region validation (2011)",
    allMeltingLineStates, saturationStates, publishedSinglePhaseStates: singlePhaseReferences.length,
    publishedSaturationStates: saturationReferences.length, flashPairs,
    unsupportedFlashPairs: unsupported.size };
}
