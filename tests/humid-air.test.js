import initCoolProp from "../assets/coolprop/coolprop.js";
import { calculateHumidAir, humidAirProperties } from "../assets/humid-air.js";
import { createPsychrometricChart } from "../assets/humid-air-chart.js";

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
  const chart = createPsychrometricChart(cp);
  assert(chart.svg.getAttribute("viewBox") === "0 0 1000 670", "Psychrometric Chart No. 1 SVG bounds");
  assert(chart.svg.querySelectorAll(".psychrometric-rh").length === 10, "Ten relative-humidity curves");
  const wetBulbCurves = [...chart.svg.querySelectorAll(".psychrometric-wet-bulb")];
  assert(wetBulbCurves.length === 41
    && wetBulbCurves.map((curve) => Number(curve.dataset.wetBulb)).join(",")
      === Array.from({ length: 41 }, (_, index) => index - 6).join(","),
  "Wet-bulb curves span -6 to 34 C at 1 C intervals");
  for (const curve of wetBulbCurves) {
    const wetBulb = Number(curve.dataset.wetBulb);
    const firstPoint = curve.getAttribute("d").match(/^M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    assert(firstPoint, `Wet-bulb ${wetBulb}: continuous path begins at plot boundary`);
    const [x, y] = firstPoint.slice(1).map(Number);
    if (wetBulb < 0) close(x, 88, `Wet-bulb ${wetBulb}: clipped at left plot edge`);
    else if (wetBulb <= 31) close(x, 88 + wetBulb / 50 * 850, `Wet-bulb ${wetBulb}: saturated start temperature`);
    else close(y, 28, `Wet-bulb ${wetBulb}: clipped at saturation humidity limit`);
  }
  assert(chart.svg.querySelectorAll(".psychrometric-enthalpy").length > 0, "Enthalpy curves");
  assert(chart.svg.querySelectorAll(".psychrometric-volume").length > 0
    && chart.svg.querySelectorAll(".psychrometric-volume-label").length > 0, "Specific-volume curves and labels");
  const volumeLabels = [...chart.svg.querySelectorAll(".psychrometric-volume-label")].map((label) => label.textContent);
  const volumeCurves = [...chart.svg.querySelectorAll(".psychrometric-volume")];
  assert(volumeCurves.length === 18 && volumeLabels.includes("0.78") && volumeLabels.includes("0.94")
    && !["0.79", "0.81", "0.83", "0.85", "0.87", "0.89", "0.91", "0.93", "0.95"]
      .some((label) => volumeLabels.includes(label)),
  "Specific-volume lines from 0.78 to 0.95 render with labels on even values only");
  assert(chart.svg.querySelector(".psychrometric-axes").textContent.includes("濕度比 (g/kg 乾空氣)"),
    "Vertical axis is named humidity ratio");
  for (const curve of volumeCurves) {
    const specificVolume = Number(curve.dataset.specificVolume);
    const saturationTemperatureK = Number(curve.dataset.saturationTemperatureK);
    const saturationTemperatureC = Number(curve.dataset.saturationTemperatureC);
    const saturationHumidity = Number(curve.dataset.saturationHumidity);
    const dryAirTemperatureK = Number(curve.dataset.dryAirTemperatureK);
    const dryAirTemperatureC = Number(curve.dataset.dryAirTemperatureC);
    close(cp.HAPropsSI("W", "P", 101325, "T", saturationTemperatureK,
      "R", 1), saturationHumidity, `Specific volume ${specificVolume}: saturated endpoint humidity`);
    close(cp.HAPropsSI("V", "P", 101325, "T", saturationTemperatureK,
      "R", 1), specificVolume, `Specific volume ${specificVolume}: saturation-line volume`);
    close(cp.HAPropsSI("T", "P", 101325, "V", specificVolume,
      "W", 0), dryAirTemperatureK, `Specific volume ${specificVolume}: dry-air endpoint temperature`);
    const coordinates = curve.getAttribute("d").match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g);
    assert(coordinates?.length >= 5, `Specific volume ${specificVolume}: visible continuous curve`);
    const first = coordinates[0].split(",").map(Number);
    const last = coordinates.at(-1).split(",").map(Number);
    if (saturationHumidity <= .03) {
      assert(Math.abs(first[0] - (88 + saturationTemperatureC / 50 * 850)) < .01,
        `Specific volume ${specificVolume}: saturation endpoint x`);
      assert(Math.abs(first[1] - (28 + 520 - saturationHumidity / .03 * 520)) < .01,
        `Specific volume ${specificVolume}: saturation endpoint y`);
    } else {
      close(first[1], 28, `Specific volume ${specificVolume}: clipped at chart humidity limit`);
    }
    if (dryAirTemperatureC <= 50) {
      assert(Math.abs(last[0] - (88 + dryAirTemperatureC / 50 * 850)) < .01,
        `Specific volume ${specificVolume}: dry-air endpoint x`);
      close(last[1], 548, `Specific volume ${specificVolume}: zero-humidity endpoint y`);
    } else {
      close(last[0], 938, `Specific volume ${specificVolume}: clipped at chart temperature limit`);
    }
    assert(first[1] < last[1], `Specific volume ${specificVolume}: line extends from saturation to dry-air axis`);
  }
  const rotatedVolumeLabels = [...chart.svg.querySelectorAll(".psychrometric-volume-label")];
  assert(rotatedVolumeLabels.every((label) => /^rotate\(-?\d/.test(label.getAttribute("transform"))
    && !/^rotate\(0(?:\.00)? /.test(label.getAttribute("transform"))),
  "Specific-volume labels are rotated parallel to their curves");
  assert(chart.setState({ pressure: 101.325, temperature: 25, humidityRatio: reference.values.W }),
    "Chart plots standard-pressure state point");
  const hoverState = chart.readPoint(25, reference.values.W);
  close(hoverState.temperature, 25, "Chart hover dry-bulb temperature");
  close(hoverState.relativeHumidity, .5, "Chart hover relative humidity");
  close(hoverState.humidityRatio, reference.values.W, "Chart hover humidity ratio");
  assert(chart.readPoint(25, .03)?.valid === false, "Chart hover rejects supersaturated coordinates");
  assert(chart.readPoint(25, 0)?.valid === true, "Chart hover reads dry-air coordinates");
  assert(!chart.setState({ pressure: 80, temperature: 25, humidityRatio: reference.values.W }),
    "Chart does not plot a non-standard-pressure state point");
  assert(!chart.setState(null), "Chart clears an absent state point");
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
    assert(!q("#psychrometric-chart-section").hidden
      && q("#psychrometric-chart svg").querySelectorAll(".psychrometric-rh").length === 10,
    "ASHRAE chart renders with relative-humidity curves");
    const svg = q("#psychrometric-chart svg");
    const wetBulbDash = frame.contentWindow.getComputedStyle(svg.querySelector(".psychrometric-wet-bulb")).strokeDasharray;
    const enthalpyDash = frame.contentWindow.getComputedStyle(svg.querySelector(".psychrometric-enthalpy")).strokeDasharray;
    assert(wetBulbDash !== "none" && enthalpyDash === "none",
      "Wet-bulb curves are dashed and enthalpy curves are solid");
    assert(q("#property-one").options.length === 7 && q("#property-two").options.length === 7, "Both selectors offer all properties");
    await submit();
    assert(q("#status").dataset.kind === "success" && !q("#results").hidden, "Default state solves");
    assert(!q(".psychrometric-state-marker").hasAttribute("hidden"), "Successful state is marked on chart");
    const bounds = svg.getBoundingClientRect();
    const pointerX = bounds.left + (88 + 25 / 50 * 850) / 1000 * bounds.width;
    const pointerY = bounds.top + (28 + 520 - reference.values.W / .03 * 520) / 670 * bounds.height;
    svg.dispatchEvent(new frame.contentWindow.PointerEvent("pointermove", {
      clientX: pointerX, clientY: pointerY, bubbles: true,
    }));
    assert(q("#chart-readout").textContent.includes("乾球 25")
      && q("#chart-readout").textContent.includes("相對濕度 50"),
    "Moving pointer inside chart reports psychrometric properties");
    svg.dispatchEvent(new frame.contentWindow.PointerEvent("pointerleave", { bubbles: true }));
    assert(q("#chart-readout").textContent.includes("移動滑鼠"), "Pointer leaving chart resets readout");
    assert(q("#metrics").children.length === 7, "Seven results displayed");
    assert(q('[data-property="H"]').textContent.includes("50.4235 kJ/kg"), "Enthalpy SI conversion");
    q("#pressure").value = "80";
    q("#pressure").dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
    assert(!q("#results").hidden && q("#status").textContent.includes("上次結果"), "Input edit preserves previous results with warning");
    await submit();
    assert(q("#pressure-summary").textContent.includes("80 kPa"), "Changed pressure applied");
    assert(q(".psychrometric-state-marker").hasAttribute("hidden")
      && q("#chart-state-message").textContent.includes("超出 Chart No. 1"), "Nonstandard pressure is not plotted");
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
      && q("#results").hidden && q("#metrics").children.length === 0
      && q(".psychrometric-state-marker").hasAttribute("hidden")
      && q("#chart-state-message").textContent.includes("無有效的圖表狀態點"),
    "Dependent pair warning clears invalid results and chart marker");
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
      const chartBounds = q("#psychrometric-chart").getBoundingClientRect();
      assert(chartBounds.left >= 0 && chartBounds.right <= doc.documentElement.clientWidth,
        `Chart container remains within viewport ${width}`);
      assert(q("#psychrometric-chart").scrollWidth >= q("#psychrometric-chart").clientWidth,
        `Chart remains horizontally scrollable ${width}`);
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
