const pressureFactors = { kPa: 1000, Pa: 1, bar: 100000, "kgf/cm²": 98066.5 };
const flowFactors = { "m³/h": 1 / 3600, "L/min": 1 / 60000, "L/s": 1 / 1000, "m³/s": 1 };

export function calculatePumpPower({ pressure, pressureUnit, flow, flowUnit, efficiency }) {
  if (!Object.hasOwn(pressureFactors, pressureUnit) || !Object.hasOwn(flowFactors, flowUnit)) {
    throw new RangeError("請選擇有效的壓差與流量單位。");
  }
  if (!Number.isFinite(pressure) || pressure <= 0) throw new RangeError("泵浦壓差必須為大於 0 的有限數值。");
  if (!Number.isFinite(flow) || flow <= 0) throw new RangeError("體積流量必須為大於 0 的有限數值。");
  if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 100) {
    throw new RangeError("泵浦效率必須大於 0 且不超過 100%。");
  }
  const pressurePa = pressure * pressureFactors[pressureUnit];
  const flowM3s = flow * flowFactors[flowUnit];
  const hydraulicPowerKw = pressurePa * flowM3s / 1000;
  const shaftPowerKw = hydraulicPowerKw / (efficiency / 100);
  if (![pressurePa, flowM3s, hydraulicPowerKw, shaftPowerKw].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError("輸入超出可計算的數值範圍，請檢查後重試。");
  }
  return { hydraulicPowerKw, shaftPowerKw };
}
