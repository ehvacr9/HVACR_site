import { calculatePipeLoss, calculateTeeLoss, calculateStandardFittingLoss, standardFittingCoefficient, lossCoefficient, steelPipeInsideDiameter } from "./pipe-loss.js?v=5";

const byId = (id) => document.getElementById(id);
const selectedKind = () => document.querySelector('input[name="kind"]:checked').value;
const isTee = () => ["tee-dividing", "tee-combining"].includes(selectedKind());
const isStandardFitting = () => document.querySelector('input[name="kind"]:checked').hasAttribute("data-standard-fitting");
const form = byId("loss-form");
const format = new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 6 });
const svgNamespace = "http://www.w3.org/2000/svg";

function reset() {
  for (const id of ["ratio-result", "k-result", "velocity-result", "v1-result", "v2-result", "head-result", "pressure-result"]) {
    byId(id).textContent = "—";
  }
  for (const value of byId("tee-results").querySelectorAll("dd")) value.textContent = "—";
  for (const value of byId("fitting-results").querySelectorAll("dd")) value.textContent = "—";
  byId("current-point").setAttribute("hidden", "");
  byId("tee-straight-point").setAttribute("hidden", "");
  byId("tee-branch-point").setAttribute("hidden", "");
  byId("error").hidden = true;
  byId("status").textContent = "條件已變更，請重新計算。";
}

function draw() {
  const tee = isTee();
  const standardFitting = isStandardFitting();
  for (const field of document.querySelectorAll("[data-transition-field], [data-tee-field], [data-standard-fitting-field]")) {
    const active = field.hasAttribute(tee ? "data-tee-field" : standardFitting ? "data-standard-fitting-field" : "data-transition-field");
    field.hidden = !active;
    for (const control of field.querySelectorAll("input, select")) control.disabled = !active;
  }
  const fitting = selectedKind();
  const constantFitting = ["inlet-bell", "inlet-square", "inlet-projecting", "outlet-reservoir"].includes(fitting);
  const nominalField = byId("fitting-nominal").closest("[data-standard-fitting-field]");
  nominalField.hidden = !standardFitting || constantFitting;
  byId("fitting-nominal").disabled = !standardFitting || constantFitting;
  byId("transition-results-panel").hidden = tee || standardFitting;
  byId("tee-results-panel").hidden = !tee;
  byId("fitting-results-panel").hidden = !standardFitting;
  byId("flow-label").textContent = tee ? "共同管口總流量 Q（m³/h）" : "實際體積流量 Q（m³/h）";
  byId("flow-hint").textContent = tee
    ? (selectedKind() === "tee-dividing" ? "共同管口為入口，請輸入入口總流量。" : "共同管口為出口，請輸入出口總流量。")
    : "若只查 K，可將流量設為 0。";
  if (tee) {
    byId("velocity-basis").textContent = "三管口等內徑；K 以共同管口總流量對應的流速為基準，為保守上限估算。";
    return;
  }
  if (standardFitting) {
    byId("velocity-basis").textContent = constantFitting
      ? "入口或出口損失以該管口平均流速為基準；排入大型槽體採出口速度水頭全部耗散。"
      : "ASHRAE 表列螺紋鋼管管件；K 依型式及公稱管徑選取，並以實際管內平均流速為基準。";
    return;
  }
  const expansion = selectedKind() === "expansion";
  byId("velocity-basis").textContent = expansion
    ? "突擴：D₂ ≥ D₁；K 以上游小管流速 V₁ 為基準。"
    : "突縮：D₂ ≤ D₁；K 以下游小管流速 V₂ 為基準（銳邊工程近似）。";
  byId("ratio-axis").textContent = expansion ? "A₁/A₂（小管／大管）" : "A₂/A₁（小管／大管）";
  byId("curve-caption").textContent = expansion ? "突擴：K = (1 − r)²，以上游 V₁ 為基準。" : "突縮：K ≈ 0.5(1 − r)，以下游 V₂ 為基準。";
  const points = Array.from({ length: 101 }, (_, i) => {
    const r = i / 100;
    return `${i === 0 ? "M" : "L"}${60 + 380 * r} ${250 - 220 * lossCoefficient(selectedKind(), r)}`;
  });
  byId("curve").setAttribute("d", points.join(" "));
}

for (let i = 0; i <= 5; i += 1) {
  const r = i / 5;
  for (const [x1, y1, x2, y2] of [[60 + 380 * r, 30, 60 + 380 * r, 250], [60, 250 - 220 * r, 440, 250 - 220 * r]]) {
    const line = document.createElementNS(svgNamespace, "line");
    for (const [key, value] of Object.entries({ x1, y1, x2, y2, stroke: "#dce2d8" })) line.setAttribute(key, value);
    byId("chart-grid").append(line);
  }
  for (const [x, y, anchor] of [[60 + 380 * r, 270, "middle"], [50, 255 - 220 * r, "end"]]) {
    const text = document.createElementNS(svgNamespace, "text");
    text.setAttribute("x", x);
    text.setAttribute("y", y);
    text.setAttribute("text-anchor", anchor);
    text.textContent = r.toFixed(1);
    byId("chart-grid").append(text);
  }
  for (const [x1, y1, x2, y2] of [[60 + 380 * r, 30, 60 + 380 * r, 250], [60, 250 - 220 * r, 440, 250 - 220 * r]]) {
    const line = document.createElementNS(svgNamespace, "line");
    for (const [key, value] of Object.entries({ x1, y1, x2, y2, stroke: "#dce2d8" })) line.setAttribute(key, value);
    byId("tee-chart-grid").append(line);
  }
  for (const [x, y, anchor, label] of [[60 + 380 * r, 270, "middle", String(i * 20)], [50, 255 - 220 * r, "end", (r * 2).toFixed(1)]]) {
    const text = document.createElementNS(svgNamespace, "text");
    text.setAttribute("x", x);
    text.setAttribute("y", y);
    text.setAttribute("text-anchor", anchor);
    text.textContent = label;
    byId("tee-chart-grid").append(text);
  }
}

