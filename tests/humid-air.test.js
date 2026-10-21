import initCoolProp from "../assets/coolprop/coolprop.js";
import { calculateHumidAir, humidAirProperties } from "../assets/humid-air.js";

export async function runHumidAirTests() {
  const cp = await initCoolProp();
  let checks = 0;
  const assert = (condition, label) => {
    checks += 1;
    if (!condition) throw new Error(`FAIL: ${label}`);
  };
  const close = (actual, expected, label, tolerance = 1e-6) => assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * tolerance),
    `${label}: ${actual} vs ${expected}`);
  const base = { pressure: 101.325, key1: "T", value1: 25, key2: "R", value2: 50 };
  const reject = (input, label) => {
    let error;
    try { calculateHumidAir(cp, input); } catch (caught) { error = caught; }
    assert(error instanceof RangeError && error.message.length > 0, label);
  };
  const reference = calculateHumidAir(cp, base);
  close(reference.values.W, .009925739296161223, "25 C / 50% humidity ratio");
  close(reference.values.H, 50423.45039075701, "25 C / 50% enthalpy");
  close(reference.values.B, 291.033486810309, "25 C / 50% wet bulb");
  close(reference.values.D, 287.0168866488805, "25 C / 50% dew point");
  close(reference.values.V, .8577882434265997, "25 C / 50% dry-air specific volume");
  const vaporPressure = .5 * .61094 * Math.exp(17.625 * 25 / (25 + 243.04));
  const idealW = .621945 * vaporPressure / (101.325 - vaporPressure);
  close(reference.values.W, idealW, "Independent ideal psychrometric humidity check", .01);
  close(reference.values.H / 1000, 1.006 * 25 + idealW * (2501 + 1.86 * 25),
    "Independent ideal psychrometric enthalpy check", .01);
  const keys = Object.keys(humidAirProperties);
  let supportedPairs = 0;
  let rejectedPairs = 0;
  for (const [pressure, temperature, relativeHumidity] of [
    [101.325, 25, 50], [80, 30, 70], [150, 10, 90], [101.325, -10, 60],
  ]) {
    const state = calculateHumidAir(cp, { ...base, pressure, value1: temperature, value2: relativeHumidity });
    for (const [i, key1] of keys.entries()) for (const key2 of keys.slice(i + 1)) {
      const input = {
        pressure, key1, key2,
        value1: humidAirProperties[key1].fromSI(state.values[key1]),
        value2: humidAirProperties[key2].fromSI(state.values[key2]),
      };
      const pair = [key1, key2].sort().join("-");
      if (["B-H", "B-V", "D-W", "H-V"].includes(pair)) {
        reject(input, `${pressure}/${temperature}: explicit rejection ${pair}`);
        rejectedPairs += 1;
      } else {
        const solved = calculateHumidAir(cp, input);
        close(solved.values.T, state.values.T, `${pressure}/${temperature}: ${pair} temperature`, 1e-5);
        close(solved.values.W, state.values.W, `${pressure}/${temperature}: ${pair} humidity`, 1e-5);
        const reversed = calculateHumidAir(cp, {
          pressure, key1: key2, value1: input.value2, key2: key1, value2: input.value1,
        });
        close(reversed.values.T, solved.values.T, `${pressure}/${temperature}: reversed ${pair}`, 1e-5);
        supportedPairs += 1;
      }
    }
  }
  const saturated = calculateHumidAir(cp, { ...base, value2: 100 });
  close(saturated.values.T, saturated.values.B, "Saturated wet bulb");
  close(saturated.values.T, saturated.values.D, "Saturated dew point");
  const dry = calculateHumidAir(cp, { ...base, value2: 0 });
  assert(dry.values.D === null && dry.values.W === 0, "Dry air does not display numerical pseudo dew point");
  for (const patch of [
    { key2: "T" }, { key1: "invalid" }, { pressure: 0 }, { pressure: 10001 },
    { value1: NaN }, { value2: -1 }, { value2: 101 }, { value1: 351 }, { value1: -144 },
    { key2: "W", value2: -1 }, { key2: "V", value2: 0 }, { key2: "D", value2: 30 },
    { key2: "B", value2: 30 },
  ]) reject({ ...base, ...patch }, `Invalid input ${JSON.stringify(patch)}`);
  const frame = document.createElement("iframe");
  frame.title = "Humid air integration tests";
  frame.style.cssText = "position:fixed;left:-10000px;width:1100px;height:1000px";
  frame.src = "../humid-air.html";
  document.body.append(frame);
  const wait = async (predicate) => {
    const deadline = Date.now() + 60000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("Humid air UI timeout");
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  try {
    await wait(() => frame.contentDocument?.querySelector("#humid-air-inputs")?.disabled === false);
    const doc = frame.contentDocument;
    const q = (selector) => doc.querySelector(selector);
    const submit = async () => {
      q("#humid-air-form").requestSubmit();
      assert(q("#status").dataset.kind === "loading", "Immediate loading spinner");
      await wait(() => !q("#humid-air-form").hasAttribute("aria-busy"));
    };
    assert(q("#pressure").value === "101.325", "Default pressure in kPa");
    assert(q("#property-one").options.length === 7 && q("#property-two").options.length === 7, "Both selectors offer all properties");
    await submit();
    assert(q("#status").dataset.kind === "success" && !q("#results").hidden, "Default state solves");
    assert(q("#metrics").children.length === 7, "Seven results displayed");
    assert(q('[data-property="H"]').textContent.includes("50.4235 kJ/kg"), "Enthalpy SI conversion");
    q("#pressure").value = "80";
    q("#pressure").dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
    assert(!q("#results").hidden && q("#status").textContent.includes("上次結果"), "Input edit preserves previous results with warning");
    await submit();
    assert(q("#pressure-summary").textContent.includes("80 kPa"), "Changed pressure applied");
    const select = (id, key) => {
      q(id).value = key;
      q(id).dispatchEvent(new frame.contentWindow.Event("change", { bubbles: true }));
    };
    select("#property-one", "H");
    assert(q("#value-one").value === "" && q("#label-one").textContent.includes("kJ/kg"), "Property change clears value and updates units");
    q("#value-one").value = String(reference.values.H / 1000);
    q("#pressure").value = "101.325";
    await submit();
    assert(q("#status").dataset.kind === "success", "Non-temperature pair solves in UI");
    select("#property-one", "D");
    select("#property-two", "W");
    q("#value-one").value = "10";
    q("#value-two").value = ".01";
    await submit();
    assert(q("#status").dataset.kind === "error" && q("#status").textContent.includes("不是獨立性質")
      && q("#results").hidden && q("#metrics").children.length === 0, "Dependent pair warning clears invalid results");
    select("#property-one", "T");
    select("#property-two", "R");
    q("#value-one").value = "25";
    q("#value-two").value = "0";
    await submit();
    assert(q("#status").dataset.kind === "success" && q('[data-property="D"]').textContent.includes("乾空氣無露點"), "Recovery and dry-air display");
    for (const width of [320, 768, 1440]) {
      frame.style.width = `${width}px`;
      await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve));
      assert(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth, `No page overflow ${width}`);
      const bounds = (selector) => q(selector).getBoundingClientRect();
      const pressure = bounds("#pressure");
      const one = bounds("#property-one");
      const firstValue = bounds("#value-one");
      const two = bounds("#property-two");
      const secondValue = bounds("#value-two");
      assert(pressure.bottom < one.top, `Pressure has its own row ${width}`);
      if (width > 520) {
        close(one.top, firstValue.top, `First property and input aligned ${width}`);
        close(two.top, secondValue.top, `Second property and input aligned ${width}`);
        close(one.left, two.left, `Property column aligned ${width}`);
        close(firstValue.left, secondValue.left, `Value column aligned ${width}`);
        close(one.height, firstValue.height, `Control heights aligned ${width}`);
      } else {
        assert(one.bottom < firstValue.top && firstValue.bottom < two.top && two.bottom < secondValue.top,
          "Mobile preserves property/value reading order");
      }
      for (const key of Object.keys(humidAirProperties)) {
        select("#property-one", key);
        await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve));
        assert(bounds("#value-one").right <= doc.documentElement.clientWidth,
          `${key} label and control remain within viewport ${width}`);
      }
    }
  } finally { frame.remove(); }
  return { status: "PASS", checks, supportedPairStates: supportedPairs, rejectedPairStates: rejectedPairs };
}
