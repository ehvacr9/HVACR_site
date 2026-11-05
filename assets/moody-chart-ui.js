import { calculateMoodyFromFluidProperties, calculateTurbulentMoodyCurveFactor } from "./moody-chart.js";

const form = document.querySelector("#moody-form");
const roughnessInput = document.querySelector("#absolute-roughness");
const result = document.querySelector("#friction-factor");
const regime = document.querySelector("#flow-regime");
const reynoldsResult = document.querySelector("#result-reynolds");
const relativeRoughnessResult = document.querySelector("#result-relative-roughness");
const error = document.querySelector("#error");
const status = document.querySelector("#status");
const chart = document.querySelector("#moody-chart");
const outputFormat = new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 6 });
const roughnessLevels = [
  .05, .04, .03, .02, .015, .01, .008, .006, .004, .002, .001,
  .0008, .0006, .0004, .0002, .0001, .00005, .00001,
];
const chartCurves = roughnessLevels.map((roughness, index) => ({
  roughness,
  label: `ε / D = ${roughness}`,
  color: `hsl(${Math.round(index * 360 / roughnessLevels.length)} 48% 42%)`,
}));
const plot = { left: 94, right: 900, top: 60, bottom: 500 };
const xMinimum = Math.log10(500);
const xMaximum = 8;
const yMinimum = Math.log10(.008);
const yMaximum = Math.log10(.1);
let plottedReynoldsNumber = null;

function svgElement(name, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}

function xPosition(reynoldsNumber) {
  return plot.left + (Math.log10(reynoldsNumber) - xMinimum) / (xMaximum - xMinimum) * (plot.right - plot.left);
}

function yPosition(frictionFactor) {
  return plot.bottom - (Math.log10(frictionFactor) - yMinimum) / (yMaximum - yMinimum) * (plot.bottom - plot.top);
}

