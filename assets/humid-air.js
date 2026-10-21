export const humidAirProperties = Object.freeze({
  T: { label: "乾球溫度", unit: "°C", toSI: (v) => v + 273.15, fromSI: (v) => v - 273.15 },
  R: { label: "相對濕度", unit: "%", toSI: (v) => v / 100, fromSI: (v) => v * 100 },
  B: { label: "濕球溫度", unit: "°C", toSI: (v) => v + 273.15, fromSI: (v) => v - 273.15 },
  D: { label: "露點溫度", unit: "°C", toSI: (v) => v + 273.15, fromSI: (v) => v - 273.15 },
  W: { label: "含濕量", unit: "kg/kg 乾空氣", toSI: (v) => v, fromSI: (v) => v },
  H: { label: "比焓", unit: "kJ/kg 乾空氣", toSI: (v) => v * 1000, fromSI: (v) => v / 1000 },
  V: { label: "比容", unit: "m³/kg 乾空氣", toSI: (v) => v, fromSI: (v) => v },
});

export function calculateHumidAir(cp, { pressure, key1, value1, key2, value2 }) {
  if (!Object.hasOwn(humidAirProperties, key1) || !Object.hasOwn(humidAirProperties, key2)) {
    throw new RangeError("請選擇有效的已知性質。");
  }
  if (key1 === key2) throw new RangeError("請選擇兩項不同的性質。");
  if (![pressure, value1, value2].every(Number.isFinite)) throw new RangeError("請輸入有效數值。");
  if (pressure < .01 || pressure > 10000) throw new RangeError("總絕對壓力須介於 0.01 至 10000 kPa。");
  const inputs = [[key1, value1], [key2, value2]].map(([key, value]) => {
    if (key === "R" && (value < 0 || value > 100)) throw new RangeError("相對濕度須介於 0 至 100%。");
    if (key === "W" && (value < 0 || value > 10)) throw new RangeError("含濕量須介於 0 至 10 kg/kg 乾空氣。");
    if (key === "V" && value <= 0) throw new RangeError("比容須大於 0。");
    if (["T", "B", "D"].includes(key) && (value < -143.15 || value > 350)) {
      throw new RangeError("溫度須介於 -143.15 至 350 °C。");
    }
    return [key, humidAirProperties[key].toSI(value)];
  });
  const pair = [key1, key2].sort().join("-");
  if (pair === "D-W") throw new RangeError("露點與含濕量在固定壓力下不是獨立性質，無法唯一決定狀態；請更換一項性質。");
  if (["B-H", "B-V", "H-V"].includes(pair)) {
    throw new RangeError("目前運算模組不支援這組性質；請更換一項性質，例如乾球溫度或含濕量。");
  }
  const p = pressure * 1000;
  const query = (output, a, av, b, bv) => {
    let result;
    try {
      result = cp.HAPropsSI(output, "P", p, a, av, b, bv);
    } catch (error) {
      throw new RangeError(`此性質組合無法求解：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Number.isFinite(result) || Math.abs(result) > 1e100) {
      throw new RangeError("無法求得有效狀態；可能超出範圍、條件不相容，或此性質組合不受支援。");
    }
    return result;
  };
  const args = inputs.flat();
  const t = query("T", ...args);
  const w = query("W", ...args);
  if (t < 130 || t > 623.15 || w < 0 || w > 10) throw new RangeError("求解狀態超出濕空氣模型範圍。");
  const values = { T: t, W: w };
  for (const key of ["R", "B", "H", "V"]) values[key] = query(key, "T", t, "W", w);
  values.D = w === 0 ? null : query("D", "T", t, "W", w);
  if (values.R < 0 || values.R > 1 + 1e-8 || values.V <= 0
    || values.B > t + 1e-6 || (values.D !== null && values.D > t + 1e-6)) {
    throw new RangeError("輸入條件無法形成有效的未飽和或飽和濕空氣狀態。");
  }
  for (const [key, value] of inputs) {
    if (values[key] === null || Math.abs(values[key] - value) > Math.max(1e-7, Math.abs(value) * 1e-6)) {
      throw new RangeError("求解結果與輸入條件不相容，請調整數值或更換性質組合。");
    }
  }
  return { pressure, values };
}
