import { calculateCycle, cycleFluids } from "./refrigeration-cycle.js";

const form = document.querySelector("#cycle-form");
const inputs = document.querySelector("#cycle-inputs");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const chart = document.querySelector("#chart");
const fluid = document.querySelector("#fluid");
const format = (value) => Number(value.toPrecision(6)).toString();
for (const name of cycleFluids) fluid.add(new Option(name === "Water" ? "水 (Water)" : name, name));
let cp;
let busy = false;

function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

async function drawCycle(cycle) {
  const { states, fluid: name } = cycle;
  const minimum = Math.max(cp.PropsSI("Tmin", "", 0, "", 0, name), cp.PropsSI("Ttriple", "", 0, "", 0, name));
  const criticalPressure = cp.PropsSI("pcrit", "", 0, "", 0, name);
  const minimumPressure = cp.PropsSI("P", "T", minimum + .01, "Q", 0, name);
  const lowerPressure = Math.max(minimumPressure * 1.01, states[0].p / 2);
  const upperPressure = Math.min(criticalPressure * .98, states[1].p * 1.2);
  if (![lowerPressure, upperPressure].every(Number.isFinite) || upperPressure <= lowerPressure) {
    throw new Error("無法取得此循環的圖表範圍。");
  }
  const dome = [[], []];
  for (let i = 0; i <= 120; i += 1) {
    const p = lowerPressure * (upperPressure / lowerPressure) ** (i / 120);
    for (const q of [0, 1]) {
      const h = cp.PropsSI("H", "P", p, "Q", q, name);
      if (!Number.isFinite(p) || !Number.isFinite(h) || p <= 0) {
        throw new Error("無法繪製此流體的飽和邊界，請調整操作條件。");
      }
      dome[q].push({ p, h });
    }
  }
  const points = [...states, ...dome.flat()];
  const hLow = Math.min(...points.map((point) => point.h)) / 1000;
  const hHigh = Math.max(...points.map((point) => point.h)) / 1000;
  const hPadding = (hHigh - hLow) * .12;
  const hMin = hLow - hPadding;
  const hMax = hHigh + hPadding;
  const pMin = Math.min(...points.map((point) => point.p)) / 1.5;
  const pMax = Math.max(...points.map((point) => point.p)) * 1.5;
  const x = (h) => 88 + (h / 1000 - hMin) / (hMax - hMin) * 650;
  const y = (p) => 440 - Math.log(p / pMin) / Math.log(pMax / pMin) * 400;
  const svg = svgElement("svg", { viewBox: "0 0 800 520", role: "img", "aria-label": `${name} 四點冷凍循環 Ph 圖` });
  const path = (list) => list.map((point, i) => `${i ? "L" : "M"}${x(point.h).toFixed(3)} ${y(point.p).toFixed(3)}`).join(" ");
  svg.append(svgElement("title", {}, `${name}：1→2 壓縮，2→3 冷凝，3→4 節流，4→1 蒸發`));
  for (let i = 0; i <= 5; i += 1) {
    const h = hMin + (hMax - hMin) * i / 5;
    const p = pMin * (pMax / pMin) ** (i / 5);
    svg.append(svgElement("path", { d: `M${x(h * 1000)} 40V440 M88 ${y(p)}H738`, stroke: "#e6ebe3", fill: "none" }));
    svg.append(svgElement("text", { x: x(h * 1000), y: 462, "text-anchor": "middle", "font-size": 12 }, Math.round(h)));
    svg.append(svgElement("text", { x: 78, y: y(p) + 4, "text-anchor": "end", "font-size": 12 }, Number((p / 1000).toPrecision(4))));
  }
  svg.append(svgElement("path", { d: `${path(dome[0])} ${path([...dome[1]].reverse())}`, stroke: "#92a79c", "stroke-width": 2, fill: "none", class: "cycle-dome" }));
  const colors = ["#c0392b", "#b56318", "#7160a2", "#2169a0"];
  const defs = svgElement("defs");
  colors.forEach((color, i) => {
    const marker = svgElement("marker", { id: `cycle-arrow-${i}`, viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto" });
    marker.append(svgElement("path", { d: "M0 0L10 5L0 10Z", fill: color }));
    defs.append(marker);
  });
  svg.append(defs);
  states.forEach((point, i) => {
    const next = states[(i + 1) % 4];
    const middle = { h: (point.h + next.h) / 2, p: Math.sqrt(point.p * next.p) };
    svg.append(svgElement("path", {
      d: path([point, middle, next]), fill: "none", stroke: colors[i], "stroke-width": 3,
      "stroke-dasharray": i === 0 ? "7 4" : "none", "marker-mid": `url(#cycle-arrow-${i})`, class: "cycle-process",
    }));
  });
  states.forEach((point, i) => {
    svg.append(svgElement("circle", { cx: x(point.h), cy: y(point.p), r: 5, fill: "#172b2b", class: "cycle-point" }));
    svg.append(svgElement("text", { x: x(point.h) + (i < 2 ? 12 : -12), y: y(point.p) + (i === 0 || i === 3 ? 22 : -12), "text-anchor": i < 2 ? "start" : "end", "font-size": 18, "font-weight": 700 }, i + 1));
  });
  svg.append(svgElement("text", { x: 413, y: 500, "text-anchor": "middle", "font-size": 14 }, "比焓 h (kJ/kg)"));
  svg.append(svgElement("text", { transform: "translate(22 240) rotate(-90)", "text-anchor": "middle", "font-size": 14 }, "絕對壓力 P (kPa)"));
  chart.replaceChildren(svg);
}

function renderResults(cycle) {
  document.querySelector("#result-title").textContent = `${cycle.fluid} 分析結果`;
  const metrics = [
    ["COP", cycle.cop, ""], ["冷凍效果", cycle.refrigeration / 1000, "kJ/kg"],
    ["壓縮比功", cycle.work / 1000, "kJ/kg"], ["冷凝放熱量", cycle.rejection / 1000, "kJ/kg"],
    ["排氣溫度", cycle.states[1].t - 273.15, "°C"], ["壓力比", cycle.pressureRatio, ""],
    ["冷媒質量流率", cycle.massFlow, "kg/s"], ["冷媒側壓縮功率", cycle.compressorPower, "kW"],
    ["冷凝器熱負荷", cycle.condenserCapacity, "kW"],
  ];
  document.querySelector("#metrics").replaceChildren(...metrics.map(([label, value, unit]) => {
    const card = document.createElement("div");
    card.className = "metric";
    const title = document.createElement("span");
    title.textContent = label;
    const number = document.createElement("strong");
    if (value === null) {
      number.className = "metric-placeholder";
      number.textContent = "輸入冷凍能力後顯示";
    } else {
      number.textContent = `${format(value)} ${unit}`.trim();
    }
    card.append(title, number);
    return card;
  }));
  const labels = ["1 壓縮機入口", "2 壓縮機出口", "3 冷凝器出口", "4 膨脹閥出口"];
  document.querySelector("#states").replaceChildren(...cycle.states.map((point, i) => {
    const row = document.createElement("tr");
    for (const value of [labels[i], point.t - 273.15, point.p / 1000, point.h / 1000, point.s / 1000, point.density, point.quality ?? "—（單相）"]) {
      const cell = document.createElement("td");
      cell.textContent = typeof value === "number" ? format(value) : value;
      row.append(cell);
    }
    return row;
  }));
}

function clearResults() {
  results.hidden = true;
  chart.replaceChildren();
  document.querySelector("#states").replaceChildren();
  document.querySelector("#metrics").replaceChildren();
}

form.addEventListener("input", (event) => {
  if (event.target.id !== "capacity") clearResults();
  status.dataset.kind = "";
  status.textContent = results.hidden ? "條件已變更，請重新分析。" : "冷凍能力已變更；目前顯示上次結果，請按「分析循環」更新。";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!cp || busy) return;
  busy = true;
  inputs.disabled = true;
  form.setAttribute("aria-busy", "true");
  clearResults();
  status.dataset.kind = "loading";
  status.textContent = "正在計算冷凍循環…";
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const number = (id) => {
      const value = document.querySelector(`#${id}`).value.trim();
      if (!value) throw new Error("請填寫必要的操作條件。");
      return Number(value);
    };
    const capacity = document.querySelector("#capacity").value.trim();
    const cycle = await calculateCycle(cp, {
      fluid: fluid.value, evaporation: number("evaporation"), condensation: number("condensation"),
      superheat: number("superheat"), subcooling: number("subcooling"), efficiency: number("efficiency") / 100,
      capacity: capacity ? Number(capacity) : null,
    });
    await drawCycle(cycle);
    renderResults(cycle);
    results.hidden = false;
    status.dataset.kind = "success";
    status.textContent = "循環分析完成。";
  } catch (error) {
    clearResults();
    status.dataset.kind = "error";
    status.textContent = `無法分析：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy = false;
    inputs.disabled = false;
    form.removeAttribute("aria-busy");
  }
});

try {
  const { default: initCoolProp } = await import("./coolprop/coolprop.js");
  cp = await initCoolProp();
  inputs.disabled = false;
  status.dataset.kind = "success";
  status.textContent = "輸入操作條件後，按「分析循環」。";
} catch (error) {
  status.dataset.kind = "error";
  status.textContent = `運算模組載入失敗：${error instanceof Error ? error.message : String(error)}。請重新整理頁面。`;
}
