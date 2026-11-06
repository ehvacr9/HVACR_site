import { calculateFinEfficiency } from "./fin-efficiency.js?v=4";

const form = document.querySelector("#fin-form");
const geometry = document.querySelector("#geometry");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
const status = document.querySelector("#status");
const numberFormat = new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 6 });

function value(id) {
  return document.querySelector(`#${id}`).valueAsNumber;
}

function setValue(id, number, suffix = "") {
  document.querySelector(`#${id}`).textContent = `${numberFormat.format(number)}${suffix}`;
}

function updateGeometryFields() {
  for (const field of document.querySelectorAll("[data-geometry]")) {
    const enabled = field.dataset.geometry.split(/\s+/).includes(geometry.value);
    field.hidden = !enabled;
    field.querySelector("input").disabled = !enabled;
  }
  document.querySelector("#length-help").textContent = geometry.value === "annular"
    ? "由管外壁到鰭片頂端的徑向距離。"
    : "由鰭片基底到尖端的長度。";
  for (const diagram of document.querySelectorAll("[data-geometry-diagram]")) {
    diagram.toggleAttribute("hidden", diagram.dataset.geometryDiagram !== geometry.value);
  }
  for (const result of document.querySelectorAll("[data-result-geometry]")) {
    result.hidden = result.dataset.resultGeometry === "straight"
      ? geometry.value === "annular"
      : result.dataset.resultGeometry !== geometry.value;
  }
}

function clearResults() {
  results.hidden = true;
  error.hidden = true;
  status.textContent = "條件已變更，請重新計算。";
}

geometry.addEventListener("change", updateGeometryFields);
form.addEventListener("input", clearResults);
form.addEventListener("change", clearResults);
form.addEventListener("invalid", () => {
  clearResults();
  status.textContent = "請修正欄位中的無效或缺漏數值後重新計算。";
}, true);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  error.hidden = true;
  try {
    const calculation = calculateFinEfficiency({
      geometry: geometry.value,
      convectionCoefficient: value("convection-coefficient"),
      conductivity: value("conductivity"),
      lengthMm: value("length"),
      widthMm: value("width"),
      thicknessMm: value(geometry.value === "annular" ? "annular-thickness" : "thickness"),
      diameterMm: value("diameter"),
      innerRadiusMm: value("pipe-radius"),
      finLengthMm: value("length"),
    });
    setValue("fin-efficiency", calculation.efficiency * 100, "%");
    if (geometry.value === "annular") {
      setValue("annular-parameter", calculation.parameterLength);
      setValue("annular-area", calculation.exposedArea * 1e4, " cm²");
    } else {
      setValue("fin-parameter", calculation.parameterLength);
      setValue("corrected-length", calculation.correctedLength * 1000, " mm");
    }
    results.hidden = false;
    status.textContent = "計算完成。";
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    error.textContent = cause.message;
    error.hidden = false;
    status.textContent = "計算未完成，請檢查輸入條件。";
  }
});

updateGeometryFields();
