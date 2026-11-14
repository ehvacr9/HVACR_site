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

const standardFittingCoefficients = {
  "elbow-90": { "10": 2.5, "15": 2.1, "20": 1.7, "25": 1.5, "32": 1.3, "40": 1.2, "50": 1.0, "65": 0.85, "80": 0.8, "100": 0.7 },
  "elbow-90-long": { "20": 0.92, "25": 0.78, "32": 0.65, "40": 0.54, "50": 0.42, "65": 0.35, "80": 0.31, "100": 0.24 },
  "elbow-45": { "10": 0.38, "15": 0.37, "20": 0.35, "25": 0.34, "32": 0.33, "40": 0.32, "50": 0.31, "65": 0.3, "80": 0.29, "100": 0.28 },
  "return-180": { "10": 2.5, "15": 2.1, "20": 1.7, "25": 1.5, "32": 1.3, "40": 1.2, "50": 1.0, "65": 0.85, "80": 0.8, "100": 0.7 },
  "tee-line": { "10": 0.9, "15": 0.9, "20": 0.9, "25": 0.9, "32": 0.9, "40": 0.9, "50": 0.9, "65": 0.9, "80": 0.9, "100": 0.9 },
  "tee-branch": { "10": 2.7, "15": 2.4, "20": 2.1, "25": 1.8, "32": 1.7, "40": 1.6, "50": 1.4, "65": 1.3, "80": 1.2, "100": 1.1 },
  "valve-globe": { "10": 20, "15": 14, "20": 10, "25": 9, "32": 8.5, "40": 8, "50": 7, "65": 6.5, "80": 6, "100": 5.7 },
  "valve-gate": { "10": 0.4, "15": 0.33, "20": 0.28, "25": 0.24, "32": 0.22, "40": 0.19, "50": 0.17, "65": 0.16, "80": 0.14, "100": 0.12 },
  "valve-angle": { "20": 6.1, "25": 4.6, "32": 3.6, "40": 2.9, "50": 2.1, "65": 1.6, "80": 1.3, "100": 1.0 },
  "valve-swing-check": { "10": 8, "15": 5.5, "20": 3.7, "25": 3, "32": 2.7, "40": 2.5, "50": 2.3, "65": 2.2, "80": 2.1, "100": 2.0 },
  "inlet-bell": 0.05,
  "inlet-square": 0.5,
  "inlet-projecting": 1,
  "outlet-reservoir": 1,
};

const steelPipeInsideDiameters = {
  "8": { "40": 9.25, "80": 7.67 },
  "10": { "40": 12.52, "80": 10.74 },
  "15": { "40": 15.8, "80": 13.87 },
  "20": { "40": 20.93, "80": 18.85 },
  "25": { "40": 26.64, "80": 24.31 },
  "32": { "40": 35.05, "80": 32.46 },
  "40": { "40": 40.89, "80": 38.1 },
  "50": { "40": 52.50, "80": 49.25 },
  "65": { "40": 62.71, "80": 59 },
  "80": { "40": 77.93, "80": 73.66 },
  "100": { "40": 102.26, "80": 97.18 },
};

export function steelPipeInsideDiameter(nominalMm, schedule) {
  const nominal = String(nominalMm);
  const wall = String(schedule);
  if (!Object.hasOwn(steelPipeInsideDiameters, nominal)
    || !Object.hasOwn(steelPipeInsideDiameters[nominal], wall)) {
    throw new RangeError("請選擇支援的鋼管公稱尺寸及 Schedule。");
  }
  return steelPipeInsideDiameters[nominal][wall];
}

export function standardFittingCoefficient(fitting, nominalMm) {
  if (!Object.hasOwn(standardFittingCoefficients, fitting)) {
    throw new RangeError("請選擇支援的標準管件型式。");
  }
  const coefficients = standardFittingCoefficients[fitting];
  if (typeof coefficients === "number") return coefficients;
  const nominal = String(nominalMm);
  if (!Object.hasOwn(coefficients, nominal)) {
    throw new RangeError("所選管件沒有該公稱管徑的參考係數。");
  }
  return coefficients[nominal];
}

export function calculateStandardFittingLoss({ fitting, nominalMm, diameterMm, flowM3h, density }) {
  const coefficient = standardFittingCoefficient(fitting, nominalMm);
  if (!Number.isFinite(diameterMm) || diameterMm <= 0 || !Number.isFinite(density) || density <= 0) {
    throw new RangeError("管內徑及流體密度必須為有限正數。");
  }
  if (!Number.isFinite(flowM3h) || flowM3h < 0) throw new RangeError("體積流量必須為有限非負數。");
  const area = Math.PI * (diameterMm / 1000) ** 2 / 4;
  const velocity = flowM3h / 3600 / area;
  const head = coefficient * velocity ** 2 / (2 * 9.80665);
  const pressureLoss = density * 9.80665 * head;
  const result = { velocity, coefficient, head, pressureLoss };
  if (!area || !Object.values(result).every(Number.isFinite)) {
    throw new RangeError("輸入尺度超出可計算範圍，請調整管徑或流量。");
  }
  return result;
}

export function calculateElbowLoss({ kind, ...input }) {
  return calculateStandardFittingLoss({ fitting: kind, ...input });
}
