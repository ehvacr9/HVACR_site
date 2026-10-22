import { calculateHumidAir, humidAirProperties } from "./humid-air.js";
import { createPsychrometricChart } from "./humid-air-chart.js";

const form = document.querySelector("#humid-air-form");
const inputs = document.querySelector("#humid-air-inputs");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const resultsPlaceholder = document.querySelector("#results-placeholder");
const metrics = document.querySelector("#metrics");
const chartSection = document.querySelector("#psychrometric-chart-section");
const chartContainer = document.querySelector("#psychrometric-chart");
const chartStateMessage = document.querySelector("#chart-state-message");
const chartReadout = document.querySelector("#chart-readout");
const format = (value) => Number(value.toPrecision(6)).toString();
let cp;
let psychrometricChart;
let busy = false;
let drawingBusy = false;
let calculatedState = null;
const drawingStatus = document.querySelector("#chart-drawing-status");

function updateChartState() {
  if (!psychrometricChart) return;
  const charted = psychrometricChart.setState(calculatedState);
  if (calculatedState) {
    chartStateMessage.textContent = charted
      ? ""
      : "此狀態的壓力或性質超出 Chart No. 1 顯示範圍，因此未標示。";
  }
}

const downloadStatus = document.querySelector("#chart-download-status");
const downloadButtons = document.querySelectorAll(".chart-actions button");
async function downloadChart(blackWhite) {
  downloadButtons.forEach((button) => { button.disabled = true; });
  downloadStatus.dataset.kind = "loading";
  downloadStatus.textContent = "正在產生 PNG 圖片…";
  let svgUrl;
  try {
    const svg = chartContainer.querySelector("svg");
    if (!svg) throw new Error("請先繪製濕空氣圖，再下載圖片。");
    const clone = svg.cloneNode(true);
    const properties = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linejoin",
      "font-family", "font-size", "font-weight", "paint-order", "dominant-baseline"];
    const originals = [svg, ...svg.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    originals.forEach((node, index) => {
      const style = getComputedStyle(node);
      for (const property of properties) copies[index].style.setProperty(property, style.getPropertyValue(property));
    });
    clone.querySelector(".psychrometric-crosshair")?.remove();
    clone.querySelector(".psychrometric-state-marker")?.remove();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "1000");
    clone.setAttribute("height", "670");
    svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("濕空氣圖圖片載入失敗。"));
      image.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 1340;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法建立圖片，請使用支援 Canvas 的瀏覽器。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (blackWhite) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const gray = Math.round(.2126 * pixels.data[index] + .7152 * pixels.data[index + 1] + .0722 * pixels.data[index + 2]);
        pixels.data[index] = gray;
        pixels.data[index + 1] = gray;
        pixels.data[index + 2] = gray;
      }
      context.putImageData(pixels, 0, 0);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG 圖片產生失敗，請再試一次。");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `psychrometric-chart-no-1${blackWhite ? "-bw" : ""}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    downloadStatus.dataset.kind = "success";
    downloadStatus.textContent = "PNG 圖片已產生。";
  } catch (error) {
    downloadStatus.dataset.kind = "error";
    downloadStatus.textContent = `無法下載：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    downloadButtons.forEach((button) => { button.disabled = false; });
  }
}
document.querySelector("#chart-download-color").addEventListener("click", () => downloadChart(false));
document.querySelector("#chart-download-bw").addEventListener("click", () => downloadChart(true));

const updateMode = () => {
  const drawing = document.querySelector('input[name="mode-category"]:checked').value === "drawing";
  document.querySelector("#calculation-section").hidden = drawing;
  chartSection.hidden = !drawing;
  if (drawing) {
    if (cp) void drawChart();
    else drawingStatus.textContent = "等待運算模組載入後繪製濕空氣圖。";
  }
};
for (const input of document.querySelectorAll('input[name="mode-category"]')) {
  input.addEventListener("change", updateMode);
}

for (const suffix of ["one", "two"]) {
  const select = document.querySelector(`#property-${suffix}`);
  for (const [key, spec] of Object.entries(humidAirProperties)) {
    select.add(new Option(`${spec.label} (${spec.unit})`, key));
  }
  select.value = suffix === "one" ? "T" : "R";
  const updateLabel = () => {
    const spec = humidAirProperties[select.value];
    document.querySelector(`#label-${suffix}`).textContent = `${spec.label} (${spec.unit})`;
  };
  select.addEventListener("change", () => {
    document.querySelector(`#value-${suffix}`).value = "";
    updateLabel();
  });
  updateLabel();
}

document.querySelector("#clear-inputs").addEventListener("click", () => {
  document.querySelector("#value-one").value = "";
  document.querySelector("#value-two").value = "";
  results.hidden = true;
  resultsPlaceholder.hidden = false;
  metrics.replaceChildren();
  document.querySelector("#pressure-summary").textContent = "";
  calculatedState = null;
  psychrometricChart?.setState(null);
  chartStateMessage.textContent = "";
  status.dataset.kind = "";
  status.textContent = "已清除輸入與計算結果。";
});

