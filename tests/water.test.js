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
  const coolprop = await initCoolProp();
  const props = (output, key1 = "", value1 = 0, key2 = "", value2 = 0) => coolprop.PropsSI(output, key1, value1, key2, value2, "Water");
  const melting = coolprop.factory("HEOS", "Water");
  const parameters = coolprop.parameters;
  const meltingPressure = (temperature) => melting.melting_line(parameters.iP.value, parameters.iT.value, temperature);
  close(meltingPressure(251.165), 208566566.03297672, 1e-12, 1e-4, "Ice Ih melting low endpoint");
  close(meltingPressure(273.16), 611.657, 1e-12, 1e-8, "Ice Ih melting high endpoint");
  let previousPressure = Infinity;
  for (let index = 0; index <= 400; index += 1) {
    const temperature = index === 400 ? 273.16 : 251.165 + (273.16 - 251.165) * index / 400;
    const pressure = meltingPressure(temperature);
    assert(Number.isFinite(pressure) && pressure > 0 && pressure < previousPressure,
      `CoolProp Ice Ih pressure decreases with temperature ${index}`);
    previousPressure = pressure;
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
  return { status: "PASS", checks, engine: "CoolProp", meltingLineStates: 401, flashPairs, unsupportedFlashPairs: unsupported.size };
}
