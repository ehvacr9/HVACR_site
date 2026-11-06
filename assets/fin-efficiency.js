function requirePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} 必須是大於零的有限數值。`);
  }
}

function calculateAnnularFinEfficiency(input) {
  const {
    convectionCoefficient,
    conductivity,
    innerRadiusMm,
    finLengthMm,
    thicknessMm,
  } = input;
  requirePositive(convectionCoefficient, "對流熱傳係數");
  requirePositive(conductivity, "材料熱傳導係數");
  requirePositive(innerRadiusMm, "管外半徑");
  requirePositive(finLengthMm, "環狀鰭片長度");
  requirePositive(thicknessMm, "環狀鰭片厚度");

  const innerRadius = innerRadiusMm / 1000;
  const finLength = finLengthMm / 1000;
  const outerRadius = innerRadius + finLength;
  const thickness = thicknessMm / 1000;
  if (!Number.isFinite(outerRadius) || outerRadius <= innerRadius) {
    throw new RangeError("管外半徑與鰭片長度的總和必須是有限的有效外半徑。");
  }

  const segments = 240;
  const step = (outerRadius - innerRadius) / segments;
  const diagonal = new Float64Array(segments);
  const upper = new Float64Array(segments);
  const rightHandSide = new Float64Array(segments);
  const surfaceAreas = new Float64Array(segments);
  const innerConductances = new Float64Array(segments);
  const tipConductance = 1 / (
    step / (2 * conductivity * 2 * Math.PI * outerRadius * thickness)
    + 1 / (convectionCoefficient * 2 * Math.PI * outerRadius * thickness)
  );

  for (let index = 0; index < segments; index += 1) {
    const innerFace = innerRadius + index * step;
    const outerFace = innerFace + step;
    const innerDistance = index === 0 ? step / 2 : step;
    const innerConductance = conductivity * 2 * Math.PI * innerFace * thickness / innerDistance;
    const outerConductance = index === segments - 1
      ? tipConductance
      : conductivity * 2 * Math.PI * outerFace * thickness / step;
    const exposedArea = 2 * Math.PI * (outerFace ** 2 - innerFace ** 2);

    innerConductances[index] = innerConductance;
    surfaceAreas[index] = exposedArea;
    diagonal[index] = innerConductance + outerConductance + convectionCoefficient * exposedArea;
    if (index === 0) rightHandSide[index] = innerConductance;
    if (index < segments - 1) upper[index] = -outerConductance;
  }

  for (let index = 1; index < segments; index += 1) {
    const factor = -innerConductances[index] / diagonal[index - 1];
    diagonal[index] -= factor * upper[index - 1];
    rightHandSide[index] -= factor * rightHandSide[index - 1];
  }

  const temperatures = new Float64Array(segments);
  temperatures[segments - 1] = rightHandSide[segments - 1] / diagonal[segments - 1];
  for (let index = segments - 2; index >= 0; index -= 1) {
    temperatures[index] = (
      rightHandSide[index] - upper[index] * temperatures[index + 1]
    ) / diagonal[index];
  }

  let heatTransfer = tipConductance * temperatures[segments - 1];
  let exposedArea = 2 * Math.PI * outerRadius * thickness;
  for (let index = 0; index < segments; index += 1) {
    heatTransfer += convectionCoefficient * surfaceAreas[index] * temperatures[index];
    exposedArea += surfaceAreas[index];
  }
  const efficiency = heatTransfer / (convectionCoefficient * exposedArea);
  const parameterLength = Math.sqrt(
    2 * convectionCoefficient / (conductivity * thickness)
  ) * (outerRadius - innerRadius);
  const values = [efficiency, exposedArea, parameterLength, ...temperatures];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("計算結果超出可處理範圍，請檢查輸入數值。");
  }

  return { efficiency, exposedArea, parameterLength };
}

export function calculateFinEfficiency(input) {
  if (!input || typeof input !== "object") throw new RangeError("請提供有效的計算條件。");

  if (input.geometry === "annular") return calculateAnnularFinEfficiency(input);

  const {
    geometry,
    convectionCoefficient,
    conductivity,
    lengthMm,
    widthMm,
    thicknessMm,
    diameterMm,
  } = input;
  requirePositive(convectionCoefficient, "對流熱傳係數");
  requirePositive(conductivity, "材料熱傳導係數");
  requirePositive(lengthMm, "鰭片長度");

  let crossSectionArea;
  let perimeter;
  if (geometry === "rectangular") {
    requirePositive(widthMm, "鰭片寬度");
    requirePositive(thicknessMm, "鰭片厚度");
    const width = widthMm / 1000;
    const thickness = thicknessMm / 1000;
    crossSectionArea = width * thickness;
    perimeter = 2 * (width + thickness);
  } else if (geometry === "cylindrical") {
    requirePositive(diameterMm, "鰭片直徑");
    const diameter = diameterMm / 1000;
    crossSectionArea = Math.PI * diameter ** 2 / 4;
    perimeter = Math.PI * diameter;
  } else {
    throw new RangeError("請選擇平板鰭片、針狀鰭片或環狀鰭片。");
  }

  const length = lengthMm / 1000;
  const correctedLength = length + crossSectionArea / perimeter;
  const parameter = Math.sqrt(convectionCoefficient * perimeter / (conductivity * crossSectionArea));
  const parameterLength = parameter * correctedLength;
  const efficiency = Math.tanh(parameterLength) / parameterLength;
  const values = [crossSectionArea, perimeter, correctedLength, parameter, parameterLength, efficiency];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("計算結果超出可處理範圍，請檢查輸入數值。");
  }

  return {
    crossSectionArea,
    perimeter,
    correctedLength,
    parameter,
    parameterLength,
    efficiency,
  };
}
