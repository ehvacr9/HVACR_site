function requireRange(value, name, minimum, maximum, minimumInclusive = true) {
  const belowMinimum = minimumInclusive ? value < minimum : value <= minimum;
  if (!Number.isFinite(value) || belowMinimum || value > maximum) {
    throw new RangeError(`${name} 必須介於 ${minimum} 與 ${maximum} 之間。`);
  }
}

function turbulentDarcyFactor(reynoldsNumber, relativeRoughness) {
  let inverseRoot = -2 * Math.log10(relativeRoughness / 3.7 + 5.74 / reynoldsNumber ** .9);
  let converged = false;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const next = -2 * Math.log10(relativeRoughness / 3.7 + 2.51 * inverseRoot / reynoldsNumber);
    if (!Number.isFinite(next) || next <= 0) {
      throw new RangeError("無法求得摩擦因子，請檢查輸入條件。");
    }
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

export function calculateTurbulentMoodyCurveFactor(reynoldsNumber, relativeRoughness) {
  requireRange(reynoldsNumber, "雷諾數", 2000, 100000000);
  requireRange(relativeRoughness, "相對粗糙度", 0, .05);
  return turbulentDarcyFactor(reynoldsNumber, relativeRoughness);
}

export function calculateMoodyFrictionFactor(reynoldsNumber, relativeRoughness) {
  requireRange(reynoldsNumber, "雷諾數", 500, 100000000);
  requireRange(relativeRoughness, "相對粗糙度", 0, .05);

  if (reynoldsNumber < 2300) {
    return { frictionFactor: 64 / reynoldsNumber, flowRegime: "層流" };
  }
  if (reynoldsNumber < 4000) {
    const laminarAtTransition = 64 / 2300;
    const turbulentAtTransition = turbulentDarcyFactor(4000, relativeRoughness);
    const transition = (reynoldsNumber - 2300) / (4000 - 2300);
    return {
      frictionFactor: laminarAtTransition + transition * (turbulentAtTransition - laminarAtTransition),
      flowRegime: "過渡區（估算）",
    };
  }
  return { frictionFactor: turbulentDarcyFactor(reynoldsNumber, relativeRoughness), flowRegime: "紊流" };
}

export function calculateMoodyFromFluidProperties(input) {
  if (!input || typeof input !== "object") throw new RangeError("請提供有效的流體與管道條件。");
  const { density, velocity, diameterMm, dynamicViscosity, absoluteRoughnessMm } = input;
  requireRange(density, "流體密度", 0, Number.MAX_VALUE, false);
  requireRange(velocity, "流速", 0, Number.MAX_VALUE, false);
  requireRange(diameterMm, "管徑", 0, Number.MAX_VALUE, false);
  requireRange(dynamicViscosity, "動力黏度", 0, Number.MAX_VALUE, false);
  requireRange(absoluteRoughnessMm, "絕對粗糙度", 0, Number.MAX_VALUE);
  if (absoluteRoughnessMm >= diameterMm) {
    throw new RangeError("絕對粗糙度必須小於管徑。");
  }

  const reynoldsNumber = density * velocity * diameterMm / 1000 / dynamicViscosity;
  const relativeRoughness = absoluteRoughnessMm / diameterMm;
  const calculation = calculateMoodyFrictionFactor(reynoldsNumber, relativeRoughness);
  return { ...calculation, reynoldsNumber, relativeRoughness };
}
