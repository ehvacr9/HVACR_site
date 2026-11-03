import { calculateFanLaws, lawSets } from "./fan-laws.js";

const form = document.querySelector("#fan-form");
const law = document.querySelector("#law");
const error = document.querySelector("#error");
const warning = document.querySelector("#result-warning");
const status = document.querySelector("#result-status");

function clearResults() {
  for (const input of document.querySelectorAll("#target-conditions input:disabled")) input.value = "";
  warning.hidden = true;
  error.hidden = true;
  status.textContent = "條件已變更，請按計算更新結果。";
}
function updateLaw() {
  const definition = lawSets[law.value];
  document.querySelector("#law-hint").textContent = definition.hint;
  document.querySelector("#formulas").replaceChildren(...definition.formulas.map((text) => {
    const p = document.createElement("p");
    p.className = "formula";
    p.textContent = text;
    return p;
  }));
  for (const wrapper of document.querySelectorAll("[data-known]")) {
    const active = wrapper.dataset.known === definition.known;
    wrapper.querySelector("input").disabled = !active;
    wrapper.querySelector("input").required = active;
    wrapper.querySelector("input").placeholder = active ? "請輸入已知條件" : "計算後顯示";
    wrapper.querySelector(".field-role").textContent = active ? " · 已知" : " · 計算";
  }
}
form.addEventListener("input", clearResults);
form.addEventListener("change", clearResults);
law.addEventListener("change", updateLaw);
form.addEventListener("invalid", () => {
  clearResults();
  status.textContent = "請修正欄位中的無效或缺漏數值後重新計算。";
}, true);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearResults();
  const read = (prefix, keys) => Object.fromEntries(keys.map((key) => [key, document.querySelector(`#${prefix}-${key}`).valueAsNumber]));
  const base = read("base", ["diameter", "speed", "flow", "pressure", "power", "density"]);
  const target = read("target", ["diameter", "density", lawSets[law.value].known]);
  let result;
  try {
    result = calculateFanLaws({ law: law.value, base, target });
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    error.textContent = cause.message;
    error.hidden = false;
    status.textContent = "計算未完成，請修正輸入。";
    return;
  }
  for (const wrapper of document.querySelectorAll("[data-known]")) {
    const input = wrapper.querySelector("input");
    if (input.disabled) input.value = String(Number(result[wrapper.dataset.known].toPrecision(7)));
  }
  warning.textContent = "估算結果須依實際系統曲線及設備性能曲線核對；壓差定義需一致，軸功率也不可直接視為耗電量。";
  warning.hidden = false;
  status.textContent = `${lawSets[law.value].label}計算完成。`;
});
updateLaw();
