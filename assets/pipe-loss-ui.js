import { calculatePipeLoss, lossCoefficient } from "./pipe-loss.js";

const byId = (id) => document.getElementById(id);
const form = byId("loss-form");
const format = new Intl.NumberFormat("zh-TW", { maximumSignificantDigits: 6 });
const svgNamespace = "http://www.w3.org/2000/svg";

function reset() {
  byId("results").hidden = true;
  byId("current-point").setAttribute("hidden", "");
  byId("error").hidden = true;
  byId("status").textContent = "條件已變更，請重新計算。";
}

function draw() {
  const expansion = byId("kind").value === "expansion";
  byId("velocity-basis").textContent = expansion
    ? "突擴：D₂ ≥ D₁；K 以上游小管流速 V₁ 為基準。"
    : "突縮：D₂ ≤ D₁；K 以下游小管流速 V₂ 為基準（銳邊工程近似）。";
  const left = expansion ? 85 : 50;
  const right = expansion ? 50 : 85;
  byId("pipe-wall").setAttribute("d", `M35 ${left} H240 V${right} H445 M35 ${250 - left} H240 V${250 - right} H445`);
  byId("pipe-fill").setAttribute("d", `M35 ${left} H240 V${right} H445 V${250 - right} H240 V${250 - left} H35 Z`);
  byId("pipe-title").textContent = expansion ? "突擴管路示意圖" : "突縮管路示意圖";
  byId("diameter-one").textContent = expansion ? "D₁：小管" : "D₁：大管";
  byId("diameter-two").textContent = expansion ? "D₂：大管" : "D₂：小管";
  byId("ratio-axis").textContent = expansion ? "A₁/A₂（小管／大管）" : "A₂/A₁（小管／大管）";
  byId("curve-caption").textContent = expansion ? "突擴：K = (1 − r)²，以上游 V₁ 為基準。" : "突縮：K ≈ 0.5(1 − r)，以下游 V₂ 為基準。";
  const points = Array.from({ length: 101 }, (_, i) => {
    const r = i / 100;
    return `${i === 0 ? "M" : "L"}${60 + 380 * r} ${250 - 220 * lossCoefficient(byId("kind").value, r)}`;
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
}

byId("kind").addEventListener("change", () => {
  const upstream = byId("upstream");
  const downstream = byId("downstream");
  if ((byId("kind").value === "expansion" && upstream.valueAsNumber > downstream.valueAsNumber)
    || (byId("kind").value === "contraction" && upstream.valueAsNumber < downstream.valueAsNumber)) {
    [upstream.value, downstream.value] = [downstream.value, upstream.value];
  }
  draw();
});
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
    const result = calculatePipeLoss({
      kind: byId("kind").value,
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
    byId("results").hidden = false;
    byId("status").textContent = "計算完成。";
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    byId("error").textContent = cause.message;
    byId("error").hidden = false;
    byId("status").textContent = "計算未完成，請檢查條件。";
  }
});
draw();