for (const [id, fraction] of [["tee-straight-curve", (x) => 1 - x], ["tee-branch-curve", (x) => x]]) {
  byId(id).setAttribute("d", Array.from({ length: 101 }, (_, i) => {
    const x = i / 100;
    return `${i === 0 ? "M" : "L"}${60 + 380 * x} ${250 - 110 * (1 + fraction(x) ** 2)}`;
  }).join(" "));
}

document.querySelector(".component-choices").addEventListener("change", () => {
  const upstream = byId("upstream");
  const downstream = byId("downstream");
  if ((selectedKind() === "expansion" && upstream.valueAsNumber > downstream.valueAsNumber)
    || (selectedKind() === "contraction" && upstream.valueAsNumber < downstream.valueAsNumber)) {
    [upstream.value, downstream.value] = [downstream.value, upstream.value];
  }
  if (isStandardFitting()) updateFittingSelection();
  else draw();
  reset();
});
function updateFittingDiameter() {
  const diameter = byId("fitting-diameter");
  const schedule = byId("fitting-schedule").value;
  const custom = schedule === "custom";
  diameter.readOnly = !custom;
  diameter.value = custom ? "" : steelPipeInsideDiameter(byId("fitting-nominal").value, schedule);
  byId("fitting-diameter-hint").textContent = custom
    ? "請輸入與所選公稱尺寸相符的實際內徑。"
    : "依公稱管徑與 Schedule 帶入參考內徑；請核對實際管材。";
}
function updateFittingSelection() {
  const fitting = selectedKind();
  const nominal = byId("fitting-nominal");
  for (const option of nominal.options) {
    try {
      standardFittingCoefficient(fitting, option.value);
      option.disabled = false;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      option.disabled = true;
    }
  }
  if (nominal.selectedOptions[0].disabled) {
    nominal.value = [...nominal.options].find((option) => !option.disabled)?.value ?? "";
  }
  updateFittingDiameter();
  draw();
  reset();
}
byId("fitting-nominal").addEventListener("change", () => { updateFittingDiameter(); reset(); });
byId("fitting-schedule").addEventListener("change", () => { updateFittingDiameter(); reset(); });
form.addEventListener("input", reset);
form.addEventListener("change", reset);
form.addEventListener("invalid", () => {
  reset();
  byId("status").textContent = "請修正無效或缺漏的輸入值。";
}, true);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  reset();
  try {
    if (isStandardFitting()) {
      const result = calculateStandardFittingLoss({
        fitting: selectedKind(),
        nominalMm: byId("fitting-nominal").value,
        diameterMm: byId("fitting-diameter").valueAsNumber,
        flowM3h: byId("flow").valueAsNumber,
        density: byId("density").valueAsNumber,
      });
      for (const [id, key] of [["k", "coefficient"], ["velocity", "velocity"], ["head", "head"], ["pressure", "pressureLoss"]]) {
        byId(`fitting-${id}-result`).textContent = format.format(result[key]);
      }
      byId("status").textContent = "計算完成。";
      return;
    }
    if (isTee()) {
      const branchFraction = byId("tee-fraction").valueAsNumber / 100;
      const result = calculateTeeLoss({
        diameterMm: byId("tee-diameter").valueAsNumber,
        flowM3h: byId("flow").valueAsNumber,
        density: byId("density").valueAsNumber,
        branchFraction,
      });
      byId("tee-velocity-result").textContent = format.format(result.velocity);
      for (const name of ["straight", "branch"]) {
        const path = result[name];
        byId(`tee-${name}-flow-result`).textContent = format.format(path.flow);
        if (path.flow > 0) {
          for (const [id, key] of [["k", "coefficient"], ["head", "head"], ["pressure", "pressureLoss"]]) {
            byId(`tee-${name}-${id}-result`).textContent = format.format(path[key]);
          }
          const point = byId(`tee-${name}-point`);
          point.setAttribute("cx", 60 + 380 * branchFraction);
          point.setAttribute("cy", 250 - 110 * path.coefficient);
          point.removeAttribute("hidden");
        }
      }
      byId("status").textContent = "計算完成。";
      return;
    }
    const result = calculatePipeLoss({
      kind: selectedKind(),
      upstreamMm: byId("upstream").valueAsNumber,
      downstreamMm: byId("downstream").valueAsNumber,
      flowM3h: byId("flow").valueAsNumber,
      density: byId("density").valueAsNumber,
    });
    for (const [id, key] of Object.entries({
      "ratio-result": "ratio", "k-result": "coefficient", "velocity-result": "referenceVelocity",
      "v1-result": "upstreamVelocity", "v2-result": "downstreamVelocity",
      "head-result": "head", "pressure-result": "pressureLoss",
    })) byId(id).textContent = format.format(result[key]);
    byId("current-point").setAttribute("cx", 60 + 380 * result.ratio);
    byId("current-point").setAttribute("cy", 250 - 220 * result.coefficient);
    byId("current-point").removeAttribute("hidden");
    byId("status").textContent = "計算完成。";
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    byId("error").textContent = cause.message;
    byId("error").hidden = false;
    byId("status").textContent = "計算未完成，請檢查條件。";
  }
});
draw();
