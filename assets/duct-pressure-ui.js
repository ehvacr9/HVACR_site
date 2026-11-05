import { calculateDuctPressureLoss } from "./duct-pressure.js";

const form = document.querySelector("#duct-form");
const shape = document.querySelector("#shape");
const roughnessMaterial = document.querySelector("#roughness-material");
const roughness = document.querySelector("#roughness");
const results = document.querySelector("#results");
const error = document.querySelector("#error");
const status = document.querySelector("#status");
const numberFormat = new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 5 });
const roughnessByMaterial = {
  galvanized: .09,
  "commercial-steel": .045,
  "stainless-steel": .015,
  plastic: .0015,
  concrete: .3,
};

function showShapeFields() {
  const round = shape.value === "round";
  for (const element of document.querySelectorAll("[data-shape='round']")) {
    element.hidden = !round;
    element.querySelector("input").disabled = !round;
  }
  for (const element of document.querySelectorAll("[data-shape='rectangular']")) {
    element.hidden = round;
    element.querySelector("input").disabled = round;
  }
}

function updateRoughness() {
  roughness.value = String(roughnessByMaterial[roughnessMaterial.value]);
}

function clearResults() {
  results.hidden = true;
  error.hidden = true;
  status.textContent = "條件已變更，請重新計算。";
}

function setValue(id, value, suffix = "") {
  const formatted = typeof value === "number" ? numberFormat.format(value) : value;
  document.querySelector(`#${id}`).textContent = `${formatted}${suffix}`;
}

shape.addEventListener("change", showShapeFields);
roughnessMaterial.addEventListener("change", updateRoughness);
form.addEventListener("input", clearResults);
form.addEventListener("change", clearResults);
form.addEventListener("invalid", () => {
  clearResults();
  status.textContent = "請修正欄位中的無效或缺漏數值後重新計算。";
}, true);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearResults();
  const value = (id) => document.querySelector(`#${id}`).valueAsNumber;
  let result;
  try {
    result = calculateDuctPressureLoss({
      flowRateM3h: value("flow-rate"),
      shape: shape.value,
      diameterMm: value("diameter"),
      widthMm: value("width"),
      heightMm: value("height"),
      lengthM: value("length"),
      roughnessMm: value("roughness"),
      density: value("density"),
      viscosity: value("viscosity"),
      localLossCoefficient: value("local-k"),
      targetVelocity: value("target-velocity"),
    });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    error.textContent = cause.message;
    error.hidden = false;
    status.textContent = "計算未完成，請檢查輸入條件。";
    return;
  }

  setValue("result-area", result.area, " m²");
  setValue("result-velocity", result.velocity, " m/s");
  setValue("result-hydraulic-diameter", result.hydraulicDiameter * 1000, " mm");
  setValue("result-reynolds", result.reynoldsNumber);
  setValue("result-friction-factor", result.frictionFactor);
  setValue("result-flow-regime", result.flowRegime);
  setValue("result-friction-loss", result.frictionLoss, " Pa");
  setValue("result-local-loss", result.localLoss, " Pa");
  setValue("result-total-loss", result.totalLoss, " Pa");
  setValue("result-friction-rate", result.frictionRate, " Pa/m");
  setValue("result-required-area", result.requiredArea, " m²");
  setValue("result-round-size", result.recommendedCircularDiameter * 1000, " mm");
  setValue("result-square-size", result.recommendedSquareSide * 1000, " mm");
  setValue("result-rect-size",
    result.recommendedRectangularWidth * 1000, " × " +
    `${numberFormat.format(result.recommendedRectangularHeight * 1000)} mm`);
  document.querySelector("#transition-note").hidden = result.flowRegime !== "過渡區（估算）";
  results.hidden = false;
  status.textContent = "計算完成。尺寸建議依目標風速估算，請再核對實際系統需求。";
});

showShapeFields();
updateRoughness();
