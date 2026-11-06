function requirePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} 必須是大於零的有限數值。`);
  }
}

export function calculateFinEfficiency(input) {
  if (!input || typeof input !== "object") throw new RangeError("請提供有效的計算條件。");

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
    throw new RangeError("請選擇平板鰭片或針狀鰭片。");
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
