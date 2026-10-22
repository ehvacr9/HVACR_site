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
  assert([...chart.svg.querySelectorAll(".psychrometric-legend text")].map((label) => label.textContent).join("|")
    === "相對濕度 (%)|濕球溫度 (°C)|比焓 (kJ/kg 乾空氣)|比容 (m³/kg 乾空氣)",
  "Legend includes units for all four curve families");
  const angleDifference = (first, second) => {
    let difference = Math.abs(first - second) % 180;
    if (difference > 90) difference = 180 - difference;
    return difference;
  };
  const assertLabelsFollowCurves = (labels, curveSelector, keyForLabel, description, expectedDistance) => {
    for (const label of labels) {
      const curve = chart.svg.querySelector(curveSelector(label));
      const pivot = label.getAttribute("transform").match(/^rotate\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
      assert(curve && pivot, `${description} ${label.textContent}: matching line and rotation`);
      const labelAngle = Number(pivot[1]);
      const [labelX, labelY] = pivot.slice(2).map(Number);
      const coordinates = curve.getAttribute("d").match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)
        .map((coordinate) => coordinate.split(",").map(Number));
      let closestSegment = null;
      let closestDistance = Infinity;
      if (coordinates.length === 1) {
        closestDistance = Math.hypot(labelX - coordinates[0][0], labelY - coordinates[0][1]);
      }
      for (let index = 1; index < coordinates.length; index += 1) {
        const [x1, y1] = coordinates[index - 1];
        const [x2, y2] = coordinates[index];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const fraction = Math.max(0, Math.min(1,
          ((labelX - x1) * dx + (labelY - y1) * dy) / (dx * dx + dy * dy)));
        const distance = Math.hypot(labelX - (x1 + fraction * dx), labelY - (y1 + fraction * dy));
        if (distance < closestDistance) {
          closestDistance = distance;
          closestSegment = [dx, dy];
        }
      }
      assert((closestSegment || coordinates.length === 1) && closestDistance < 20,
        `${description} ${keyForLabel(label)}: positioned beside its line`);
      if (expectedDistance !== undefined) {
        assert(Math.abs(closestDistance - expectedDistance) < .02,
          `${description} ${keyForLabel(label)}: distance from its line is ${expectedDistance}px`);
      }
      if (closestSegment) {
        const curveAngle = Math.atan2(closestSegment[1], closestSegment[0]) * 180 / Math.PI;
        assert(angleDifference(labelAngle, curveAngle) < 8,
          `${description} ${keyForLabel(label)}: label is parallel to curve (${labelAngle} vs ${curveAngle})`);
      }
    }
  };
  assert(chart.svg.getAttribute("viewBox") === "0 0 1000 670", "Psychrometric Chart No. 1 SVG bounds");
  assert(chart.svg.querySelectorAll(".psychrometric-rh").length === 10, "Ten relative-humidity curves");
  const relativeHumidityLabels = [...chart.svg.querySelectorAll(".psychrometric-rh-label")];
  assert(relativeHumidityLabels.length === 10, "Ten relative-humidity labels");
  assertLabelsFollowCurves(relativeHumidityLabels,
    (label) => `.psychrometric-rh[data-relative-humidity="${Number.parseFloat(label.textContent)}"]`,
    (label) => label.textContent, "Relative-humidity label");
  const wetBulbCurves = [...chart.svg.querySelectorAll(".psychrometric-wet-bulb")];
  assert(wetBulbCurves.length === 41
    && wetBulbCurves.map((curve) => Number(curve.dataset.wetBulb)).join(",")
      === Array.from({ length: 41 }, (_, index) => index - 6).join(","),
  "Wet-bulb curves span -6 to 34 C at 1 C intervals");
  for (const curve of wetBulbCurves) {
    const wetBulb = Number(curve.dataset.wetBulb);
    const coordinates = curve.getAttribute("d").match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)
      ?.map((coordinate) => coordinate.split(",").map(Number));
    assert(coordinates?.length >= 2, `Wet-bulb ${wetBulb}: visible continuous path`);
    const [firstX, firstY] = coordinates[0];
    const saturationHumidity = cp.HAPropsSI("W", "P", 101325, "T", wetBulb + 273.15, "R", 1);
    const beginsAtSaturation = wetBulb >= 0 && wetBulb <= 50 && saturationHumidity <= .03
      && Math.abs(firstX - (88 + wetBulb / 50 * 850)) < .02
      && Math.abs(firstY - (28 + 520 - saturationHumidity / .03 * 520)) < .02;
    assert(beginsAtSaturation || Math.abs(firstX - 88) < .02 || Math.abs(firstY - 28) < .02,
      `Wet-bulb ${wetBulb}: begins at saturation or clipped plot boundary`);
    const [lastX, lastY] = coordinates.at(-1);
    assert(Math.abs(lastX - 88) < .02 || Math.abs(lastX - 938) < .02
      || Math.abs(lastY - 28) < .02 || Math.abs(lastY - 548) < .02,
    `Wet-bulb ${wetBulb}: extends to a plot boundary`);
  }
  const enthalpyCurves = [...chart.svg.querySelectorAll(".psychrometric-enthalpy")];
  assert(enthalpyCurves.length === 13
    && enthalpyCurves.map((curve) => Number(curve.dataset.enthalpy)).join(",")
      === Array.from({ length: 13 }, (_, index) => index * 10).join(","),
  "Enthalpy curves span 0 to 120 kJ/kg at 10 kJ/kg intervals");
  for (const curve of enthalpyCurves) {
    const saturationTemperature = Number(curve.dataset.saturationTemperatureC);
    const saturationHumidity = Number(curve.dataset.saturationHumidity);
    const endpointTemperature = Number(curve.dataset.endpointTemperatureC);
    const coordinates = curve.getAttribute("d").match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g);
    assert(coordinates?.length > 0, `Enthalpy ${curve.dataset.enthalpy}: visible curve`);
    const [firstX, firstY] = coordinates[0].split(",").map(Number);
    const beginsAtVisibleSaturation = saturationTemperature >= 0 && saturationTemperature <= 50
      && saturationHumidity <= .03
      && Math.abs(firstX - (88 + saturationTemperature / 50 * 850)) < .02
      && Math.abs(firstY - (28 + 520 - saturationHumidity / .03 * 520)) < .02;
    assert(beginsAtVisibleSaturation || Math.abs(firstX - 88) < .02 || Math.abs(firstY - 28) < .02,
      `Enthalpy ${curve.dataset.enthalpy}: begins at saturation or clipped plot boundary`);
    const [lastX, lastY] = coordinates.at(-1).split(",").map(Number);
    if (endpointTemperature < 50) {
      close(lastX, 88 + endpointTemperature / 50 * 850,
        `Enthalpy ${curve.dataset.enthalpy}: reaches dry-air axis temperature`, 3e-5);
      close(lastY, 548, `Enthalpy ${curve.dataset.enthalpy}: reaches zero-humidity boundary`);
    } else close(lastX, 938, `Enthalpy ${curve.dataset.enthalpy}: reaches right plot boundary`);
  }
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
  assert([...chart.svg.querySelectorAll(".psychrometric-axes text")]
    .find((label) => label.textContent === "濕度比 (g/kg 乾空氣)")
    ?.getAttribute("transform") === "rotate(-90 985 288)",
  "Humidity-ratio axis title is flipped 180 degrees from its original orientation");
  const gridTicks = [...chart.svg.querySelectorAll(".psychrometric-grid text")];
  for (const [axis, count] of [["x", 51], ["y", 31]]) {
    const ticks = [...chart.svg.querySelectorAll(`.psychrometric-axis-tick[data-axis="${axis}"]`)];
    assert(ticks.length === count && ticks.every((tick, index) => Number(tick.dataset.value) === index),
      `${axis} axis has a tick at every unit including both endpoints`);
    assert(ticks.every((tick, index) => {
      const length = axis === "x"
        ? Number(tick.getAttribute("y2")) - Number(tick.getAttribute("y1"))
        : Number(tick.getAttribute("x2")) - Number(tick.getAttribute("x1"));
      return length === (index % 5 === 0 ? 6 : 3);
    }), `${axis} axis distinguishes major and minor tick lengths`);
  }
  assert(gridTicks.length === 18, "Axis numbers remain at five-unit intervals only");
  const humidityTicks = gridTicks.filter((tick) => Number(tick.getAttribute("x")) > 938);
  assert(humidityTicks.length === 7 && humidityTicks.every((tick) =>
    Number(tick.getAttribute("x")) > 938 && tick.getAttribute("text-anchor") === "start"),
  "Humidity-ratio ticks are positioned to the right of the plot");
  assert(!gridTicks.some((tick) => Number(tick.getAttribute("x")) < 88),
    "No humidity-ratio ticks remain on the left of the plot");
  const wetBulbLabels = [...chart.svg.querySelectorAll(".psychrometric-wet-bulb-label")];
  assertLabelsFollowCurves(wetBulbLabels,
    (label) => `.psychrometric-wet-bulb[data-wet-bulb="${Number.parseFloat(label.textContent)}"]`,
    (label) => label.textContent, "Wet-bulb label", 0);
  assert(wetBulbLabels.length === 8
    && wetBulbLabels.every((label) => label.getAttribute("text-anchor") === "middle"),
  "All eight wet-bulb labels are horizontally centered on their lines");
  const enthalpyLabels = [...chart.svg.querySelectorAll(".psychrometric-enthalpy-label")];
  assertLabelsFollowCurves(enthalpyLabels,
    (label) => `.psychrometric-enthalpy[data-enthalpy="${label.textContent}"]`,
    (label) => label.textContent, "Enthalpy label");
  assert(enthalpyLabels.every((label) => label.getAttribute("text-anchor") === "end"),
    "Enthalpy labels sit just outside the saturation-side start of each line");
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
  assertLabelsFollowCurves(rotatedVolumeLabels,
    (label) => `.psychrometric-volume[data-specific-volume="${label.textContent}"]`,
    (label) => label.textContent, "Specific-volume label");
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
    const mode = (value) => q(`input[name="mode-category"][value="${value}"]`).click();
    const submit = async () => {
      q("#humid-air-form").requestSubmit();
      assert(q("#status").dataset.kind === "loading", "Immediate loading spinner");
      await wait(() => !q("#humid-air-form").hasAttribute("aria-busy"));
    };
    assert(q("#pressure").value === "101.325", "Default pressure in kPa");
    assert(q("#property-one").value === "T" && q("#value-one").value === ""
      && q("#property-two").value === "R" && q("#value-two").value === "",
    "Known-property values start blank with dry bulb and relative humidity selected");
    assert(!q("#value-one").checkValidity() && !q("#value-two").checkValidity(),
      "Known-property values are required");
    assert(!q("#clear-inputs"), "Calculation has no clear button");
    const placeholderMetrics = () => !q("#results").hidden && q("#metrics").children.length === 7
      && [...doc.querySelectorAll("#metrics strong")].every((value) => value.textContent === "—");
    assert(placeholderMetrics(), "Initial results show seven property names with placeholder values");
    const style = (selector) => frame.contentWindow.getComputedStyle(q(selector));
    assert(style("#humid-air-form").backgroundColor === "rgb(237, 240, 233)"
      && style("#humid-air-inputs").borderTopWidth === "0px",
    "Calculation uses the fluid tool's tinted input panel without a nested fieldset border");
    assert(style("#pressure").borderRadius === "2px"
      && style('#humid-air-inputs button').borderRadius === "2px"
      && style(".mode-options span").padding === "9px 14px",
    "Inputs, buttons and mode switches follow the fluid tool styling");
    assert(!q("#results-placeholder").hidden,
      "Result panel provides guidance before the first calculation");
    assert(!q("#calculation-section").hidden && q("#psychrometric-chart-section").hidden,
      "Calculation is the default mode and chart is separate");
    assert(style("#psychrometric-chart-section").display === "none"
      && q("#psychrometric-chart-section").getClientRects().length === 0,
    "Calculation mode does not render or reserve layout space for the chart");
    assert(!q("#psychrometric-chart svg"), "Calculation is ready without constructing any chart curves");
    assert(placeholderMetrics(), "Reference marker does not populate calculation results");
    mode("drawing");
    assert(q("#chart-drawing-status").dataset.kind === "loading"
      && q("#chart-drawing-status").textContent.includes("正在繪製"),
    "First drawing request displays an explicit drawing progress state");
    await wait(() => !q("#psychrometric-chart").hasAttribute("aria-busy"));
    assert(q("#chart-drawing-status").dataset.kind === "success",
      "Lazy drawing completes successfully");
    assert(!q(".psychrometric-state-marker").hasAttribute("hidden")
      && q(".psychrometric-state-marker circle").getAttribute("r") === "5",
    "First drawing displays a small reference circle without a prior calculation");
    const defaultReference = calculateHumidAir(cp, { ...base, value1: 24 });
    const markerPosition = q(".psychrometric-state-marker").getAttribute("transform")
      .match(/^translate\(([-\d.]+) ([-\d.]+)\)$/);
    close(Number(markerPosition[1]), 88 + 24 / 50 * 850, "Initial reference marker is at 24 C dry bulb");
    close(Number(markerPosition[2]), 548 - defaultReference.values.W / .03 * 520,
      "Initial reference marker is at 50% relative humidity");
    assert(q("#calculation-section").hidden && !q("#psychrometric-chart-section").hidden,
      "Drawing mode shows chart independently of calculation inputs");
    assert(q("#chart-title").textContent === "ASHRAE Psychrometric Chart No. 1"
      && q("#psychrometric-chart-section").querySelectorAll("h2, h3").length === 1,
    "Drawing has only the chart title without a redundant drawing heading");
    assert(q("#status").getClientRects().length === 0
      && q("#chart-state-message").textContent === "",
    "Drawing hides calculation status and omits the successful state-marker message");
    assert(q("#psychrometric-chart-section").getBoundingClientRect().height > 0,
      "Drawing mode actually renders the chart panel");
    assert(!q("#psychrometric-chart-section").hidden
      && q("#psychrometric-chart svg").querySelectorAll(".psychrometric-rh").length === 10,
    "ASHRAE chart renders with relative-humidity curves");
    assert(q("#chart-readout").compareDocumentPosition(q("#psychrometric-chart"))
      & frame.contentWindow.Node.DOCUMENT_POSITION_FOLLOWING,
    "Pointer readout is displayed above the chart");
    assert(q("#chart-readout").textContent === "尚未選取狀態點。",
      "Readout panel initially shows no selected state");
    const readoutStyle = frame.contentWindow.getComputedStyle(q("#chart-readout"));
    assert(readoutStyle.borderTopStyle === "solid"
      && Number.parseFloat(readoutStyle.borderTopWidth) > 0,
    "Pointer readout is displayed in a bordered panel like the Ph diagram");
    const svg = q("#psychrometric-chart svg");
    const originalClick = frame.contentWindow.HTMLAnchorElement.prototype.click;
    try {
      for (const suffix of ["", "-bw"]) {
        let download;
        frame.contentWindow.HTMLAnchorElement.prototype.click = function () {
          download = { url: this.href, filename: this.download };
        };
        q(suffix ? "#chart-download-bw" : "#chart-download-color").click();
        await wait(() => download || q("#chart-download-status").dataset.kind === "error");
        assert(download, `Chart PNG export succeeds ${suffix}: ${q("#chart-download-status").textContent}`);
        const blob = await (await fetch(download.url)).blob();
        const image = await createImageBitmap(blob);
        assert(blob.type === "image/png" && image.width === 2000 && image.height === 1340,
          `Chart PNG dimensions and type ${suffix}`);
        assert(download.filename === `psychrometric-chart-no-1${suffix}.png`, `Chart PNG filename ${suffix}`);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let chromatic = 0;
        let ink = 0;
        for (let index = 0; index < pixels.length; index += 16) {
          if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2])
            - Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 15) chromatic += 1;
          if (pixels[index] < 200) ink += 1;
        }
        assert(suffix ? chromatic === 0 : chromatic > 100, `Chart PNG color mode ${suffix}`);
        assert(ink > 1000, `Chart PNG contains rendered curves and labels ${suffix}`);
        image.close();
      }
    } finally {
      frame.contentWindow.HTMLAnchorElement.prototype.click = originalClick;
    }
    assert([...svg.querySelectorAll(".psychrometric-wet-bulb-label")].every((label) =>
      frame.contentWindow.getComputedStyle(label).dominantBaseline === "central"),
    "Wet-bulb label vertical centers align with their lines");
    const wetBulbDash = frame.contentWindow.getComputedStyle(svg.querySelector(".psychrometric-wet-bulb")).strokeDasharray;
    const enthalpyDash = frame.contentWindow.getComputedStyle(svg.querySelector(".psychrometric-enthalpy")).strokeDasharray;
    assert(wetBulbDash !== "none" && enthalpyDash === "none",
      "Wet-bulb curves are dashed and enthalpy curves are solid");
    assert(q("#property-one").options.length === 7 && q("#property-two").options.length === 7, "Both selectors offer all properties");
    mode("calculation");
    q("#value-one").value = "24";
    q("#value-two").value = "50";
    await submit();
    assert(q("#status").dataset.kind === "success" && !q("#results").hidden, "Default state solves");
    assert(style("#psychrometric-chart-section").display === "none",
      "Completing a calculation does not reveal the drawing panel");
    assert(q("#results-placeholder").hidden, "Successful results replace the result-panel guidance");
    assert(!q(".psychrometric-state-marker").hasAttribute("hidden"), "Successful state is marked on chart");
    assert(!q(".psychrometric-state-marker text")
      && style(".psychrometric-state-marker circle").fill === "none"
      && style(".psychrometric-state-marker circle").stroke === "rgb(198, 106, 22)",
    "Reference point is an unfilled orange-outline circle without a text label");
    mode("drawing");
    assert(q("#psychrometric-chart svg") === svg
      && !q("#psychrometric-chart").hasAttribute("aria-busy"),
    "Returning to drawing reuses the chart without redrawing");
    assert(!q(".psychrometric-state-marker").hasAttribute("hidden") && q("#calculation-section").hidden,
      "Drawing mode preserves calculated state marker");
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
    assert(q("#chart-readout").textContent === "尚未選取狀態點。", "Pointer leaving chart resets readout");
    mode("calculation");
    assert(!q("#results").hidden && q("#psychrometric-chart-section").hidden,
      "Returning to calculation preserves results and hides drawing");
    assert(q("#psychrometric-chart-section").getClientRects().length === 0,
      "Returning from drawing fully removes the chart from calculation layout");
    assert(q("#metrics").children.length === 7, "Seven results displayed");
    const defaultState = calculateHumidAir(cp, { ...base, value1: 24 });
    close(Number.parseFloat(q('[data-property="H"] strong').textContent),
      defaultState.values.H / 1000, "Default reference enthalpy SI conversion", 1e-5);
    assert(q('[data-property="T"] strong').textContent === "24 °C"
      && q('[data-property="R"] strong').textContent === "50 %",
    "Default reference results show 24 C dry bulb and 50% RH");
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
      && placeholderMetrics()
      && q(".psychrometric-state-marker").hasAttribute("hidden")
      && q("#chart-state-message").textContent.includes("無有效的圖表狀態點"),
    "Dependent pair warning clears invalid results and chart marker");
    assert(!q("#results-placeholder").hidden, "Failed calculation restores result-panel guidance");
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
      assert(style("#calculation-section").gridTemplateColumns.split(" ").length === (width <= 760 ? 1 : 2),
        `Fluid-style calculation panels adapt to viewport ${width}`);
      mode("drawing");
      const chartBounds = q("#psychrometric-chart").getBoundingClientRect();
      assert(chartBounds.left >= 0 && chartBounds.right <= doc.documentElement.clientWidth,
        `Chart container remains within viewport ${width}`);
      assert(q("#psychrometric-chart").scrollWidth >= q("#psychrometric-chart").clientWidth,
        `Chart remains horizontally scrollable ${width}`);
      const readout = q("#chart-readout");
      const readoutHeight = readout.getBoundingClientRect().height;
      const chartTop = chartBounds.top;
      for (const [temperature, humidityRatio] of [[.1, .0299], [25, .01], [.1, .0299], [49.9, .025], [25, .0000001]]) {
        const svgBounds = svg.getBoundingClientRect();
        svg.dispatchEvent(new frame.contentWindow.PointerEvent("pointermove", {
          clientX: svgBounds.left + (88 + temperature / 50 * 850) / 1000 * svgBounds.width,
          clientY: svgBounds.top + (28 + 520 - humidityRatio / .03 * 520) / 670 * svgBounds.height,
          bubbles: true,
        }));
        assert(readout.textContent !== "尚未選取狀態點。", `Pointer updates readout at ${temperature}/${humidityRatio}, ${width}`);
        assert(readout.textContent.includes("超出有效") === (temperature === .1),
          `Pointer switches between invalid-region warning and full properties at ${temperature}/${humidityRatio}, ${width}`);
        assert(Math.abs(q("#psychrometric-chart").getBoundingClientRect().top - chartTop) < .5
          && Math.abs(readout.getBoundingClientRect().height - readoutHeight) < .5,
        `Readout updates do not shift chart at ${temperature}/${humidityRatio}, ${width}`);
        assert(readout.scrollWidth <= readout.clientWidth,
          `Readout wraps within its width at ${temperature}/${humidityRatio}, ${width}`);
      }
      assert(frame.contentWindow.getComputedStyle(readout).overflowY === "auto"
        && frame.contentWindow.getComputedStyle(readout).whiteSpace !== "nowrap",
      `Readouts can wrap and scroll vertically without resizing ${width}`);
      svg.dispatchEvent(new frame.contentWindow.PointerEvent("pointerleave", { bubbles: true }));
      assert(readout.textContent === "尚未選取狀態點。"
        && Math.abs(q("#psychrometric-chart").getBoundingClientRect().top - chartTop) < .5,
      `Resetting readout does not shift chart ${width}`);
      mode("calculation");
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
        assert(firstValue.left > one.right && secondValue.left > two.right,
          `Value inputs are to the right of their selectors ${width}`);
        close(one.height, firstValue.height, `Control heights aligned ${width}`);
      } else {
        assert(one.bottom <= firstValue.top && firstValue.bottom < two.top && two.bottom <= secondValue.top,
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