form.addEventListener("input", () => {
  status.dataset.kind = "";
  status.textContent = results.hidden ? "請輸入條件後計算。" : "條件已變更；目前顯示上次結果，請重新計算。";
  if (psychrometricChart && !results.hidden) chartStateMessage.textContent = "圖上仍標示上次計算的狀態點。";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!cp || busy) return;
  busy = true;
  inputs.disabled = true;
  form.setAttribute("aria-busy", "true");
  results.hidden = true;
  resultsPlaceholder.hidden = false;
  metrics.replaceChildren();
  status.dataset.kind = "loading";
  status.textContent = "正在計算濕空氣狀態…";
  calculatedState = null;
  psychrometricChart?.setState(null);
  chartStateMessage.textContent = "正在計算新的狀態點…";
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const number = (selector) => {
      const text = document.querySelector(selector).value.trim();
      if (!text) throw new RangeError("請填寫總壓力與兩項性質數值。");
      return Number(text);
    };
    const result = calculateHumidAir(cp, {
      pressure: number("#pressure"), key1: document.querySelector("#property-one").value,
      value1: number("#value-one"), key2: document.querySelector("#property-two").value,
      value2: number("#value-two"),
    });
    for (const [key, spec] of Object.entries(humidAirProperties)) {
      const card = document.createElement("div");
      card.className = "metric";
      card.dataset.property = key;
      const title = document.createElement("span");
      title.textContent = spec.label;
      const value = document.createElement("strong");
      if (result.values[key] === null) {
        value.className = "metric-placeholder";
        value.textContent = "—（乾空氣無露點）";
      } else value.textContent = `${format(spec.fromSI(result.values[key]))} ${spec.unit}`;
      card.append(title, value);
      metrics.append(card);
    }
    document.querySelector("#pressure-summary").textContent = `總絕對壓力 ${format(result.pressure)} kPa`;
    calculatedState = {
      pressure: result.pressure,
      temperature: result.values.T - 273.15,
      humidityRatio: result.values.W,
    };
    updateChartState();
    results.hidden = false;
    resultsPlaceholder.hidden = true;
    status.dataset.kind = "success";
    status.textContent = "狀態點計算完成。";
  } catch (error) {
    metrics.replaceChildren();
    chartStateMessage.textContent = "此輸入條件無有效的圖表狀態點。";
    status.dataset.kind = "error";
    status.textContent = `無法計算：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy = false;
    inputs.disabled = false;
    form.removeAttribute("aria-busy");
  }
});

async function drawChart() {
  if (psychrometricChart || drawingBusy) return;
  drawingBusy = true;
  drawingStatus.dataset.kind = "loading";
  drawingStatus.textContent = "正在繪製濕空氣圖…";
  chartContainer.setAttribute("aria-busy", "true");
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (chartSection.hidden) {
      drawingStatus.textContent = "";
      return;
    }
  psychrometricChart = createPsychrometricChart(cp, (state) => {
    if (!state) {
      chartReadout.textContent = "尚未選取狀態點。";
      return;
    }
    if (!state.valid) {
      chartReadout.textContent = `乾球溫度 ${format(state.temperature)} °C；濕度比 ${(state.humidityRatio * 1000).toFixed(2)} g/kg。此座標超出有效未飽和濕空氣範圍。`;
      return;
    }
    const dewPoint = state.dewPoint === null ? "乾空氣無露點" : `${format(state.dewPoint)} °C`;
    chartReadout.textContent = [
      `乾球 ${format(state.temperature)} °C`,
      `濕球 ${format(state.wetBulb)} °C`,
      `露點 ${dewPoint}`,
      `相對濕度 ${format(state.relativeHumidity * 100)}%`,
      `濕度比 ${(state.humidityRatio * 1000).toFixed(2)} g/kg`,
      `比焓 ${format(state.enthalpy)} kJ/kg 乾空氣`,
      `比容 ${format(state.specificVolume)} m³/kg 乾空氣`,
    ].join("　｜　");
  });
  chartContainer.replaceChildren(psychrometricChart.svg);
  downloadButtons.forEach((button) => { button.disabled = false; });
  updateChartState();
  drawingStatus.dataset.kind = "success";
  drawingStatus.textContent = "濕空氣圖繪製完成。";
  } catch (error) {
    drawingStatus.dataset.kind = "error";
    drawingStatus.textContent = `無法繪製：${error instanceof Error ? error.message : String(error)}。請切換至計算後再重試。`;
  } finally {
    drawingBusy = false;
    chartContainer.removeAttribute("aria-busy");
  }
}

try {
  const { default: initCoolProp } = await import("./coolprop/coolprop.js");
  cp = await initCoolProp();
  if (typeof cp.HAPropsSI !== "function") throw new Error("運算模組未提供濕空氣功能。");
  const reference = calculateHumidAir(cp, {
    pressure: 101.325, key1: "T", value1: 24, key2: "R", value2: 50,
  });
  calculatedState = {
    pressure: reference.pressure,
    temperature: reference.values.T - 273.15,
    humidityRatio: reference.values.W,
  };
  inputs.disabled = false;
  status.dataset.kind = "success";
  status.textContent = "輸入已知條件後，按「計算」。";
  updateMode();
} catch (error) {
  status.dataset.kind = "error";
  status.textContent = `運算模組載入失敗：${error instanceof Error ? error.message : String(error)}。請重新整理頁面。`;
}
