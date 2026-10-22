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
    temperature <= TEMPERATURE_MAX; temperature += 1) {
    points.push([
      temperature,
      psychrometricValue(cp, "W", "T", temperature + 273.15, "B", wetBulbK),
    ]);
  }
  return points;
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

function addCurveLabel(group, points, text, className, index) {
  const point = points[index];
  if (!point || !Number.isFinite(point[1]) || point[1] < HUMIDITY_MIN || point[1] > HUMIDITY_MAX) return;
  const previous = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  const angle = className === "psychrometric-volume-label"
    && previous && next && Number.isFinite(previous[1]) && Number.isFinite(next[1])
    ? Math.atan2(chartY(next[1]) - chartY(previous[1]), chartX(next[0]) - chartX(previous[0])) * 180 / Math.PI
    : 0;
  const x = chartX(point[0]) + 4;
  const y = chartY(point[1]) - 4;
  group.append(element("text", {
    x,
    y,
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
      element("text", { x: PLOT.left - 12, y: y + 4, "text-anchor": "end" }, String(Math.round(humidity * 1000))),
    );
  }
  svg.append(grid);
  svg.append(element("rect", {
    x: PLOT.left, y: PLOT.top, width: PLOT.width, height: PLOT.height, class: "psychrometric-plot-border",
  }));

  const curves = element("g", { "clip-path": "url(#psychrometric-chart-clip)" });
  const labels = element("g", { class: "psychrometric-curve-labels", "clip-path": "url(#psychrometric-chart-clip)" });
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
    addCurve(curves, points, relativeHumidity === 1 ? "psychrometric-rh psychrometric-saturation" : "psychrometric-rh",
      `相對濕度 ${Math.round(relativeHumidity * 100)}%`);
    const lastVisible = points.findLastIndex((point) => point && Number.isFinite(point[1])
      && point[1] >= HUMIDITY_MIN && point[1] <= HUMIDITY_MAX);
    addCurveLabel(labels, points, `${Math.round(relativeHumidity * 100)}%`, "psychrometric-rh-label", lastVisible);
  }

  for (let wetBulb = -6; wetBulb <= 34; wetBulb += 1) {
    const points = wetBulbCurve(cp, wetBulb);
    if (!points) continue;
    const path = addCurve(curves, points, "psychrometric-wet-bulb", `濕球溫度 ${wetBulb} °C`);
    if (path) path.dataset.wetBulb = String(wetBulb);
    if (wetBulb % 5 === 0 || wetBulb === -6 || wetBulb === 34) {
      const labelIndex = points.findIndex((point, index) =>
        index > 0 && Number.isFinite(point[1]) && point[1] >= HUMIDITY_MIN && point[1] <= HUMIDITY_MAX);
      addCurveLabel(labels, points, `${wetBulb}°`, "psychrometric-wet-bulb-label", labelIndex + 3);
    }
  }

  for (let enthalpy = 10; enthalpy <= 120; enthalpy += 10) {
    const points = [];
    for (let temperature = TEMPERATURE_MIN; temperature <= TEMPERATURE_MAX; temperature += 2) {
      points.push([
        temperature,
        chartHumidity(cp, temperature,
          psychrometricValue(cp, "W", "T", temperature + 273.15, "H", enthalpy * 1000), saturationCache),
      ]);
    }
    addCurve(curves, points, "psychrometric-enthalpy", `比焓 ${enthalpy} kJ/kg 乾空氣`);
    const lastVisible = points.findLastIndex((point) => point && Number.isFinite(point[1])
      && point[1] >= HUMIDITY_MIN && point[1] <= HUMIDITY_MAX);
    addCurveLabel(labels, points, String(enthalpy), "psychrometric-enthalpy-label", lastVisible);
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
      x: 22, y: PLOT.top + PLOT.height / 2, "text-anchor": "middle",
      transform: `rotate(-90 22 ${PLOT.top + PLOT.height / 2})`,
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
