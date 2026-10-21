import initCoolProp from "../assets/coolprop/coolprop.js";

export async function runWaterUiTests() {
  let checks = 0;
  const categories = new Set();
  const assert = (condition, label) => {
    checks += 1;
    if (!condition) throw new Error(`FAIL UI: ${label}`);
  };
  const close = (actual, expected, label) => assert(Number.isFinite(actual)
    && Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-5), `${label}: ${actual} vs ${expected}`);
  const frame = document.createElement("iframe");
  frame.title = "Fluid properties integration test";
  frame.src = new URL("../pycool.html", import.meta.url).href;
  frame.style.cssText = "position: fixed; left: -10000px; width: 1100px; height: 1000px; pointer-events: none;";
  frame.setAttribute("aria-hidden", "true");
  document.body.append(frame);
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 120000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  try {
    await wait(() => frame.contentDocument?.querySelector("#calculate-button")?.textContent === "計算", "CoolProp initialization");
    const doc = frame.contentDocument;
    const q = (selector) => doc.querySelector(selector);
    const value = (selector, input) => { q(selector).value = String(input); };
    const change = (selector, input) => {
      value(selector, input);
      q(selector).dispatchEvent(new frame.contentWindow.Event("change", { bubbles: true }));
    };
    const idle = () => wait(() => !doc.body.hasAttribute("aria-busy"), "calculation");
    const pick = async (name, input) => {
      q(`input[name="${name}"][value="${input}"]`).click();
      await idle();
    };
    const submit = async (selector) => {
      q(selector).requestSubmit();
      await idle();
    };
    const state = async (one, inputOne, two, inputTwo) => {
      value("#property-one", one);
      value("#property-one-value", inputOne);
      value("#property-two", two);
      value("#property-two-value", inputTwo);
      await submit("#calculator-form");
    };
    const table = async (start, end, step) => {
      value("#table-start", start);
      value("#table-end", end);
      value("#table-step", step);
      await submit("#saturation-table-form");
    };
    const cells = () => [...q("#saturation-table tbody").rows]
      .map((row) => [...row.cells].map((cell) => Number(cell.textContent)));
    const cp = await initCoolProp();
    const props = (output, one = "", inputOne = 0, two = "", inputTwo = 0) =>
      cp.PropsSI(output, one, inputOne, two, inputTwo, "Water");
    const triplePressure = props("P", "T", 273.16, "Q", 0);

    categories.add("basic information");
    assert(q("#basic-refrigerant-number").textContent === "R718", "Water refrigerant number");
    close(Number(q("#basic-molar-mass").textContent), 18.015268, "Molar mass in g/mol");
    close(Number(q("#basic-gas-constant").textContent), 461.51805, "Specific gas constant");
    close(Number(q("#basic-triple-temperature").textContent), 0.01, "Triple temperature in Celsius");
    close(Number(q("#basic-triple-pressure").textContent), props("ptriple") / 1000, "Model triple pressure in kPa");
    close(Number(q("#basic-critical-temperature").textContent), 373.946, "Critical temperature in Celsius");
    close(Number(q("#basic-critical-pressure").textContent), 22064, "Critical pressure in kPa");
    close(Number(q("#basic-critical-density").textContent), 322, "Critical density");
    close(Number(q("#basic-normal-point").textContent), 99.97429585, "Normal boiling point");
    assert(!q("#temperature-range") && !q("#state-temperature-range") && !q("#state-pressure-range"),
      "No up-front range notices");
    assert(!q("#saturation-line-hint") && !q(".results-panel .notes"), "No up-front limitation paragraphs");

    categories.add("saturation input and boundaries");
    await pick("mode-category", "calculation");
    await pick("calculation-mode", "saturation");
    for (const temperature of [273.16, 275, 300, 373.15, 450, 625, 647.095]) {
      value("#pressure", "");
      value("#temperature", temperature - 273.15);
      await submit("#calculator-form");
      assert(q("#status").dataset.kind === "success", `Saturation input T ${temperature}`);
      close(Number(q("#pressure").value), props("P", "T", temperature, "Q", 0) / 1000, `Saturation pressure ${temperature}`);
      for (const [phase, quality] of [["liquid", 0], ["vapor", 1]]) {
        for (const [field, output, scale] of [["rho", "D", 1], ["h", "H", 0.001], ["u", "U", 0.001],
          ["cp", "C", 0.001], ["cv", "O", 0.001], ["viscosity", "V", 1e6]]) {
          close(Number(q(`#${phase}-${field}`).textContent), props(output, "T", temperature, "Q", quality) * scale,
            `Saturation ${field} units ${temperature}/${quality}`);
        }
        close(Number(q(`#${phase}-v`).textContent), 1 / props("D", "T", temperature, "Q", quality), "Saturation specific volume");
      }
    }
    for (const pressure of [triplePressure, 101325, 22063000]) {
      value("#temperature", "");
      value("#pressure", pressure / 1000);
      await submit("#calculator-form");
      assert(q("#status").dataset.kind === "success", `Saturation pressure input ${pressure}`);
    }
    for (const [temperature, pressure] of [["", 0], ["", triplePressure / 1000 * 0.999],
      ["", 22064], [0, ""], [373.946, ""], ["", ""]]) {
      value("#temperature", temperature);
      value("#pressure", pressure);
      await submit("#calculator-form");
      assert(q("#status").dataset.kind === "error" && q("#liquid-h").textContent === "—", "Reject invalid saturation and clear output");
    }
    value("#temperature", 100);
    value("#pressure", 1000);
    await submit("#calculator-form");
    assert(q("#status").dataset.kind === "warning", "Conflicting saturation inputs explicitly warned");

    categories.add("state properties, units and flash pairs");
    await pick("calculation-mode", "state");
    const keys = ["T", "P", "D", "v", "H", "S", "U", "Q"];
    const unsupported = new Set(["TH", "TU", "HU", "HQ", "SU", "SQ", "UQ"]);
    const normalize = (key) => key === "v" ? "D" : key;
    const flashOrder = ["T", "P", "D", "H", "S", "U", "Q"];
    for (const [temperature, pressure] of [[300, 101325], [500, 101325], [700, 30e6]]) {
      const reference = Object.fromEntries(flashOrder.slice(0, -1).map((key) => [key, props(key, "T", temperature, "P", pressure)]));
      for (let first = 0; first < keys.length; first += 1) {
        for (let second = first + 1; second < keys.length; second += 1) {
          const one = keys[first];
          const two = keys[second];
          if (two === "Q" && temperature !== 500) continue;
          const saturated = two === "Q";
          const inputs = saturated ? Object.fromEntries(flashOrder.slice(0, -1)
            .map((key) => [key, props(key, "P", 101325, "Q", 0.5)])) : reference;
          const display = (key) => key === "Q" ? 0.5 : key === "v" ? 1 / inputs.D
            : key === "T" ? inputs.T - 273.15 : key === "D" ? inputs.D : inputs[key] / 1000;
          const pair = [normalize(one), normalize(two)].sort((a, b) => flashOrder.indexOf(a) - flashOrder.indexOf(b)).join("");
          await state(one, display(one), two, display(two));
          if (pair === "DD" || unsupported.has(pair)) {
            assert(q("#status").dataset.kind === "error", `Unsupported/duplicate flash rejected ${one}/${two}`);
            continue;
          }
          assert(q("#status").dataset.kind === "success", `State pair ${temperature} K ${one}/${two}: ${q("#status").textContent}`);
          for (const [field, key, scale] of [["t", "T", 1], ["p", "P", 0.001], ["rho", "D", 1],
            ["h", "H", 0.001], ["s", "S", 0.001], ["u", "U", 0.001]]) {
            close(Number(q(`#state-${field}`).textContent), inputs[key] * scale - (key === "T" ? 273.15 : 0),
              `Solved ${field} ${one}/${two}`);
          }
          close(Number(q("#state-v").textContent), 1 / inputs.D, `State specific volume ${one}/${two}`);
          for (const [field, output, scale] of [["cp", "C", 0.001], ["cv", "O", 0.001], ["viscosity", "V", 1e6]]) {
            if (saturated) assert(q(`#state-${field}`).textContent.includes("兩相無定義"), `No invented two-phase ${field}`);
            else close(Number(q(`#state-${field}`).textContent), props(output, "T", temperature, "P", pressure) * scale,
              `State ${field} conversion ${one}/${two}`);
          }
        }
      }
    }
    for (const [one, inputOne, two, inputTwo] of [
      ["T", 0, "P", 101.325], ["T", 1000, "P", 101.325], ["T", 30, "P", 1000001],
      ["T", 30, "P", 0], ["T", 30, "D", -1], ["T", 30, "v", 0], ["P", 101.325, "Q", 1.01],
      ["P", 22064, "Q", 0.5], ["T", 373.946, "Q", 0.5], ["T", "", "P", 101.325],
      ["T", 6.85, "P", 900000],
    ]) {
      await state(one, inputOne, two, inputTwo);
      assert(q("#status").dataset.kind === "error" && q("#state-h").textContent === "—", `Reject invalid state ${one}=${inputOne}, ${two}=${inputTwo}`);
    }
    await state("T", 0.01, "P", 101.325);
    assert(q("#status").dataset.kind === "success", "Celsius triple endpoint accepted");
    for (const quality of [0, 1]) {
      for (const [property, input] of [["T", 0.01], ["P", triplePressure / 1000], ["P", 101.325]]) {
        await state(property, input, "Q", quality);
        assert(q("#status").dataset.kind === "success", `Saturated endpoint ${property}/${input}/${quality}: ${q("#status").textContent}`);
        assert(Number(q("#state-cp").textContent) > 0 && Number(q("#state-viscosity").textContent) > 0,
          "Saturated endpoint cp and viscosity available");
      }
    }
    await state("T", 373.946, "P", 22064);
    assert(q("#status").dataset.kind === "success" && q("#state-cp").textContent.includes("發散"), "Critical point cp not displayed as huge finite value");
    for (const [temperature, pressure] of [[1273, 1e5], [1000, 400e6]]) {
      await state("T", temperature - 273.15, "P", pressure / 1000);
      assert(q("#status").dataset.kind === "warning" && q("#state-viscosity").textContent.includes("有效範圍"),
        "Thermodynamic properties remain available without viscosity extrapolation");
    }

    categories.add("saturation, quality tables and CSV");
    await pick("calculation-mode", "table");
    assert(doc.querySelectorAll('input[name="saturation-type"]').length === 1
      && q('input[name="saturation-type"][value="vle"]').checked, "Vapor-liquid type retained without solid-line options");
    assert(q(".pt-melting") && q(".pt-sublimation")
      && q("#pt-diagram").textContent.includes("三相點")
      && [...doc.querySelectorAll(".pt-region")].map((region) => region.textContent).join("") === "SLV",
    "Original phase schematic retained");
    assert(!q(".pt-melt-sample-points") && !q(".pt-sublimation-sample-points"), "No solid-line sampling controls");
    for (const variation of ["T", "P"]) {
      await pick("table-variation", variation);
      const start = variation === "T" ? 0.01 : triplePressure / 1000;
      const end = variation === "T" ? 100 : 101.325;
      await table(start, end, variation === "T" ? 25 : 30);
      assert(q("#table-status").dataset.kind === "success", `VLE table ${variation} including triple endpoint`);
      assert(q("#saturation-table thead tr").cells.length === 19, "VLE table header count");
      for (const row of cells()) {
        const temperature = variation === "T" ? row[0] + 273.15 : row[1] + 273.15;
        const pressure = variation === "T" ? row[1] * 1000 : row[0] * 1000;
        close(pressure, props("P", "T", temperature, "Q", 0), "VLE table temperature/pressure order");
        close(row[8], row[7] - row[6], "Latent heat equals hg minus hf");
        assert(row.every(Number.isFinite), "VLE table complete numeric cells");
      }
    }
    for (const variation of ["QT", "QP"]) {
      await pick("table-variation", variation);
      value("#table-fixed", variation === "QT" ? 100 : 101.325);
      value("#table-quality-start", 0);
      value("#table-quality-end", 1);
      value("#table-quality-step", 0.5);
      await submit("#saturation-table-form");
      assert(q("#table-status").dataset.kind === "success", `Quality table ${variation}`);
      const rows = [...q("#saturation-table tbody").rows];
      assert(rows.length === 3 && rows[1].cells[8].textContent === "—" && rows[1].cells[9].textContent === "—", "Mixture heat capacities undefined");
      const key = variation === "QT" ? "T" : "P";
      const fixed = variation === "QT" ? 373.15 : 101325;
      for (const row of rows) {
        const x = Number(row.cells[0].textContent);
        close(Number(row.cells[5].textContent), props("H", key, fixed, "Q", x) / 1000, "Quality table enthalpy");
        close(Number(row.cells[4].textContent), 1 / props("D", key, fixed, "Q", x), "Quality table mass-specific volume");
      }
    }
    await pick("table-variation", "P");
    await table(10, 100, 30);
    {
      let blob;
      let filename;
      const win = frame.contentWindow;
      const originalCreate = win.URL.createObjectURL;
      const originalClick = win.HTMLAnchorElement.prototype.click;
      try {
        win.URL.createObjectURL = (input) => { blob = input; return originalCreate(input); };
        win.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
        q("#export-table-button").click();
      } finally {
        win.URL.createObjectURL = originalCreate;
        win.HTMLAnchorElement.prototype.click = originalClick;
      }
      assert(filename === "saturation-Water.csv", "CSV filename");
      const csv = await blob.text();
      assert(csv.startsWith("P (kPa),T (°C)"), "CSV column order and units");
      assert(csv.trim().split(/\r?\n/).length === 5, "CSV row count");
      close(Number(csv.trim().split(/\r?\n/)[1].split(",")[0]), 10, "CSV pressure value in kPa");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assert(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191, "CSV UTF-8 BOM");
    }
    await pick("table-variation", "T");
    await table(50, 51, 1 / 4999);
    assert(q("#table-status").dataset.kind === "success" && cells().length === 5000, "Exactly 5000 rows allowed");
    await table(50, 51, 1 / 5000);
    assert(q("#table-status").dataset.kind === "error" && q("#saturation-table-result").hidden, "5001 rows rejected and stale table cleared");
    for (const [start, end, step] of [[50, 60, 0], [60, 50, 1], [-50, 0, 1], [374, 375, 1]]) {
      await table(start, end, step);
      assert(q("#table-status").dataset.kind === "error", "Reject invalid saturation table domain or interval");
    }

    categories.add("integer defaults for all fluids");
    assert(!q('input[name="drawing-mode"][value="pt-diagram"]') && !q("#pt-section"), "P-T drawing removed");
    for (const fluid of [...q("#fluid").options].map((option) => option.value)) {
      change("#fluid", fluid);
      await idle();
      assert(!q("#generate-table-button").disabled, `Fluid loaded ${fluid}`);
      for (const variation of ["T", "P", "QT", "QP"]) {
        if (q(`input[name="table-variation"][value="${variation}"]`).disabled) continue;
        await pick("table-variation", variation);
        for (const input of q("#table-range-fields").querySelectorAll("input")) {
          const number = Number(input.value);
          assert(Number.isFinite(number) && (input.id === "table-quality-step" ? number === 0.1 : Number.isInteger(number)),
            `Integer default ${fluid}/${variation}/${input.id}`);
        }
        const start = q("#table-start");
        if (start) {
          const step = Number(q("#table-step").value);
          const intervals = (Number(q("#table-end").value) - Number(start.value)) / step;
          assert(step >= 1 && Math.abs(intervals - Math.round(intervals)) < 1e-10,
            `Aligned integer endpoints ${fluid}/${variation}`);
        }
        await submit("#saturation-table-form");
        assert(q("#table-status").dataset.kind === "success",
          `Defaults calculate ${fluid}/${variation}: ${q("#table-status").textContent}`);
        const rows = cells();
        assert(rows.length > 0, "Defaults produce rows");
        const first = Number(q(start ? "#table-start" : "#table-quality-start").value);
        const last = Number(q(start ? "#table-end" : "#table-quality-end").value);
        const interval = Number(q(start ? "#table-step" : "#table-quality-step").value);
        assert(rows.length === Math.round((last - first) / interval) + 1,
          `Default row count ${fluid}/${variation}`);
        const sampledColumn = [...q("#saturation-table thead").querySelectorAll("th")]
          .findIndex((header) => start ? header.textContent.startsWith(variation) : header.textContent === "x");
        assert(sampledColumn >= 0, "Sampled property column exists");
        if (variation === "P") assert(q("#saturation-table thead").textContent.includes("P (kPa)")
          || q("#saturation-table thead").textContent.includes("Pf (kPa)"), "Pressure table uses kPa");
        rows.forEach((row, index) => close(row[sampledColumn], first + index * interval,
          `Default output interval ${fluid}/${variation}/${index}`));
      }
    }

    categories.add("Ph diagram and fluid switching");
    q('input[name="mode-category"][value="drawing"]').click();
    assert(q("#ph-status").dataset.kind === "loading" && q("#ph-chart").getAttribute("aria-busy") === "true",
      "Drawing immediately shows loading status and marks chart busy");
    assert(frame.contentWindow.getComputedStyle(q("#ph-status"), "::before").animationName === "ph-loading-spin"
      || frame.contentWindow.matchMedia("(prefers-reduced-motion: reduce)").matches,
      "Drawing spinner animates unless reduced motion is requested");
    await idle();
    assert(q("#ph-status").dataset.kind === "success" && !q("#ph-chart").hasAttribute("aria-busy"),
      "Successful drawing clears loading state");
    for (const toggle of doc.querySelectorAll(".ph-options input")) toggle.checked = false;
    change("#fluid", "R134a");
    await idle();
    assert(q("#ph-status").dataset.kind === "success", "Existing refrigerant Ph still draws");
    const invalidFluid = new frame.contentWindow.Option("Invalid test fluid", "InvalidTestFluid");
    q("#fluid").append(invalidFluid);
    value("#fluid", invalidFluid.value);
    q("#ph-isotherms").dispatchEvent(new frame.contentWindow.Event("change"));
    assert(q("#ph-status").dataset.kind === "loading", "Redrawing shows loading status");
    await idle();
    assert(q("#ph-status").dataset.kind === "error" && !q("#ph-chart").hasAttribute("aria-busy"),
      "Failed drawing clears spinner and busy state and reports error");
    value("#fluid", "R134a");
    invalidFluid.remove();
    categories.add("R22 Ph range and curve accuracy");
    change("#fluid", "R22");
    await idle();
    const r22 = q("#ph-chart svg");
    assert(q("#ph-status").dataset.kind === "success" && r22.dataset.fluid === "R22", "R22 Ph draws");
    close(Number(r22.dataset.enthalpyMin), 100, "R22 enthalpy lower limit");
    close(Number(r22.dataset.enthalpyMax), 550, "R22 enthalpy upper limit");
    close(Number(r22.dataset.pressureMin), 50000, "R22 pressure lower limit in Pa");
    close(Number(r22.dataset.pressureMax), 6000000, "R22 pressure upper limit in Pa");
    for (const toggle of doc.querySelectorAll(".ph-options input")) toggle.checked = true;
    q("#ph-isotherms").dispatchEvent(new frame.contentWindow.Event("change"));
    await idle();
    const chart = q("#ph-chart svg");
    const r22Props = (output, one, first, two, second) => cp.PropsSI(output, one, first, two, second, "R22");
    close(r22Props("H", "T", 273.15, "Q", 0) / 1000, 200, "R22 IIR reference enthalpy");
    close(r22Props("S", "T", 273.15, "Q", 0) / 1000, 1, "R22 IIR reference entropy");
    assert(chart.querySelector(".ph-reference-state").textContent.includes("h = 200.0 kJ/kg"),
      "R22 chart states its enthalpy and entropy reference");
    const frameBox = chart.querySelector(".ph-frame");
    const left = Number(frameBox.getAttribute("x"));
    const top = Number(frameBox.getAttribute("y"));
    const width = Number(frameBox.getAttribute("width"));
    const height = Number(frameBox.getAttribute("height"));
    const minPressure = Number(chart.dataset.pressureMin);
    const maxPressure = Number(chart.dataset.pressureMax);
    const pointState = ([x, y]) => ({
      h: (100 + (x - left) / width * 450) * 1000,
      p: minPressure * (maxPressure / minPressure) ** (1 - (y - top) / height),
    });
    const coordinates = (path) => [...path.getAttribute("d").matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);
    assert(chart.querySelectorAll("path.ph-quality").length === 9, "Nine R22 quality curves");
    assert(chart.querySelectorAll("path.ph-isotherm").length === 20, "R22 low-temperature and superheated isotherms");
    for (const temperature of [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50]) {
      const path = chart.querySelector(`path.ph-isotherm[data-temperature="${temperature}"]`);
      const points = coordinates(path);
      const pressure = r22Props("P", "T", temperature + 273.15, "Q", 0);
      for (const quality of [0, 1]) {
        const enthalpy = r22Props("H", "T", temperature + 273.15, "Q", quality);
        assert(points.some((point) => {
          const state = pointState(point);
          return Math.abs(state.p / pressure - 1) < .001 && Math.abs(state.h - enthalpy) < 40;
        }), `R22 isotherm reaches saturation endpoint ${temperature}/${quality}`);
      }
    }
    for (const path of chart.querySelectorAll("path.ph-quality, path.ph-isentrope, path.ph-isochore")) {
      const points = coordinates(path);
      assert(points.length >= 2 && !/NaN|Infinity/.test(path.getAttribute("d")), "Finite R22 curve");
      for (const index of [0, Math.floor(points.length / 2), points.length - 1]) {
        const state = pointState(points[index]);
        if (path.dataset.quality) {
          const expected = r22Props("H", "P", state.p, "Q", Number(path.dataset.quality));
          assert(Math.abs(state.h - expected) < 150, "R22 quality curve SI conversion and position");
        } else if (path.dataset.entropy) {
          const expected = r22Props("H", "P", state.p, "S", Number(path.dataset.entropy) * 1000);
          assert(Math.abs(state.h - expected) < 150, "R22 entropy curve SI conversion and position");
        } else {
          const temperature = r22Props("T", "P", state.p, "H", state.h);
          const expected = r22Props("H", "T", temperature, "D", Number(path.dataset.density));
          assert(Math.abs(state.h - expected) < 250, "R22 density curve SI conversion and position");
        }
      }
    }
    const dome = chart.querySelector(".ph-dome");
    assert(coordinates(dome).length === 483, "R22 saturation dome uses dense critical-point sampling");
    assert([...chart.querySelectorAll("path")].every((path) => !/NaN|Infinity/.test(path.getAttribute("d"))),
      "All R22 paths have finite coordinates");
    categories.add("mixture bubble/dew points and temperature glide");
    for (const blend of ["R410A", "R407C"]) {
      change("#fluid", blend);
      await idle();
      await pick("mode-category", "calculation");
      await pick("calculation-mode", "saturation");
      const blendProps = (output, one, first, two, second) => cp.PropsSI(output, one, first, two, second, blend);
      assert(q("#basic-refrigerant-number").textContent === blend, `Mixture basic information ${blend}`);
      assert(q("#basic-formula").textContent.includes(blend === "R407C" ? "23/25/52" : "50/50"),
        `Mixture composition ${blend}`);
      for (const pressure of [500000, 1000000, 2000000]) {
        value("#temperature", "");
        value("#pressure", pressure / 1000);
        await submit("#calculator-form");
        assert(q("#status").dataset.kind === "success", "Mixture pressure saturation solves");
        const bubble = blendProps("T", "P", pressure, "Q", 0);
        const dew = blendProps("T", "P", pressure, "Q", 1);
        if (blend === "R407C") assert(dew - bubble > 4, "R407C has substantial temperature glide");
        assert(dew > bubble && q("#result-summary").textContent.includes("溫度滑移"), "Mixture displays bubble/dew temperature glide");
        for (const [phase, quality] of [["liquid", 0], ["vapor", 1]]) {
          close(Number(q(`#${phase}-h`).textContent), blendProps("H", "P", pressure, "Q", quality) / 1000,
            "Both saturation endpoints share entered pressure");
        }
        await pick("calculation-mode", "state");
        for (const quality of [.1, .5, .9]) {
          const temperature = blendProps("T", "P", pressure, "Q", quality);
          await state("T", temperature - 273.15, "P", pressure / 1000);
          assert(q("#status").dataset.kind === "success", "Mixture P-T inside glide solves");
          close(Number(q("#state-q").textContent), quality, "Mixture P-T quality");
          close(Number(q("#state-h").textContent), blendProps("H", "P", pressure, "Q", quality) / 1000, "Mixture P-T enthalpy");
          await state("T", temperature - 273.15, "Q", quality);
          assert(q("#status").dataset.kind === "success", "Mixture T-Q inverse solves");
          close(Number(q("#state-p").textContent), pressure / 1000, "Mixture T-Q inverse pressure");
        }
        await pick("calculation-mode", "saturation");
      }
      value("#temperature", 10);
      value("#pressure", "");
      await submit("#calculator-form");
      assert(q("#result-summary").textContent.includes("泡點壓力")
        && q("#result-summary").textContent.includes("露點壓力"), "Fixed-temperature bubble/dew pressures displayed");
      await pick("calculation-mode", "state");
      await state("T", 20, "P", 1);
      assert(q("#status").dataset.kind === "success", "Mixture low-pressure vapor remains calculable");
      close(Number(q("#state-h").textContent), blendProps("H", "T", 293.15, "P", 1000) / 1000,
        "Mixture single-phase calculation is unchanged");
      await pick("calculation-mode", "table");
      for (const variation of ["QT", "QP"]) {
        await pick("table-variation", variation);
        value("#table-fixed", variation === "QT" ? 10 : 1000);
        value("#table-quality-start", 0);
        value("#table-quality-end", 1);
        value("#table-quality-step", .1);
        await submit("#saturation-table-form");
        assert(q("#table-status").dataset.kind === "success", `Mixture quality table ${variation}`);
        const rows = cells();
        assert(rows.length === 11, "Mixture quality table row count");
        for (const row of rows) {
          const pressure = row[2] * 1000;
          close(row[1] + 273.15, blendProps("T", "P", pressure, "Q", row[0]), "Mixture table glide temperature");
          close(row[5], blendProps("H", "P", pressure, "Q", row[0]) / 1000, "Mixture table model enthalpy");
        }
        assert(variation === "QT" ? rows[0][2] > rows.at(-1)[2] : rows[0][1] < rows.at(-1)[1],
          "Mixture quality variation preserves glide rather than a pure-fluid plateau");
      }
      await pick("mode-category", "drawing");
      const blendChart = q("#ph-chart svg");
      const blendData = blendChart.dataset;
      const blendCoordinates = coordinates(blendChart.querySelector('path.ph-isotherm[data-temperature="10"]'));
      const bubbleP = blendProps("P", "T", 283.15, "Q", 0);
      const dewP = blendProps("P", "T", 283.15, "Q", 1);
      const middleP = (bubbleP + dewP) / 2;
      const bubbleT = blendProps("T", "P", middleP, "Q", 0);
      const dewT = blendProps("T", "P", middleP, "Q", 1);
      const middleQ = (283.15 - bubbleT) / (dewT - bubbleT);
      const middleH = blendProps("H", "P", middleP, "Q", middleQ) / 1000;
      const expectedX = 72 + (middleH - Number(blendData.enthalpyMin))
        / (Number(blendData.enthalpyMax) - Number(blendData.enthalpyMin)) * 764;
      const expectedY = 30 + (1 - Math.log(middleP / Number(blendData.pressureMin))
        / Math.log(Number(blendData.pressureMax) / Number(blendData.pressureMin))) * 506;
      assert(blendCoordinates.some(([x, y], index) => {
        const next = blendCoordinates[index + 1];
        if (!next || expectedX < Math.min(x, next[0]) || expectedX > Math.max(x, next[0])) return false;
        const fraction = (expectedX - x) / (next[0] - x);
        return Number.isFinite(fraction) && Math.abs(y + fraction * (next[1] - y) - expectedY) < .1;
      }),
        "Mixture isotherm samples the glide interior using P-Q equilibrium");
    }
    categories.add("all-fluid Ph accuracy, labels, interaction and PNG");
    for (const fluid of [...q("#fluid").options].map((option) => option.value)) {
      change("#fluid", fluid);
      await idle();
      assert(q("#ph-status").dataset.kind === "success", `Ph chart draws ${fluid}: ${q("#ph-status").textContent}`);
      const svg = q("#ph-chart svg");
      const data = Object.fromEntries(Object.entries(svg.dataset).map(([key, value]) => [key, Number(value)]));
      assert(data.enthalpyMax > data.enthalpyMin && data.pressureMax > data.pressureMin
        && data.pressureMin > 0, `Valid chart limits ${fluid}`);
      assert(svg.querySelectorAll(".axis-title")[1].textContent === "Pressure P (kPa)", `Pressure axis uses kPa ${fluid}`);
      if (fluid === "R23") close(data.temperatureMin, 173.15, "R23 includes ultra-low-temperature refrigeration");
      if (fluid === "R744") assert(data.pressureMax >= 14e6, "CO2 includes transcritical operation");
      const criticalPoint = svg.querySelector(".ph-cp-dot");
      assert(criticalPoint && Number(criticalPoint.getAttribute("cx")) >= 72
        && Number(criticalPoint.getAttribute("cx")) <= 836 && Number(criticalPoint.getAttribute("cy")) >= 30
        && Number(criticalPoint.getAttribute("cy")) <= 536, `Critical point within plot ${fluid}`);
      const stateAt = ([x, y]) => ({
        h: (data.enthalpyMin + (x - 72) / 764 * (data.enthalpyMax - data.enthalpyMin)) * 1000,
        p: data.pressureMin * (data.pressureMax / data.pressureMin) ** (1 - (y - 30) / 506),
      });
      const fluidProps = (output, one, first, two, second) => cp.PropsSI(output, one, first, two, second, fluid);
      const tolerance = (data.enthalpyMax - data.enthalpyMin) * 2;
      for (const family of ["isotherm", "isentrope", "quality", "isochore"]) {
        const paths = [...svg.querySelectorAll(`path.ph-${family}`)];
        assert(paths.length >= (family === "quality" ? 9 : 3), `Curve family exists ${fluid}/${family}`);
        for (const path of paths) {
          const points = coordinates(path);
          assert(points.length >= 2 && !/NaN|Infinity/.test(path.getAttribute("d")), `Finite curve ${fluid}/${family}`);
          const visible = points.filter(([x, y]) => x >= 72 && x <= 836 && y >= 30 && y <= 536);
          if (!visible.length) continue;
          if (family === "isochore") {
            const samples = Array.from({ length: 361 }, (_, index) => {
              const temperature = data.temperatureMin + (data.temperatureMax - data.temperatureMin) * index / 360;
              const pressure = fluidProps("P", "T", temperature, "D", Number(path.dataset.density));
              const enthalpy = fluidProps("H", "T", temperature, "D", Number(path.dataset.density));
              return [
                72 + (enthalpy / 1000 - data.enthalpyMin) / (data.enthalpyMax - data.enthalpyMin) * 764,
                30 + (1 - Math.log(pressure / data.pressureMin) / Math.log(data.pressureMax / data.pressureMin)) * 506,
              ];
            });
            for (const point of [visible[0], visible[Math.floor(visible.length / 2)], visible.at(-1)]) {
              assert(samples.some((sample) => Math.abs(sample[0] - point[0]) <= .051
                && Math.abs(sample[1] - point[1]) <= .051), `Density coordinates match model ${fluid}`);
            }
            continue;
          }
          for (const point of [visible[0], visible[Math.floor(visible.length / 2)], visible.at(-1)]) {
            const state = stateAt(point);
            let expected;
            if (family === "quality") {
              expected = fluidProps("H", "P", state.p, "Q", Number(path.dataset.quality));
            } else if (family === "isentrope") {
              expected = fluidProps("H", "P", state.p, "S", Number(path.dataset.entropy) * 1000);
            } else {
              const temperature = Number(path.dataset.temperature) + 273.15;
              const actual = fluidProps("T", "P", state.p, "H", state.h);
              assert(Math.abs(actual - temperature) < .3, `Isotherm temperature ${fluid}/${temperature}`);
              continue;
            }
            assert(Number.isFinite(expected) && Math.abs(expected - state.h) < tolerance,
              `Curve property matches model ${fluid}/${family}: ${expected} vs ${state.h}`);
          }
        }
      }
      const bounds = svg.getBoundingClientRect();
      const texts = [...svg.querySelectorAll("text:not([display='none'])")];
      for (const text of texts.filter((element) => element.matches(
        ".ph-label-isotherm,.ph-label-isentrope,.ph-label-quality,.ph-label-isochore"))) {
        const box = text.getBoundingClientRect();
        assert(box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top
          && box.bottom <= bounds.bottom, `Label within chart ${fluid}/${text.textContent}`);
        assert(!texts.some((other) => {
          if (other === text) return false;
          const rect = other.getBoundingClientRect();
          return box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
        }), `Label does not overlap ${fluid}/${text.textContent}`);
      }
      const pressure = Math.sqrt(Math.max(data.pressureMin, fluidProps("ptriple", "", 0, "", 0)) * fluidProps("pcrit", "", 0, "", 0));
      const enthalpy = fluidProps("H", "P", pressure, "Q", .5) / 1000;
      const cursor = svg.createSVGPoint();
      cursor.x = 72 + (enthalpy - data.enthalpyMin) / (data.enthalpyMax - data.enthalpyMin) * 764;
      cursor.y = 30 + (1 - Math.log(pressure / data.pressureMin) / Math.log(data.pressureMax / data.pressureMin)) * 506;
      const screen = cursor.matrixTransform(svg.getScreenCTM());
      svg.dispatchEvent(new frame.contentWindow.PointerEvent("pointermove",
        { clientX: screen.x, clientY: screen.y, pointerType: "mouse" }));
      await wait(() => q("#ph-readout").textContent.includes("x = "), `Pointer readout ${fluid}`);
      const readout = q("#ph-readout").textContent;
      close(Number(readout.match(/P = ([\d.e+-]+)/)[1]), pressure / 1000, `Pointer pressure ${fluid}`);
      close(Number(readout.match(/h = ([\d.e+-]+)/)[1]), enthalpy, `Pointer enthalpy ${fluid}`);
      close(Number(readout.match(/x = ([\d.e+-]+)/)[1]), .5, `Pointer quality ${fluid}`);
      const win = frame.contentWindow;
      const originalClick = win.HTMLAnchorElement.prototype.click;
      try {
        for (const [button, suffix] of [["#ph-download-color-button", ""], ["#ph-download-bw-button", "-bw"]]) {
          let result;
          win.HTMLAnchorElement.prototype.click = function () { result = { url: this.href, filename: this.download }; };
          q(button).click();
          await wait(() => result || q("#ph-status").dataset.kind === "error", `PNG export ${fluid}/${suffix}`);
          assert(result, `PNG export succeeds ${fluid}/${suffix}: ${q("#ph-status").textContent}`);
          const blob = await (await fetch(result.url)).blob();
          const image = await createImageBitmap(blob);
          assert(image.width === 1800 && image.height === 1316 && blob.type === "image/png", `PNG dimensions ${fluid}/${suffix}`);
          assert(result.filename === `ph-diagram-${fluid.toLowerCase().replace(/[^a-z0-9-]/g, "")}${suffix}.png`,
            `PNG filename ${fluid}/${suffix}`);
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, image.width, image.height).data;
          let chromatic = 0;
          for (let index = 0; index < pixels.length; index += 16) {
            if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2])
              - Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 15) chromatic += 1;
          }
          assert(suffix ? chromatic === 0 : chromatic > 100, `PNG color mode ${fluid}/${suffix}`);
          image.close();
        }
      } finally {
        win.HTMLAnchorElement.prototype.click = originalClick;
      }
      for (const [toggle, family] of [["#ph-isotherms", "isotherm"], ["#ph-isentropes", "isentrope"],
        ["#ph-qualities", "quality"], ["#ph-isochores", "isochore"]]) {
        q(toggle).checked = false;
        q(toggle).dispatchEvent(new frame.contentWindow.Event("change"));
        await idle();
        assert(q("#ph-status").dataset.kind === "success" && !q(`#ph-chart path.ph-${family}`),
          `Curve toggle hides family ${fluid}/${family}`);
      }
      for (const toggle of doc.querySelectorAll(".ph-options input")) toggle.checked = true;
      q("#ph-isotherms").dispatchEvent(new frame.contentWindow.Event("change"));
      await idle();
      assert(q("#ph-status").dataset.kind === "success", `All curves restored ${fluid}`);
    }
    change("#fluid", "Water");
    await idle();
    for (const toggle of doc.querySelectorAll(".ph-options input")) toggle.checked = true;
    q("#ph-isotherms").dispatchEvent(new frame.contentWindow.Event("change"));
    await idle();
    assert(q("#ph-status").dataset.kind === "success" && q("#ph-chart svg").dataset.fluid === "Water", "Full water Ph diagram");
    assert([...q("#ph-chart").querySelectorAll("path")].every((path) => !/NaN|Infinity/.test(path.getAttribute("d"))), "Ph paths have finite coordinates");
    return { status: "PASS", checks, categories: [...categories] };
  } finally {
    frame.remove();
  }
}
