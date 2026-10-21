import initCoolProp from "../assets/coolprop/coolprop.js";
import { calculateCycle, cycleFluids } from "../assets/refrigeration-cycle.js";

export async function runCycleTests() {
  const cp = await initCoolProp();
  let checks = 0;
  const assert = (condition, label) => {
    checks += 1;
    if (!condition) throw new Error(`FAIL: ${label}`);
  };
  const close = (actual, expected, label) => assert(Number.isFinite(actual)
    && Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-7), label);
  const base = {
    fluid: "R134a", evaporation: -10, condensation: 40,
    superheat: 5, subcooling: 5, efficiency: .8, capacity: 10,
  };
  const reject = async (patch, label) => {
    let rejected = false;
    try { await calculateCycle(cp, { ...base, ...patch }); }
    catch (error) { rejected = error instanceof RangeError; }
    assert(rejected, label);
  };
  for (const fluid of cycleFluids) {
    const crit = cp.PropsSI("Tcrit", "", 0, "", 0, fluid) - 273.15;
    const min = Math.max(cp.PropsSI("Tmin", "", 0, "", 0, fluid),
      cp.PropsSI("Ttriple", "", 0, "", 0, fluid)) - 273.15;
    const input = {
      ...base, fluid, evaporation: Math.max(min + 20, Math.min(-10, crit - 50)),
      condensation: Math.min(40, crit - 10),
    };
    const cycle = await calculateCycle(cp, input);
    const [one, two, three, four] = cycle.states;
    assert(cycle.states.length === 4 && cycle.cop > 0, `${fluid} valid cycle`);
    close(one.p, cp.PropsSI("P", "T", input.evaporation + 273.15, "Q", 1, fluid), `${fluid} evaporation uses dew`);
    close(three.p, cp.PropsSI("P", "T", input.condensation + 273.15, "Q", 0, fluid), `${fluid} condensation uses bubble`);
    close(one.t, input.evaporation + 273.15 + 5, `${fluid} superheat`);
    close(three.t, input.condensation + 273.15 - 5, `${fluid} subcooling`);
    close(one.p, four.p, `${fluid} evaporation isobaric`);
    close(two.p, three.p, `${fluid} condensation isobaric`);
    close(three.h, four.h, `${fluid} throttling isenthalpic`);
    const hs = cp.PropsSI("H", "P", two.p, "S", one.s, fluid);
    close((hs - one.h) / (two.h - one.h), .8, `${fluid} isentropic efficiency`);
    close(cycle.rejection, cycle.refrigeration + cycle.work, `${fluid} energy balance`);
    close(cycle.massFlow * cycle.refrigeration, 10000, `${fluid} capacity scaling`);
    close(cycle.compressorPower * cycle.cop, 10, `${fluid} COP and power`);
    close(cycle.condenserCapacity, 10 + cycle.compressorPower, `${fluid} heat rejection`);
    for (const point of cycle.states) {
      for (const key of ["t", "p", "h", "s", "density"]) assert(Number.isFinite(point[key]), `${fluid} finite ${key}`);
    }
    if (["R410A", "R407C"].includes(fluid)) {
      const dew = cp.PropsSI("T", "P", three.p, "Q", 1, fluid);
      assert(dew > input.condensation + 273.15, `${fluid} condenser glide`);
      close(four.t, cp.PropsSI("T", "P", four.p, "H", four.h, fluid), `${fluid} actual expansion temperature`);
      assert(four.t < input.evaporation + 273.15, `${fluid} expansion is colder than evaporation dew point`);
    }
    const saturated = await calculateCycle(cp, { ...input, superheat: 0, subcooling: 0 });
    close(saturated.states[0].quality, 1, `${fluid} saturated compressor inlet`);
    close(saturated.states[2].quality, 0, `${fluid} saturated condenser outlet`);
  }
  const ideal = await calculateCycle(cp, { ...base, efficiency: 1, superheat: 0, subcooling: 0, capacity: null });
  close(ideal.states[1].s, ideal.states[0].s, "Ideal compression preserves entropy");
  close(ideal.states[0].quality, 1, "Zero superheat is saturated vapor");
  close(ideal.states[2].quality, 0, "Zero subcooling is saturated liquid");
  assert(ideal.massFlow === null && ideal.compressorPower === null && ideal.condenserCapacity === null,
    "Optional capacity does not invent power values");
  const lowerEfficiency = await calculateCycle(cp, { ...base, efficiency: .6 });
  const normal = await calculateCycle(cp, base);
  assert(lowerEfficiency.cop < normal.cop && lowerEfficiency.states[1].t > normal.states[1].t,
    "Lower efficiency increases discharge temperature and reduces COP");
  for (const [patch, label] of [
    [{ fluid: "Invalid" }, "Unsupported fluid"],
    [{ evaporation: NaN }, "Nonfinite input"],
    [{ condensation: -20 }, "Reversed pressure"],
    [{ evaporation: 40, condensation: 40 }, "Equal pressure"],
    [{ superheat: -1 }, "Negative superheat"],
    [{ subcooling: -1 }, "Negative subcooling"],
    [{ efficiency: 0 }, "Zero efficiency"],
    [{ efficiency: 1.01 }, "Efficiency over 100%"],
    [{ capacity: 0 }, "Zero capacity"],
    [{ capacity: Infinity }, "Nonfinite capacity"],
    [{ fluid: "R744", condensation: 40 }, "Transcritical conditions rejected"],
    [{ fluid: "Water", evaporation: -10 }, "Ice region rejected"],
    [{ subcooling: 300 }, "Subcooling below model range"],
    [{ superheat: 1000 }, "Superheat over model range"],
  ]) await reject(patch, label);

  const frame = document.createElement("iframe");
  frame.src = "../refrigeration-cycle.html";
  frame.style.cssText = "position:fixed;left:-10000px;width:1100px;height:1000px;";
  frame.title = "Cycle analyzer integration tests";
  document.body.append(frame);
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 60000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  try {
    await wait(() => frame.contentDocument?.querySelector("#cycle-inputs")?.disabled === false, "module load");
    const doc = frame.contentDocument;
    const q = (selector) => doc.querySelector(selector);
    const set = (id, value) => { q(`#${id}`).value = String(value); };
    const submit = async () => {
      q("#cycle-form").requestSubmit();
      assert(q("#status").dataset.kind === "loading", "Immediate loading feedback");
      await wait(() => !q("#cycle-form").hasAttribute("aria-busy"), "analysis");
    };
    assert(q("#fluid").options.length === cycleFluids.length, "All supported fluids listed");
    for (const fluid of cycleFluids) {
      const crit = cp.PropsSI("Tcrit", "", 0, "", 0, fluid) - 273.15;
      const min = cp.PropsSI("Tmin", "", 0, "", 0, fluid) - 273.15;
      set("fluid", fluid);
      set("evaporation", Math.max(min + 20, Math.min(-10, crit - 50)));
      set("condensation", Math.min(40, crit - 10));
      set("capacity", 10);
      await submit();
      assert(q("#status").dataset.kind === "success", `${fluid} UI: ${q("#status").textContent}`);
      assert(!q("#results").hidden && q("#states").rows.length === 4, `${fluid} state table`);
      assert(q("#metrics").children.length === 9, `${fluid} capacity metrics`);
      assert(!q("#metrics .metric-placeholder"), `${fluid} capacity replaces all placeholders`);
      assert(q("#chart svg").querySelectorAll(".cycle-point").length === 4, `${fluid} chart states`);
      assert(q("#chart svg").querySelectorAll(".cycle-process").length === 4, `${fluid} cycle processes`);
      assert(!/NaN|Infinity/.test(q("#chart").innerHTML), `${fluid} finite chart coordinates`);
      for (const point of q("#chart").querySelectorAll(".cycle-point")) {
        assert(Number(point.getAttribute("cx")) >= 88 && Number(point.getAttribute("cx")) <= 738
          && Number(point.getAttribute("cy")) >= 40 && Number(point.getAttribute("cy")) <= 440,
        `${fluid} cycle point inside plot`);
      }
    }
    set("fluid", "R134a");
    set("evaporation", -10);
    set("condensation", 40);
    set("capacity", "");
    await submit();
    assert(q("#metrics").children.length === 9, "Blank capacity keeps all metric cards visible");
    const rateCards = [...q("#metrics").children].slice(-3);
    for (const [index, label] of ["冷媒質量流率", "冷媒側壓縮功率", "冷凝器熱負荷"].entries()) {
      assert(rateCards[index].querySelector("span").textContent === label
        && rateCards[index].querySelector(".metric-placeholder").textContent === "輸入冷凍能力後顯示",
      `Blank capacity explains missing ${label}`);
    }
    const previousResults = q("#results").innerHTML;
    set("capacity", 10);
    q("#capacity").dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
    assert(!q("#results").hidden && q("#results").innerHTML === previousResults,
      "Editing capacity preserves previous results and chart");
    assert(q("#status").textContent.includes("上次結果"), "Capacity edits explain results are not updated yet");
    await submit();
    assert(!q("#metrics .metric-placeholder"), "Submitting capacity replaces placeholders with calculated rates");
    const calculatedResults = q("#results").innerHTML;
    set("capacity", "");
    q("#capacity").dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
    assert(!q("#results").hidden && q("#results").innerHTML === calculatedResults,
      "Clearing capacity preserves calculated results until submit");
    await submit();
    assert(q("#metrics").querySelectorAll(".metric-placeholder").length === 3,
      "Submitting blank capacity restores rate placeholders");
    set("condensation", -20);
    q("#condensation").dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
    assert(q("#results").hidden, "Changed input clears stale results");
    await submit();
    assert(q("#status").dataset.kind === "error" && q("#results").hidden && q("#chart").children.length === 0,
      "Invalid cycle reports error and clears outputs");
    assert(!q("#cycle-inputs").disabled, "Inputs recover after failure");
    set("condensation", 40);
    await submit();
    assert(q("#status").dataset.kind === "success", "Valid analysis recovers after error");
    for (const width of [320, 768, 1440]) {
      frame.style.width = `${width}px`;
      await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(resolve));
      assert(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth, `No page overflow at ${width}px`);
    }
  } finally {
    frame.remove();
  }
  return { status: "PASS", checks, fluids: cycleFluids.length };
}