function drawChart() {
  const width = 1120;
  const height = 585;
  chart.replaceChildren();
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  chart.append(svgElement(
    "desc",
    { id: "chart-description" },
    "以雷諾數為橫軸、Darcy 摩擦因子為縱軸的對數座標 Moody 圖。右側各粗糙度標籤以引線連至相同顏色的曲線，並以箭頭標示層流線與光滑管曲線。Re 小於 2300 為層流區，Re 大於 4000 為紊流區，中間為過渡區。紊流參考曲線向左延伸至 Re 等於 2000。紅點標示輸入條件對應的計算位置。",
  ));

  const defs = svgElement("defs");
  const clip = svgElement("clipPath", { id: "moody-plot-clip" });
  clip.append(svgElement("rect", {
    x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top,
  }));
  const arrow = svgElement("marker", {
    id: "moody-arrow", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4,
    orient: "auto", markerUnits: "strokeWidth",
  });
  arrow.append(svgElement("path", { d: "M0,0 L8,4 L0,8 Z", fill: "#263d37" }));
  defs.append(clip, arrow);
  chart.append(defs);

  const grid = svgElement("g", { "aria-hidden": "true" });
  for (let decade = 2; decade <= 8; decade += 1) {
    for (let multiplier = 1; multiplier <= 9; multiplier += 1) {
      const reynoldsNumber = multiplier * 10 ** decade;
      if (reynoldsNumber < 500 || reynoldsNumber > 100000000) continue;
      const x = xPosition(reynoldsNumber);
      grid.append(svgElement("line", {
        x1: x, y1: plot.top, x2: x, y2: plot.bottom,
        class: multiplier === 1 ? "grid-major" : "grid-minor",
      }));
      if (multiplier === 1 || reynoldsNumber === 500) {
        const tick = svgElement("text", {
          x, y: plot.bottom + 22, "text-anchor": "middle", class: "axis-tick",
        });
        if (multiplier === 1 && decade >= 3) {
          tick.append(
            svgElement("tspan", {}, "10"),
            svgElement("tspan", { "baseline-shift": "super", "font-size": "9" }, String(decade)),
          );
        } else {
          tick.textContent = String(reynoldsNumber);
        }
        grid.append(tick);
      }
    }
  }

  const yTicks = [.008, .01, .015, .02, .03, .04, .05, .07, .1];
  for (const frictionFactor of yTicks) {
    const y = yPosition(frictionFactor);
    grid.append(svgElement("line", {
      x1: plot.left, y1: y, x2: plot.right, y2: y,
      class: [.01, .02, .05, .1, .2].includes(frictionFactor) ? "grid-major" : "grid-minor",
    }));
    grid.append(svgElement("text", {
      x: plot.left - 10, y: y + 4, "text-anchor": "end", class: "axis-tick y-axis-tick",
    }, String(frictionFactor)));
  }
  grid.append(
    svgElement("text", {
      x: xPosition(1100), y: plot.top - 14, "text-anchor": "middle", class: "region-label",
    }, "層流區：Re < 2300"),
    svgElement("text", {
      x: xPosition(3100), y: plot.top - 14, "text-anchor": "middle", class: "region-label",
    }, "過渡區"),
    svgElement("text", {
      x: xPosition(100000), y: plot.top - 14, "text-anchor": "middle", class: "region-label",
    }, "紊流區：Re > 4000"),
  );
  const transitionStart = xPosition(2300);
  const transitionEnd = xPosition(4000);
  grid.append(svgElement("rect", {
    x: transitionStart, y: plot.top, width: transitionEnd - transitionStart,
    height: plot.bottom - plot.top, class: "transition-band",
  }));
  const curvesGroup = svgElement("g", { "clip-path": "url(#moody-plot-clip)" });
  const curveLabels = [];
  chart.append(grid);
  const laminarPoints = [];
  for (let index = 0; index <= 60; index += 1) {
    const reynoldsNumber = 500 * (2300 / 500) ** (index / 60);
    laminarPoints.push(`${index === 0 ? "M" : "L"}${xPosition(reynoldsNumber)},${yPosition(64 / reynoldsNumber)}`);
  }
  curvesGroup.append(svgElement("path", { d: laminarPoints.join(" "), class: "curve curve-laminar" }));

  const smoothPoints = [];
  for (let index = 0; index <= 140; index += 1) {
    const reynoldsNumber = 2000 * (100000000 / 2000) ** (index / 140);
    const frictionFactor = calculateTurbulentMoodyCurveFactor(reynoldsNumber, 0);
    smoothPoints.push(`${index === 0 ? "M" : "L"}${xPosition(reynoldsNumber)},${yPosition(frictionFactor)}`);
  }
  curvesGroup.append(svgElement("path", {
    d: smoothPoints.join(" "), class: "curve curve-smooth", "data-relative-roughness": "0",
    "data-reynolds-start": "2000", "data-reynolds-end": "100000000",
  }));

  for (const curve of chartCurves) {
    const points = [];
    for (let index = 0; index <= 140; index += 1) {
      const reynoldsNumber = 2000 * (100000000 / 2000) ** (index / 140);
      const frictionFactor = calculateTurbulentMoodyCurveFactor(reynoldsNumber, curve.roughness);
      points.push(`${index === 0 ? "M" : "L"}${xPosition(reynoldsNumber)},${yPosition(frictionFactor)}`);
      if (index === 140) curveLabels.push({ ...curve, frictionFactor, curveY: yPosition(frictionFactor) });
    }
    curvesGroup.append(svgElement("path", {
      d: points.join(" "), class: "curve", stroke: curve.color,
      "data-reynolds-start": "2000", "data-reynolds-end": "100000000",
      "data-relative-roughness": curve.roughness,
    }));
  }
  chart.append(curvesGroup);

  const annotations = svgElement("g", { class: "curve-annotations" });
  const laminarTarget = { x: xPosition(1200), y: yPosition(64 / 1200) };
  annotations.append(
    svgElement("line", {
      x1: xPosition(720), y1: laminarTarget.y - 27, x2: laminarTarget.x, y2: laminarTarget.y,
      class: "curve-annotation-arrow", "marker-end": "url(#moody-arrow)", "data-target": "laminar",
    }),
    svgElement("text", {
      x: xPosition(720), y: laminarTarget.y - 32, class: "curve-annotation-label",
    }, "層流：f = 64 / Re"),
    svgElement("line", {
      x1: xPosition(30000), y1: yPosition(calculateTurbulentMoodyCurveFactor(30000, 0)) - 28,
      x2: xPosition(30000), y2: yPosition(calculateTurbulentMoodyCurveFactor(30000, 0)),
      class: "curve-annotation-arrow", "marker-end": "url(#moody-arrow)", "data-target": "smooth",
    }),
    svgElement("text", {
      x: xPosition(30000), y: yPosition(calculateTurbulentMoodyCurveFactor(30000, 0)) - 34,
      "text-anchor": "middle", class: "curve-annotation-label",
    }, "光滑管（ε / D = 0）"),
  );
  chart.append(annotations);

  chart.append(svgElement("rect", {
    x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top, class: "plot-border",
  }));
  const curveLabelsGroup = svgElement("g", { class: "roughness-curve-labels", "aria-hidden": "true" });
  curveLabelsGroup.append(svgElement("text", {
    x: plot.right + 14, y: plot.top - 14, class: "curve-label-title",
  }, "相對粗糙度 ε / D"));
  const labelGap = 15;
  const orderedLabels = [...curveLabels].sort((a, b) => a.curveY - b.curveY);
  for (let index = 0; index < orderedLabels.length; index += 1) {
    const label = orderedLabels[index];
    label.labelY = Math.max(label.curveY, index === 0 ? plot.top + 10 : orderedLabels[index - 1].labelY + labelGap);
  }
  const bottomOverflow = orderedLabels.at(-1).labelY - (plot.bottom - 5);
  if (bottomOverflow > 0) {
    for (const label of orderedLabels) label.labelY -= bottomOverflow;
  }
  for (const label of orderedLabels) {
    curveLabelsGroup.append(
      svgElement("line", {
        x1: plot.right, y1: label.curveY, x2: plot.right + 10, y2: label.labelY - 4,
        stroke: label.color, class: "curve-label-leader", "data-relative-roughness": label.roughness,
      }),
      svgElement("text", {
        x: plot.right + 14, y: label.labelY, fill: label.color, class: "curve-label",
        "data-relative-roughness": label.roughness, "dominant-baseline": "middle",
      }, String(label.roughness)),
    );
  }
  chart.append(curveLabelsGroup);
  chart.append(svgElement("text", {
    x: (plot.left + plot.right) / 2, y: 565, "text-anchor": "middle", class: "axis-title",
  }, "雷諾數 Re"));
  chart.append(svgElement("text", {
    x: 20, y: (plot.top + plot.bottom) / 2, "text-anchor": "middle", class: "axis-title",
    transform: `rotate(-90 20 ${(plot.top + plot.bottom) / 2})`,
  }, "Darcy 摩擦因子 f"));

  const legend = document.querySelector("#chart-legend");
  legend.replaceChildren();
  const laminarLegend = document.createElement("li");
  laminarLegend.innerHTML = '<span class="legend-line laminar" aria-hidden="true"></span>層流線：f = 64 / Re';
  legend.append(laminarLegend);
  updateMarker();
}

