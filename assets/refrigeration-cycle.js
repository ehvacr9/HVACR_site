import { validateWaterFluidState, waterFluidLimits } from "./water-phase-boundaries.js";

export const cycleFluids = [
  "R134a", "R22", "R410A", "R407C", "R32", "R125", "R1234yf", "R290",
  "R600a", "R717", "R744", "R152a", "R23", "R1234ze(E)", "R245fa", "R600", "Water",
];

export async function calculateCycle(cp, input) {
  const { fluid, evaporation, condensation, superheat, subcooling, efficiency, capacity = null } = input;
  if (!cycleFluids.includes(fluid)) throw new RangeError("請選擇支援的流體。");
  if (![evaporation, condensation, superheat, subcooling, efficiency].every(Number.isFinite)) {
    throw new RangeError("請輸入有效的數值。");
  }
  if (superheat < 0 || subcooling < 0) throw new RangeError("過熱度與過冷度不可小於 0。");
  if (efficiency <= 0 || efficiency > 1) throw new RangeError("等熵效率須大於 0 且不超過 100%。");
  if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0)) {
    throw new RangeError("冷凍能力須大於 0，或留白。");
  }
  const prop = async (output, key1 = "", value1 = 0, key2 = "", value2 = 0) => {
    const value = await cp.PropsSI(output, key1, value1, key2, value2, fluid);
    if (!Number.isFinite(value)) throw new RangeError(`無法求得 ${output} 物性，請調整操作條件。`);
    return value;
  };
  const minimum = Math.max(await prop("Tmin"), await prop("Ttriple"));
  const critical = await prop("Tcrit");
  const maximum = Math.min(await prop("Tmax"), fluid === "Water" ? waterFluidLimits.temperatureMax : Infinity);
  const maxPressure = await prop("pmax");
  const te = evaporation + 273.15;
  const tc = condensation + 273.15;
  if (te < minimum || tc < minimum || te >= critical || tc >= critical) {
    throw new RangeError(`蒸發與冷凝溫度須介於 ${(minimum - 273.15).toFixed(2)} °C 至臨界溫度 ${(critical - 273.15).toFixed(2)} °C（不含臨界點）。`);
  }
  const pe = await prop("P", "T", te, "Q", 1);
  const pc = await prop("P", "T", tc, "Q", 0);
  if (pc <= pe) throw new RangeError("冷凝壓力須大於蒸發壓力，請調整蒸發與冷凝溫度。");
  const state = async (key1, value1, key2, value2) => {
    const [t, p, h, s, density, quality, phase] = await Promise.all(
      ["T", "P", "H", "S", "D", "Q", "Phase"].map((output) => prop(output, key1, value1, key2, value2)));
    if (t < minimum || t > maximum || p <= 0 || p > maxPressure || density <= 0) {
      throw new RangeError("循環狀態點超出流體模型範圍，請調整操作條件。");
    }
    if (fluid === "Water") validateWaterFluidState(t, p);
    return { t, p, h, s, density, quality: quality >= 0 && quality <= 1 ? quality : null, phase };
  };
  if (te + superheat > maximum || tc - subcooling < minimum) {
    throw new RangeError("過熱或過冷後的溫度超出流體模型範圍。");
  }
  const one = superheat === 0 ? await state("P", pe, "Q", 1) : await state("P", pe, "T", te + superheat);
  const hs = await prop("H", "P", pc, "S", one.s);
  const two = await state("P", pc, "H", one.h + (hs - one.h) / efficiency);
  const three = subcooling === 0 ? await state("P", pc, "Q", 0) : await state("P", pc, "T", tc - subcooling);
  const four = await state("P", pe, "H", three.h);
  if (![1, 2, 5].includes(one.phase) && one.quality !== 1) {
    throw new RangeError("壓縮機入口須為蒸氣，請調整過熱度。");
  }
  if (![1, 2, 5].includes(two.phase)) throw new RangeError("壓縮機出口不是有效的氣態狀態，請調整操作條件。");
  if (three.phase !== 0 && three.quality !== 0) throw new RangeError("冷凝器出口須為液體，請調整過冷度。");
  const refrigeration = one.h - four.h;
  const work = two.h - one.h;
  const rejection = two.h - three.h;
  if (refrigeration <= 0 || work <= 0 || rejection <= 0 || hs <= one.h) {
    throw new RangeError("此條件無法形成有效的冷凍循環，請調整操作條件。");
  }
  const massFlow = capacity === null ? null : capacity * 1000 / refrigeration;
  return {
    fluid, states: [one, two, three, four], idealDischargeEnthalpy: hs,
    refrigeration, work, rejection, cop: refrigeration / work, pressureRatio: pc / pe,
    massFlow, compressorPower: massFlow === null ? null : massFlow * work / 1000,
    condenserCapacity: massFlow === null ? null : massFlow * rejection / 1000,
  };
}
