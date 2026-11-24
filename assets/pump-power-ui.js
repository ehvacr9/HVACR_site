import { calculatePumpPower } from "./pump-power.js";

const form = document.querySelector("#pump-form");
const result = document.querySelector("#result");
const error = document.querySelector("#error");
const status = document.querySelector("#status");

function clearResult() {
  result.hidden = true;
  error.hidden = true;
  status.textContent = "輸入條件已變更，請按計算更新結果。";
}

form.addEventListener("input", clearResult);
form.addEventListener("change", clearResult);
form.addEventListener("invalid", () => {
  clearResult();
  status.textContent = "請修正欄位中的無效或缺漏數值後重新計算。";
}, true);
form.addEventListener("submit", event => {
  event.preventDefault();
  clearResult();
  let power;
  try {
    power = calculatePumpPower({
      pressure: form.elements.pressure.valueAsNumber,
      pressureUnit: form.elements.pressureUnit.value,
      flow: form.elements.flow.valueAsNumber,
      flowUnit: form.elements.flowUnit.value,
      efficiency: form.elements.efficiency.valueAsNumber,
    });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    error.textContent = cause.message;
    error.hidden = false;
    status.textContent = "計算未完成，請修正輸入。";
    return;
  }
  const format = value => String(Number(value.toPrecision(6)));
  document.querySelector("#hydraulic-power").textContent = `${format(power.hydraulicPowerKw)} kW`;
  document.querySelector("#shaft-power").textContent = `${format(power.shaftPowerKw)} kW`;
  result.hidden = false;
  status.textContent = "計算完成。";
});