function updateMarker(frictionFactor = null) {
  chart.querySelector("#current-point")?.remove();
  if (frictionFactor === null) return;
  const reynoldsNumber = plottedReynoldsNumber;
  if (reynoldsNumber === null) return;
  const group = svgElement("g", { id: "current-point", "aria-label": `輸入位置：Re ${reynoldsNumber}，摩擦因子 ${frictionFactor}` });
  group.append(
    svgElement("circle", {
      cx: xPosition(reynoldsNumber), cy: yPosition(frictionFactor), r: 8, class: "current-point-halo",
    }),
    svgElement("circle", {
      cx: xPosition(reynoldsNumber), cy: yPosition(frictionFactor), r: 4, class: "current-point",
    }),
  );
  chart.append(group);
}

function calculate() {
  error.hidden = true;
  try {
    const calculation = calculateMoodyFromFluidProperties({
      density: document.querySelector("#density").valueAsNumber,
      velocity: document.querySelector("#velocity").valueAsNumber,
      diameterMm: document.querySelector("#diameter").valueAsNumber,
      dynamicViscosity: document.querySelector("#dynamic-viscosity").valueAsNumber,
      absoluteRoughnessMm: roughnessInput.valueAsNumber,
    });
    result.textContent = outputFormat.format(calculation.frictionFactor);
    regime.textContent = calculation.flowRegime;
    reynoldsResult.value = outputFormat.format(calculation.reynoldsNumber);
    relativeRoughnessResult.value = outputFormat.format(calculation.relativeRoughness);
    plottedReynoldsNumber = calculation.reynoldsNumber;
    status.textContent = calculation.flowRegime === "過渡區（估算）"
      ? "雷諾數位於過渡區，摩擦因子為估算值，請審慎使用。"
      : "計算完成，圖中圓點為輸入條件對應位置。";
    updateMarker(calculation.frictionFactor);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    error.textContent = cause.message;
    error.hidden = false;
    result.textContent = "—";
    regime.textContent = "—";
    reynoldsResult.value = "—";
    relativeRoughnessResult.value = "—";
    plottedReynoldsNumber = null;
    status.textContent = "計算未完成，請檢查輸入條件。";
    updateMarker();
  }
}

function clearResult() {
  error.hidden = true;
  result.textContent = "—";
  regime.textContent = "—";
  reynoldsResult.value = "—";
  relativeRoughnessResult.value = "—";
  plottedReynoldsNumber = null;
  updateMarker();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  calculate();
});
form.addEventListener("input", () => {
  clearResult();
  status.textContent = "條件已變更，請重新計算。";
});
form.addEventListener("change", () => {
  clearResult();
  status.textContent = "條件已變更，請重新計算。";
});
form.addEventListener("invalid", () => {
  clearResult();
  status.textContent = "請修正欄位中的無效或缺漏數值後重新計算。";
}, true);

drawChart();
calculate();
