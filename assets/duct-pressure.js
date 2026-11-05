function requireNumber(value, name, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${name} 必須是${allowZero ? "非負" : "大於零"}的有限數值。`);
  }
}

function turbulentDarcyFactor(reynolds, relativeRoughness) {
  let inverseRoot = -2 * Math.log10(relativeRoughness / 3.7 + 5.74 / reynolds ** 0.9);
  let converged = false;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const next = -2 * Math.log10(relativeRoughness / 3.7 + 2.51 * inverseRoot / reynolds);
    if (!Number.isFinite(next) || next <= 0) throw new RangeError("無法求得摩擦因子，請檢查輸入條件。");
    if (Math.abs(next - inverseRoot) < 1e-12) {
      inverseRoot = next;
      converged = true;
      break;
    }
    inverseRoot = next;
  }
  if (!converged) throw new RangeError("摩擦因子計算未收斂，請檢查輸入條件。");
  return 1 / inverseRoot ** 2;
}

export function calculateDuctPressureLoss(input) {
  if (!input || typeof input !== "object") throw new RangeError("請提供有效的計算條件。");

  const {
    flowRateM3h,
    shape,
    diameterMm,
    widthMm,
    heightMm,
    lengthM,
    roughnessMm,
    density,
    viscosity,
    localLossCoefficient,
    targetVelocity,
  } = input;

  requireNumber(flowRateM3h, "風量");
  requireNumber(lengthM, "風管長度", true);
  requireNumber(roughnessMm, "內壁粗糙度", true);
  requireNumber(density, "空氣密度");
  requireNumber(viscosity, "動力黏度");
  requireNumber(localLossCoefficient, "局部損失係數", true);
  requireNumber(targetVelocity, "目標風速");

  let area;
  let wettedPerimeter;
  let aspectRatio = 1;
  if (shape === "round") {
    requireNumber(diameterMm, "風管內徑");
    const diameter = diameterMm / 1000;
    area = Math.PI * diameter ** 2 / 4;
    wettedPerimeter = Math.PI * diameter;
  } else if (shape === "rectangular") {
    requireNumber(widthMm, "風管寬度");
    requireNumber(heightMm, "風管高度");
    const width = widthMm / 1000;
    const height = heightMm / 1000;
    area = width * height;
    wettedPerimeter = 2 * (width + height);
    aspectRatio = Math.min(width, height) / Math.max(width, height);
  } else {
    throw new RangeError("請選擇圓形或矩形風管。");
  }

  const hydraulicDiameter = 4 * area / wettedPerimeter;
  const roughness = roughnessMm / 1000;
  if (roughness >= hydraulicDiameter) throw new RangeError("內壁粗糙度必須小於風管水力直徑。");
  const flowRateM3s = flowRateM3h / 3600;
  const velocity = flowRateM3s / area;
  const reynoldsNumber = density * velocity * hydraulicDiameter / viscosity;
  const relativeRoughness = roughness / hydraulicDiameter;
  const laminarFrictionProduct = shape === "round"
    ? 64
    : 96 * (1 - 1.3553 * aspectRatio + 1.9467 * aspectRatio ** 2
      - 1.7012 * aspectRatio ** 3 + .9564 * aspectRatio ** 4 - .2537 * aspectRatio ** 5);
  let frictionFactor;
  let flowRegime;
  if (reynoldsNumber < 2300) {
    frictionFactor = laminarFrictionProduct / reynoldsNumber;
    flowRegime = "層流";
  } else if (reynoldsNumber < 4000) {
    const laminarAtTransition = laminarFrictionProduct / 2300;
    const turbulentAtTransition = turbulentDarcyFactor(4000, relativeRoughness);
    const transition = (reynoldsNumber - 2300) / (4000 - 2300);
    frictionFactor = laminarAtTransition + transition * (turbulentAtTransition - laminarAtTransition);
    flowRegime = "過渡區（估算）";
  } else {
    frictionFactor = turbulentDarcyFactor(reynoldsNumber, relativeRoughness);
    flowRegime = "紊流";
  }

  const dynamicPressure = density * velocity ** 2 / 2;
  const frictionLoss = frictionFactor * lengthM / hydraulicDiameter * dynamicPressure;
  const localLoss = localLossCoefficient * dynamicPressure;
  const requiredArea = flowRateM3s / targetVelocity;
  const circularDiameter = Math.sqrt(4 * requiredArea / Math.PI);
  const squareSide = Math.sqrt(requiredArea);
  const rectangularWidth = Math.sqrt(requiredArea * 2);
  const rectangularHeight = Math.sqrt(requiredArea / 2);
  const values = [
    area, hydraulicDiameter, velocity, reynoldsNumber, frictionFactor, dynamicPressure,
    frictionLoss, localLoss, requiredArea, circularDiameter, squareSide,
    rectangularWidth, rectangularHeight,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("計算結果超出可處理範圍，請檢查輸入數值。");
  }

  return {
    area,
    hydraulicDiameter,
    velocity,
    reynoldsNumber,
    frictionFactor,
    flowRegime,
    dynamicPressure,
    frictionLoss,
    localLoss,
    totalLoss: frictionLoss + localLoss,
    frictionRate: frictionFactor / hydraulicDiameter * dynamicPressure,
    requiredArea,
    recommendedCircularDiameter: circularDiameter,
    recommendedSquareSide: squareSide,
    recommendedRectangularWidth: rectangularWidth,
    recommendedRectangularHeight: rectangularHeight,
  };
}
