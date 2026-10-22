const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_PRESSURE = 101325;
const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 50;
const HUMIDITY_MIN = 0;
const HUMIDITY_MAX = 0.03;
const PLOT = { left: 88, top: 28, width: 850, height: 520 };

function element(name, attributes = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function chartX(temperature) {
  return PLOT.left + (temperature - TEMPERATURE_MIN) / (TEMPERATURE_MAX - TEMPERATURE_MIN) * PLOT.width;
}

function chartY(humidityRatio) {
  return PLOT.top + PLOT.height - (humidityRatio - HUMIDITY_MIN) / (HUMIDITY_MAX - HUMIDITY_MIN) * PLOT.height;
}

function psychrometricValue(cp, output, key1, value1, key2, value2) {
  try {
    const value = cp.HAPropsSI(output, "P", CHART_PRESSURE, key1, value1, key2, value2);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Inputs beyond the chart's saturated-air envelope are clipped out of the plotted curves.
    return null;
  }
}

function chartHumidity(cp, temperature, humidityRatio, saturationCache) {
  if (!Number.isFinite(humidityRatio) || humidityRatio < HUMIDITY_MIN) return null;
  if (!saturationCache.has(temperature)) {
    saturationCache.set(temperature, psychrometricValue(cp, "W", "T", temperature + 273.15, "R", 1));
  }
  const saturatedHumidity = saturationCache.get(temperature);
  return Number.isFinite(saturatedHumidity) && humidityRatio <= saturatedHumidity + 1e-10
    ? humidityRatio
    : null;
}

function specificVolumeCurve(cp, specificVolume) {
  const saturationTemperatureK = psychrometricValue(cp, "T", "V", specificVolume, "R", 1);
  const saturationHumidity = psychrometricValue(cp, "W", "V", specificVolume, "R", 1);
  const dryAirTemperatureK = psychrometricValue(cp, "T", "V", specificVolume, "W", 0);
  const saturationTemperature = saturationTemperatureK - 273.15;
  const dryAirTemperature = dryAirTemperatureK - 273.15;
  if (![saturationTemperature, saturationHumidity, dryAirTemperature].every(Number.isFinite)
    || saturationTemperature < TEMPERATURE_MIN
    || dryAirTemperature <= saturationTemperature) return null;

  const points = [];
  const segmentCount = 20;
  for (let index = 0; index <= segmentCount; index += 1) {
    const fraction = index / segmentCount;
    const temperature = saturationTemperature + fraction * (dryAirTemperature - saturationTemperature);
    const humidityRatio = index === 0 ? saturationHumidity
      : index === segmentCount ? 0
        : psychrometricValue(cp, "W", "T", temperature + 273.15, "V", specificVolume);
    points.push([temperature, humidityRatio]);
  }
  return {
    points,
    saturationTemperature,
    saturationTemperatureK,
    saturationHumidity,
    dryAirTemperature,
    dryAirTemperatureK,
  };
}

function wetBulbCurve(cp, wetBulb) {
  const wetBulbK = wetBulb + 273.15;
  const saturationHumidity = psychrometricValue(cp, "W", "T", wetBulbK, "R", 1);
  if (!Number.isFinite(saturationHumidity)) return null;
  const points = [[wetBulb, saturationHumidity]];
  for (let temperature = Math.max(TEMPERATURE_MIN, Math.floor(wetBulb) + 1);
    temperature <= TEMPERATURE_MAX + 1; temperature += 1) {
    const wetBulbHumidity = psychrometricValue(cp, "W", "T", temperature + 273.15, "B", wetBulbK);
    const denominator = wetBulb < 0
      ? 2830 + 1.86 * temperature - 2.1 * wetBulb
      : 2501 + 1.86 * temperature - 4.186 * wetBulb;
    const fallbackHumidity = wetBulb < 0
      ? ((2830 - 0.24 * wetBulb) * saturationHumidity - 1.006 * (temperature - wetBulb)) / denominator
      : ((2501 - 2.326 * wetBulb) * saturationHumidity - 1.006 * (temperature - wetBulb)) / denominator;
    points.push([
      temperature,
      Number.isFinite(wetBulbHumidity) ? wetBulbHumidity : fallbackHumidity,
    ]);
  }
  return points;
}

function saturatedEnthalpyTemperature(cp, enthalpy) {
  let previous = null;
  let bracket = null;
  for (let temperature = -20; temperature <= TEMPERATURE_MAX; temperature += 1) {
    const value = psychrometricValue(cp, "H", "T", temperature + 273.15, "R", 1);
    if (!Number.isFinite(value)) {
      previous = null;
      continue;
    }
    if (previous && previous.value <= enthalpy * 1000 && value >= enthalpy * 1000) {
      bracket = [previous.temperature, temperature];
      break;
    }
    previous = { temperature, value };
  }
  if (!bracket) return null;

  let [low, high] = bracket;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    const value = psychrometricValue(cp, "H", "T", middle + 273.15, "R", 1);
    if (!Number.isFinite(value)) return null;
    if (value < enthalpy * 1000) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function dryAirEnthalpyTemperature(cp, enthalpy) {
  const enthalpyAtMinimum = psychrometricValue(cp, "H", "T", TEMPERATURE_MIN + 273.15, "W", 0);
  const enthalpyAtMaximum = psychrometricValue(cp, "H", "T", TEMPERATURE_MAX + 273.15, "W", 0);
  const target = enthalpy * 1000;
  if (![enthalpyAtMinimum, enthalpyAtMaximum].every(Number.isFinite)
    || target < enthalpyAtMinimum || target > enthalpyAtMaximum) return null;

  let low = TEMPERATURE_MIN;
  let high = TEMPERATURE_MAX;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    const value = psychrometricValue(cp, "H", "T", middle + 273.15, "W", 0);
    if (!Number.isFinite(value)) return null;
    if (value < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function enthalpyCurve(cp, enthalpy, saturationCache) {
  const saturationTemperature = saturatedEnthalpyTemperature(cp, enthalpy);
  if (!Number.isFinite(saturationTemperature)) return null;
  const saturationHumidity = psychrometricValue(cp, "W", "T", saturationTemperature + 273.15, "R", 1);
  if (!Number.isFinite(saturationHumidity)) return null;
  const dryAirTemperature = dryAirEnthalpyTemperature(cp, enthalpy);
  const endpointTemperature = Number.isFinite(dryAirTemperature) ? dryAirTemperature : TEMPERATURE_MAX;
  const points = [[saturationTemperature, saturationHumidity]];
  for (let temperature = saturationTemperature + 1;
    temperature < endpointTemperature - 1e-9; temperature += 1) {
    const humidityRatio = psychrometricValue(cp, "W", "T", temperature + 273.15, "H", enthalpy * 1000);
    points.push([temperature, chartHumidity(cp, temperature, humidityRatio, saturationCache)]);
  }
  const endpointHumidity = Number.isFinite(dryAirTemperature) ? 0
    : psychrometricValue(cp, "W", "T", TEMPERATURE_MAX + 273.15, "H", enthalpy * 1000);
  points.push([endpointTemperature,
    chartHumidity(cp, endpointTemperature, endpointHumidity, saturationCache)]);
  return { points, saturationTemperature, saturationHumidity, endpointTemperature };
}

function addCurve(group, points, className, label) {
  let pathData = "";
  let lastEndpoint = null;
  const clipTest = (p, q, range) => {
    if (p === 0) return q >= 0 ? range : null;
    const ratio = q / p;
    if (p < 0) {
      if (ratio > range[1]) return null;
      range[0] = Math.max(range[0], ratio);
    } else {
      if (ratio < range[0]) return null;
      range[1] = Math.min(range[1], ratio);
    }
    return range[0] <= range[1] ? range : null;
  };
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end || !Number.isFinite(start[1]) || !Number.isFinite(end[1])) {
      lastEndpoint = null;
      continue;
    }
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const range = [0, 1];
    if (!clipTest(-dx, start[0] - TEMPERATURE_MIN, range)
      || !clipTest(dx, TEMPERATURE_MAX - start[0], range)
      || !clipTest(-dy, start[1] - HUMIDITY_MIN, range)
      || !clipTest(dy, HUMIDITY_MAX - start[1], range)) {
      lastEndpoint = null;
      continue;
    }
    const clippedStart = [start[0] + range[0] * dx, start[1] + range[0] * dy];
    const clippedEnd = [start[0] + range[1] * dx, start[1] + range[1] * dy];
    const startPoint = `${chartX(clippedStart[0]).toFixed(2)},${chartY(clippedStart[1]).toFixed(2)}`;
    const endPoint = `${chartX(clippedEnd[0]).toFixed(2)},${chartY(clippedEnd[1]).toFixed(2)}`;
    if (lastEndpoint === startPoint) {
      if (endPoint !== startPoint) pathData += `L${endPoint}`;
    } else {
      pathData += `M${startPoint}`;
      if (endPoint !== startPoint) pathData += `L${endPoint}`;
    }
    lastEndpoint = endPoint;
  }
  if (!pathData) return null;
  const path = element("path", { d: pathData, class: className });
  path.append(element("title", {}, label));
  group.append(path);
  return path;
}

function addCurveLabel(group, points, text, className, index, options = {}) {
  const point = points[index];
  if (!point || !Number.isFinite(point[1]) || point[1] < HUMIDITY_MIN || point[1] > HUMIDITY_MAX) return;
  let previousIndex = index - 1;
  while (previousIndex >= 0 && (!points[previousIndex] || !Number.isFinite(points[previousIndex][1]))) previousIndex -= 1;
  let nextIndex = index + 1;
  while (nextIndex < points.length && (!points[nextIndex] || !Number.isFinite(points[nextIndex][1]))) nextIndex += 1;
  const tangentStart = previousIndex >= 0 ? points[previousIndex] : point;
  const tangentEnd = nextIndex < points.length ? points[nextIndex] : point;
  let angle = tangentStart !== tangentEnd
    ? Math.atan2(chartY(tangentEnd[1]) - chartY(tangentStart[1]),
      chartX(tangentEnd[0]) - chartX(tangentStart[0])) * 180 / Math.PI
    : 0;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  const pointX = chartX(point[0]);
  const pointY = chartY(point[1]);
  const anchor = options.anchor ?? (pointX > PLOT.left + PLOT.width - 35 ? "end" : "start");
  const x = pointX + (options.offsetX ?? (anchor === "end" ? -5 : 5));
  const y = pointY + (options.offsetY ?? (pointY < PLOT.top + 16 ? 14 : -4));
  group.append(element("text", {
    x,
    y,
    "text-anchor": anchor,
    transform: `rotate(${angle.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})`,
    class: className,
  }, text));
}

function addLegendItem(legend, color, label, dash = "") {
  const group = element("g", { transform: `translate(${legend.children.length * 185} 0)` });
  group.append(element("line", { x1: 0, y1: 8, x2: 30, y2: 8, stroke: color, "stroke-width": 2, "stroke-dasharray": dash }));
  group.append(element("text", { x: 38, y: 12 }, label));
  legend.append(group);
}

export function createPsychrometricChart(cp, onReadout = () => {}) {
  const svg = element("svg", {
    viewBox: "0 0 1000 670",
    role: "img",
    "aria-labelledby": "psychrometric-chart-title psychrometric-chart-description",
  });
  svg.append(
    element("title", { id: "psychrometric-chart-title" }, "ASHRAE Psychrometric Chart No. 1"),
    element("desc", { id: "psychrometric-chart-description" },
      "標準大氣壓 101.325 kPa，乾球溫度 0 至 50 °C，濕度比 0 至 30 g/kg 乾空氣；含相對濕度、濕球溫度、比焓及比容線，可移動滑鼠讀取狀態性質。"),
  );
  const defs = element("defs");
  const clip = element("clipPath", { id: "psychrometric-chart-clip" });
  clip.append(element("rect", { x: PLOT.left, y: PLOT.top, width: PLOT.width, height: PLOT.height }));
  defs.append(clip);
  svg.append(defs);
  const grid = element("g", { class: "psychrometric-grid" });
  for (let temperature = TEMPERATURE_MIN; temperature <= TEMPERATURE_MAX; temperature += 5) {
    const x = chartX(temperature);
    grid.append(
      element("line", { x1: x, y1: PLOT.top, x2: x, y2: PLOT.top + PLOT.height }),
      element("text", { x, y: PLOT.top + PLOT.height + 24, "text-anchor": "middle" }, String(temperature)),
    );
  }
  for (let humidity = HUMIDITY_MIN; humidity <= HUMIDITY_MAX + 1e-9; humidity += 0.005) {
    const y = chartY(humidity);
    grid.append(
      element("line", { x1: PLOT.left, y1: y, x2: PLOT.left + PLOT.width, y2: y }),
      element("line", { x1: PLOT.left + PLOT.width, y1: y, x2: PLOT.left + PLOT.width + 6, y2: y }),
      element("text", { x: PLOT.left + PLOT.width + 12, y: y + 4, "text-anchor": "start" },
        String(Math.round(humidity * 1000))),
    );
  }
  svg.append(grid);
  svg.append(element("rect", {
    x: PLOT.left, y: PLOT.top, width: PLOT.width, height: PLOT.height, class: "psychrometric-plot-border",
  }));

  const curves = element("g", { "clip-path": "url(#psychrometric-chart-clip)" });
  const labels = element("g", { class: "psychrometric-curve-labels" });
  const saturationCache = new Map();
  for (let relativeHumidity = 0.1; relativeHumidity <= 1.0001; relativeHumidity += 0.1) {
    const points = [];
    for (let temperature = TEMPERATURE_MIN; temperature <= TEMPERATURE_MAX; temperature += 1) {
      points.push([
        temperature,
        chartHumidity(cp, temperature,
          psychrometricValue(cp, "W", "T", temperature + 273.15, "R", relativeHumidity), saturationCache),
      ]);
    }
    const relativeHumidityPath = addCurve(curves,
      points, relativeHumidity === 1 ? "psychrometric-rh psychrometric-saturation" : "psychrometric-rh",
      `相對濕度 ${Math.round(relativeHumidity * 100)}%`);
    if (relativeHumidityPath) {
      relativeHumidityPath.dataset.relativeHumidity = String(Math.round(relativeHumidity * 100));
    }
    addCurveLabel(labels, points, `${Math.round(relativeHumidity * 100)}%`,
      "psychrometric-rh-label", 30);
  }

  for (let wetBulb = -6; wetBulb <= 34; wetBulb += 1) {
    const points = wetBulbCurve(cp, wetBulb);
    if (!points) continue;
    const path = addCurve(curves, points, "psychrometric-wet-bulb", `濕球溫度 ${wetBulb} °C`);
    if (path) path.dataset.wetBulb = String(wetBulb);
    if (wetBulb % 5 === 0 || wetBulb === -6 || wetBulb === 34) {
      const labelIndex = points.findIndex((point, index) =>
        index > 0 && Number.isFinite(point[1]) && point[0] <= TEMPERATURE_MAX
          && point[1] >= HUMIDITY_MIN && point[1] <= HUMIDITY_MAX);
      if (labelIndex >= 0) {
        addCurveLabel(labels, points, `${wetBulb}°`, "psychrometric-wet-bulb-label",
          Math.min(labelIndex + 3, points.length - 1), {
            anchor: "middle",
            offsetX: 0,
            offsetY: 0,
          });
      }
    }
  }

  for (let enthalpy = 0; enthalpy <= 120; enthalpy += 10) {
    const curve = enthalpyCurve(cp, enthalpy, saturationCache);
    if (!curve) continue;
    const path = addCurve(curves, curve.points, "psychrometric-enthalpy",
      `比焓 ${enthalpy} kJ/kg 乾空氣`);
    if (!path) continue;
    path.dataset.enthalpy = String(enthalpy);
    path.dataset.saturationTemperatureC = curve.saturationTemperature.toPrecision(15);
    path.dataset.saturationHumidity = curve.saturationHumidity.toPrecision(15);
    path.dataset.endpointTemperatureC = curve.endpointTemperature.toPrecision(15);
    let labelIndex = -1;
    for (let index = 0; index < curve.points.length; index += 1) {
      const point = curve.points[index];
      if (point && Number.isFinite(point[1])
        && point[0] >= TEMPERATURE_MIN && point[0] <= TEMPERATURE_MAX
        && point[1] >= HUMIDITY_MIN && point[1] <= HUMIDITY_MAX) {
        labelIndex = index;
        break;
      }
    }
    const labelPoint = curve.points[labelIndex];
    addCurveLabel(labels, curve.points, String(enthalpy), "psychrometric-enthalpy-label", labelIndex, {
      anchor: "end",
      offsetX: -8,
      offsetY: labelPoint && labelPoint[1] >= HUMIDITY_MAX - 0.001 ? 12 : -8,
    });
  }

  for (let hundredths = 78; hundredths <= 95; hundredths += 1) {
    const specificVolume = hundredths / 100;
    const curve = specificVolumeCurve(cp, specificVolume);
    if (!curve) continue;
    const path = addCurve(curves, curve.points, "psychrometric-volume",
      `比容 ${specificVolume.toFixed(2)} m³/kg 乾空氣`);
    if (!path) continue;
    path.dataset.specificVolume = specificVolume.toFixed(2);
    path.dataset.saturationTemperatureK = curve.saturationTemperatureK.toPrecision(17);
    path.dataset.saturationTemperatureC = curve.saturationTemperature.toPrecision(15);
    path.dataset.saturationHumidity = curve.saturationHumidity.toPrecision(15);
    path.dataset.dryAirTemperatureK = curve.dryAirTemperatureK.toPrecision(17);
    path.dataset.dryAirTemperatureC = curve.dryAirTemperature.toPrecision(15);
    if (hundredths % 2 === 0) {
      addCurveLabel(labels, curve.points, specificVolume.toFixed(2),
        "psychrometric-volume-label", Math.floor(curve.points.length / 2));
    }
  }
  svg.append(curves, labels);

  const crosshair = element("g", { class: "psychrometric-crosshair", hidden: "", "clip-path": "url(#psychrometric-chart-clip)" });
  crosshair.append(
    element("line", { class: "psychrometric-crosshair-x", x1: PLOT.left, x2: PLOT.left + PLOT.width }),
    element("line", { class: "psychrometric-crosshair-y", y1: PLOT.top, y2: PLOT.top + PLOT.height }),
    element("circle", { r: 5 }),
  );
  svg.append(crosshair);

  const axes = element("g", { class: "psychrometric-axes" });
  axes.append(
    element("text", { x: PLOT.left + PLOT.width / 2, y: 600, "text-anchor": "middle" }, "乾球溫度 (°C)"),
    element("text", {
      x: 985, y: PLOT.top + PLOT.height / 2, "text-anchor": "middle",
      transform: `rotate(90 985 ${PLOT.top + PLOT.height / 2})`,
    }, "濕度比 (g/kg 乾空氣)"),
    element("text", { x: PLOT.left, y: 625 }, "標準大氣壓 101.325 kPa"),
  );
  svg.append(axes);

  const legend = element("g", { class: "psychrometric-legend", transform: "translate(90 645)" });
  addLegendItem(legend, "#9b4b4b", "相對濕度");
  addLegendItem(legend, "#256a9b", "濕球溫度", "5 3");
  addLegendItem(legend, "#718b45", "比焓");
  addLegendItem(legend, "#8067a7", "比容", "2 4");
  svg.append(legend);

  const marker = element("g", { class: "psychrometric-state-marker", hidden: "" });
  marker.append(
    element("circle", { r: 7 }),
    element("text", { x: 10, y: -10 }),
  );
  svg.append(marker);

  function readPoint(temperature, humidityRatio) {
    if (!Number.isFinite(temperature) || !Number.isFinite(humidityRatio)
      || temperature < TEMPERATURE_MIN || temperature > TEMPERATURE_MAX
      || humidityRatio < HUMIDITY_MIN || humidityRatio > HUMIDITY_MAX) return null;
    const saturatedHumidity = psychrometricValue(cp, "W", "T", temperature + 273.15, "R", 1);
    if (!Number.isFinite(saturatedHumidity) || humidityRatio > saturatedHumidity + 1e-10) {
      return { temperature, humidityRatio, valid: false };
    }
    const query = (output) => psychrometricValue(cp, output, "T", temperature + 273.15, "W", humidityRatio);
    const relativeHumidity = query("R");
    const wetBulb = query("B");
    const enthalpy = query("H");
    const specificVolume = query("V");
    const dewPoint = humidityRatio === 0 ? null : query("D");
    if (![relativeHumidity, wetBulb, enthalpy, specificVolume].every(Number.isFinite)) {
      return { temperature, humidityRatio, valid: false };
    }
    return {
      valid: true,
      temperature,
      humidityRatio,
      relativeHumidity,
      wetBulb: wetBulb - 273.15,
      dewPoint: Number.isFinite(dewPoint) ? dewPoint - 273.15 : null,
      enthalpy: enthalpy / 1000,
      specificVolume,
    };
  }

  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) * 1000 / bounds.width;
    const y = (event.clientY - bounds.top) * 670 / bounds.height;
    if (x < PLOT.left || x > PLOT.left + PLOT.width || y < PLOT.top || y > PLOT.top + PLOT.height) {
      crosshair.setAttribute("hidden", "");
      onReadout(null);
      return;
    }
    const temperature = TEMPERATURE_MIN + (x - PLOT.left) / PLOT.width * (TEMPERATURE_MAX - TEMPERATURE_MIN);
    const humidityRatio = HUMIDITY_MIN + (PLOT.top + PLOT.height - y) / PLOT.height * (HUMIDITY_MAX - HUMIDITY_MIN);
    const state = readPoint(temperature, humidityRatio);
    crosshair.removeAttribute("hidden");
    crosshair.querySelector(".psychrometric-crosshair-x").setAttribute("y1", y);
    crosshair.querySelector(".psychrometric-crosshair-x").setAttribute("y2", y);
    crosshair.querySelector(".psychrometric-crosshair-y").setAttribute("x1", x);
    crosshair.querySelector(".psychrometric-crosshair-y").setAttribute("x2", x);
    crosshair.querySelector("circle").setAttribute("cx", x);
    crosshair.querySelector("circle").setAttribute("cy", y);
    onReadout(state);
  });
  svg.addEventListener("pointerleave", () => {
    crosshair.setAttribute("hidden", "");
    onReadout(null);
  });

  return {
    svg,
    readPoint,
    setState(state) {
      if (!state || Math.abs(state.pressure - 101.325) > 1e-9
        || state.temperature < TEMPERATURE_MIN || state.temperature > TEMPERATURE_MAX
        || state.humidityRatio < HUMIDITY_MIN || state.humidityRatio > HUMIDITY_MAX) {
        marker.setAttribute("hidden", "");
        return false;
      }
      marker.removeAttribute("hidden");
      marker.setAttribute("transform", `translate(${chartX(state.temperature)} ${chartY(state.humidityRatio)})`);
      marker.lastElementChild.textContent = `${state.temperature.toFixed(1)} °C, ${(state.humidityRatio * 1000).toFixed(1)} g/kg`;
      return true;
    },
  };
}
