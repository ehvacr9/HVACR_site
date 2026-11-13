export function lossCoefficient(kind, areaRatio) {
  if (!["expansion", "contraction"].includes(kind)) throw new RangeError("請選擇突縮或突擴。");
  if (!Number.isFinite(areaRatio) || areaRatio < 0 || areaRatio > 1) {
    throw new RangeError("小管與大管的面積比必須介於 0 與 1。");
  }
  return kind === "expansion" ? (1 - areaRatio) ** 2 : 0.5 * (1 - areaRatio);
}

export function calculatePipeLoss({ kind, upstreamMm, downstreamMm, flowM3h, density }) {
  for (const number of [upstreamMm, downstreamMm, density]) {
    if (!Number.isFinite(number) || number <= 0) throw new RangeError("管內徑及流體密度必須為有限正數。");
  }
  if (!Number.isFinite(flowM3h) || flowM3h < 0) throw new RangeError("體積流量必須為有限非負數。");
  if (kind === "expansion" && downstreamMm < upstreamMm) throw new RangeError("突擴的下游管徑不得小於上游管徑。");
  if (kind === "contraction" && downstreamMm > upstreamMm) throw new RangeError("突縮的下游管徑不得大於上游管徑。");
  const ratio = (Math.min(upstreamMm, downstreamMm) / Math.max(upstreamMm, downstreamMm)) ** 2;
  const coefficient = lossCoefficient(kind, ratio);
  const upstreamArea = Math.PI * (upstreamMm / 1000) ** 2 / 4;
  const downstreamArea = Math.PI * (downstreamMm / 1000) ** 2 / 4;
  const upstreamVelocity = flowM3h / 3600 / upstreamArea;
  const downstreamVelocity = flowM3h / 3600 / downstreamArea;
  const referenceVelocity = kind === "expansion" ? upstreamVelocity : downstreamVelocity;
  const head = coefficient * referenceVelocity ** 2 / (2 * 9.80665);
  const pressureLoss = density * 9.80665 * head;
  const result = { ratio, coefficient, upstreamVelocity, downstreamVelocity, referenceVelocity, head, pressureLoss };
  if (!Object.values(result).every(Number.isFinite) || upstreamArea === 0 || downstreamArea === 0) {
    throw new RangeError("輸入尺度超出可計算範圍，請調整管徑或流量。");
  }
  return result;
}

export function calculateTeeLoss({ diameterMm, flowM3h, density, branchFraction }) {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0 || !Number.isFinite(density) || density <= 0) {
    throw new RangeError("管內徑及流體密度必須為有限正數。");
  }
  if (!Number.isFinite(flowM3h) || flowM3h < 0) throw new RangeError("總體積流量必須為有限非負數。");
  if (!Number.isFinite(branchFraction) || branchFraction < 0 || branchFraction > 1) {
    throw new RangeError("支管流量比例必須介於 0 與 100%。");
  }
  const area = Math.PI * (diameterMm / 1000) ** 2 / 4;
  const velocity = flowM3h / 3600 / area;
  const path = (fraction) => {
    const coefficient = 1 + fraction ** 2;
    const head = coefficient * velocity ** 2 / (2 * 9.80665);
    return { flow: flowM3h * fraction, coefficient, head, pressureLoss: density * 9.80665 * head };
  };
  const result = { velocity, straight: path(1 - branchFraction), branch: path(branchFraction) };
  if (!area || !Number.isFinite(velocity)
    || ![...Object.values(result.straight), ...Object.values(result.branch)].every(Number.isFinite)) {
    throw new RangeError("輸入尺度超出可計算範圍，請調整管徑或流量。");
  }
  return result;
}
