import { calculateHumidAir, humidAirProperties } from "./humid-air.js";
import { createPsychrometricChart } from "./humid-air-chart.js";

const form = document.querySelector("#humid-air-form");
const inputs = document.querySelector("#humid-air-inputs");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const metrics = document.querySelector("#metrics");
const chartSection = document.querySelector("#psychrometric-chart-section");
const chartContainer = document.querySelector("#psychrometric-chart");
const chartStateMessage = document.querySelector("#chart-state-message");
const chartReadout = document.querySelector("#chart-readout");
const format = (value) => Number(value.toPrecision(6)).toString();
let cp;
let psychrometricChart;
let busy = false;

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
  metrics.replaceChildren();
  status.dataset.kind = "loading";
  status.textContent = "正在計算濕空氣狀態…";
  psychrometricChart.setState(null);
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
    const charted = psychrometricChart.setState({
      pressure: result.pressure,
      temperature: result.values.T - 273.15,
      humidityRatio: result.values.W,
    });
    chartStateMessage.textContent = charted
      ? "目前計算狀態已標示於圖中。"
      : "此狀態的壓力或性質超出 Chart No. 1 顯示範圍，因此未標示。";
    results.hidden = false;
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

try {
  const { default: initCoolProp } = await import("./coolprop/coolprop.js");
  cp = await initCoolProp();
  if (typeof cp.HAPropsSI !== "function") throw new Error("運算模組未提供濕空氣功能。");
  psychrometricChart = createPsychrometricChart(cp, (state) => {
    if (!state) {
      chartReadout.textContent = "在圖框內移動滑鼠可讀取該位置的濕空氣性質。";
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
  chartSection.hidden = false;
  inputs.disabled = false;
  status.dataset.kind = "success";
  status.textContent = "輸入已知條件後，按「計算狀態點」。";
} catch (error) {
  status.dataset.kind = "error";
  status.textContent = `運算模組載入失敗：${error instanceof Error ? error.message : String(error)}。請重新整理頁面。`;
}
