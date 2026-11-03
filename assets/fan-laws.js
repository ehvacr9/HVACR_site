export const lawSets = {
  speed: { label: "Law 1：已知目標轉速", known: "speed", hint: "變頻調速、皮帶輪調速，或已知新設備轉速時選 Law 1；同一台設備請令 D₁ = D₂。",
    formulas: ["1a：Q₂ = Q₁ (D₂/D₁)³ (N₂/N₁)", "1b：Δp₂ = Δp₁ (D₂/D₁)² (N₂/N₁)² (ρ₂/ρ₁)", "1c：W₂ = W₁ (D₂/D₁)⁵ (N₂/N₁)³ (ρ₂/ρ₁)"] },
  pressure: { label: "Law 2：已知目標壓差", known: "pressure", hint: "已知需要的風機壓升或泵浦壓差，要反求轉速、流量與軸功率時選 Law 2。請輸入壓差，不是大氣壓或管線靜壓。",
    formulas: ["2a：Q₂ = Q₁ (D₂/D₁)² (Δp₂/Δp₁)½ (ρ₁/ρ₂)½", "2b：N₂ = N₁ (D₁/D₂) (Δp₂/Δp₁)½ (ρ₁/ρ₂)½", "2c：W₂ = W₁ (D₂/D₁)² (Δp₂/Δp₁)³⁄² (ρ₁/ρ₂)½"] },
  flow: { label: "Law 3：已知目標流量", known: "flow", hint: "已知需要的送風量或水流量，要反求轉速、壓差與軸功率時選 Law 3。Q 為實際體積流量，不能直接使用標準狀態風量。",
    formulas: ["3a：N₂ = N₁ (D₁/D₂)³ (Q₂/Q₁)", "3b：Δp₂ = Δp₁ (D₁/D₂)⁴ (Q₂/Q₁)² (ρ₂/ρ₁)", "3c：W₂ = W₁ (D₁/D₂)⁴ (Q₂/Q₁)³ (ρ₂/ρ₁)"] },
};

export function calculateFanLaws({ law, base, target }) {
  if (!Object.hasOwn(lawSets, law)) throw new RangeError("請選擇有效的定律組。");
  const names = { diameter: "葉輪直徑", density: "流體密度", speed: "轉速", pressure: "壓差", flow: "體積流量", power: "軸功率" };
  function check(point, keys, label) {
    for (const key of keys) {
      if (!Number.isFinite(point?.[key]) || point[key] <= 0) {
        throw new RangeError(`${label}的${names[key]}必須是大於 0 的有限數值。`);
      }
    }
  }
  check(base, Object.keys(names), "原型（1）");
  check(target, ["diameter", "density", lawSets[law].known], "目標（2）");
  const d = target.diameter / base.diameter;
  const rho = target.density / base.density;
  let n;
  if (law === "speed") n = target.speed / base.speed;
  if (law === "pressure") n = Math.sqrt((target.pressure / base.pressure) / rho) / d;
  if (law === "flow") n = (target.flow / base.flow) / d ** 3;
  const result = {
    diameter: target.diameter, density: target.density,
    speed: base.speed * n,
    flow: base.flow * d ** 3 * n,
    pressure: base.pressure * d ** 2 * n ** 2 * rho,
    power: base.power * d ** 5 * n ** 3 * rho,
  };
  for (const value of Object.values(result)) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError("比例超出可計算範圍，請檢查輸入數值。");
  }
  result[lawSets[law].known] = target[lawSets[law].known];
  return result;
}
