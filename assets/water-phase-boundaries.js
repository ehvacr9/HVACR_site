function requireRange(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}須介於 ${minimum} 至 ${maximum}（含端點）。`);
  }
}

export const waterFluidLimits = Object.freeze({
  temperatureMin: 273.16,
  temperatureMax: 1273,
  pressureMax: 1e9,
});

export const waterMeltingBranches = Object.freeze([
  { id: "Ih", temperatureMin: 251.165, temperatureMax: 273.16, referenceTemperature: 273.16, referencePressure: 611.657 },
  { id: "III", temperatureMin: 251.165, temperatureMax: 256.164, referenceTemperature: 251.165, referencePressure: 208.566e6 },
  { id: "V", temperatureMin: 256.164, temperatureMax: 273.31, referenceTemperature: 256.164, referencePressure: 350.1e6 },
  { id: "VI", temperatureMin: 273.31, temperatureMax: 355, referenceTemperature: 273.31, referencePressure: 632.4e6 },
  { id: "VII", temperatureMin: 355, temperatureMax: 715, referenceTemperature: 355, referencePressure: 2216e6 },
].map(Object.freeze));

function meltingBranch(id) {
  const branch = waterMeltingBranches.find((item) => item.id === id);
  if (!branch) throw new RangeError(`未知的冰熔化分支：${id}。`);
  return branch;
}

// IAPWS R14-08(2011), Eqs. (1)-(5). Each ice phase has its own temperature domain.
export function waterMeltingPressure(temperature, ice = "Ih") {
  const branch = meltingBranch(ice);
  requireRange(temperature, branch.temperatureMin, branch.temperatureMax, `冰 ${ice} 熔化線溫度 (K)`);
  const theta = temperature / branch.referenceTemperature;
  let reducedPressure;
  if (ice === "Ih") {
    reducedPressure = 1 + [1195393.37, 80818.3159, 3338.26860]
      .reduce((sum, coefficient, index) => sum + coefficient * (1 - theta ** [3, 25.75, 103.75][index]), 0);
  } else if (ice === "VII") {
    reducedPressure = Math.exp(1.73683 * (1 - 1 / theta)
      - 0.0544606 * (1 - theta ** 5) + 8.06106e-8 * (1 - theta ** 22));
  } else {
    const [coefficient, exponent] = { III: [0.299948, 60], V: [1.18721, 8], VI: [1.07476, 4.6] }[ice];
    reducedPressure = 1 - coefficient * (1 - theta ** exponent);
  }
  return branch.referencePressure * reducedPressure;
}

export function validateWaterFluidState(temperature, pressure) {
  requireRange(temperature, waterFluidLimits.temperatureMin, waterFluidLimits.temperatureMax, "水物性溫度 (K)");
  if (!Number.isFinite(pressure) || pressure <= 0 || pressure > waterFluidLimits.pressureMax) {
    throw new RangeError("水物性絕對壓力須大於 0 且不超過 1000 MPa。");
  }

  const highPressureIce = waterMeltingBranches.find((branch) =>
    branch.id !== "Ih" && temperature >= branch.temperatureMin && temperature <= branch.temperatureMax);
  if (highPressureIce && pressure > waterMeltingPressure(temperature, highPressureIce.id)) {
    throw new RangeError("此溫壓位於冰的穩定區，不能以流體模型計算，請調整溫度或壓力。");
  }
}

// IAPWS viscosity release (2008), Eq. (9); assumes a validated stable fluid state.
export function waterViscosityInRange(temperature, pressure) {
  const maximum = pressure <= 300e6 ? 1173.15 : pressure <= 350e6 ? 873.15
    : pressure <= 500e6 ? 433.15 : 373.15;
  return Number.isFinite(temperature) && Number.isFinite(pressure)
    && temperature >= waterFluidLimits.temperatureMin && temperature <= maximum
    && pressure > 0 && pressure <= waterFluidLimits.pressureMax;
}
