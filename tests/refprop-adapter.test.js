import { withRefpropWater } from "../assets/refprop-water.js";

export async function runRefpropAdapterTests() {
  const originalFetch = globalThis.fetch;
  let checks = 0;
  let active = 0;
  let peak = 0;
  let stateRequests = 0;
  let lineRequests = 0;
  let fallbackRequests = 0;
  let token = "test-session";
  const check = (condition, message) => {
    checks += 1;
    if (!condition) throw new Error(message);
  };
  const rejects = async (action, expected) => {
    try {
      await action();
    } catch (error) {
      check(expected(error), `Unexpected error: ${error.message}`);
      return;
    }
    throw new Error("Expected the calculation to fail.");
  };
  const constants = { Tmin: 251.165, molar_mass: 0.018015268 };
  const melting = { temperatureMax: 273.1599999 };
  const coolprop = {
    PropsSI: () => { fallbackRequests += 1; return 42; },
    factory: () => "original factory",
    parameters: { iP: { value: 1 }, iT: { value: 2 } },
  };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/info")) {
      return new Response(JSON.stringify({ token, constants, melting }));
    }
    check(options.headers["X-REFPROP-Token"] === "test-session", "Missing session token.");
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/line")) {
      lineRequests += 1;
      return new Response(JSON.stringify({ pressure: body.temperature * 2 }));
    }
    stateRequests += 1;
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => queueMicrotask(resolve));
      const values = Object.fromEntries(body.keys.map((key, index) => [key, body.values[index]]));
      if (values.T === -2) throw new TypeError("Simulated connection failure.");
      if (values.T === -1) return new Response('{"error":"Native flash rejected"}', { status: 422 });
      return new Response(JSON.stringify({ H: values.T * 10, S: values.T * 2, V: null }));
    } finally {
      active -= 1;
    }
  };
  try {
    const adapter = await withRefpropWater(coolprop);
    check(adapter.PropsSI("Tmin", "", 0, "", 0, "Water") === 251.165, "Water constants were not routed.");
    check(adapter.PropsSI("D", "T", 300, "P", 1e5, "R134a") === 42 && fallbackRequests === 1, "Other fluids changed.");
    check(adapter.factory("HEOS", "Water").molar_mass() === constants.molar_mass
      && adapter.factory("HEOS", "R134a") === "original factory", "Factory routing failed.");
    const props = (output, temperature) => adapter.PropsSI(output, "T", temperature, "P", 1e5, "Water");
    const [h, s] = await Promise.all([props("H", 300), props("S", 300)]);
    const reversed = await adapter.PropsSI("H", "P", 1e5, "T", 300, "Water");
    check(h === 3000 && s === 600 && reversed === h && stateRequests === 1, "Outputs did not share a flash.");
    check(Number.isNaN(await props("V", 300)), "Undefined mixture properties must not become zero.");
    const pressures = await Promise.all([adapter.refpropWater.linePressure("melting", 260),
      adapter.factory("HEOS", "Water").melting_line(1, 2, 260)]);
    check(pressures.every((p) => p === 520) && lineRequests === 1, "Solid-line routing or deduplication failed.");
    await Promise.all(Array.from({ length: 200 }, (_, index) => props("H", 320 + index)));
    check(peak === 4, `Expected four concurrent requests, got ${peak}.`);
    await rejects(() => props("H", -1), (error) => error.message === "Native flash rejected");
    check(await props("H", 520) === 5200, "A native input error stopped valid calculations.");
    token = "replacement-session";
    await rejects(() => adapter.refpropWater.assertReady(), (error) => error.name === "RefpropConnectionError");
    token = "test-session";
    const before = stateRequests;
    const failed = await Promise.allSettled([props("H", -2),
      ...Array.from({ length: 100 }, (_, index) => props("H", 600 + index))]);
    check(failed.some((result) => result.status === "rejected"
      && result.reason.name === "RefpropConnectionError"), "Connection failure was hidden.");
    check(stateRequests - before <= 4, "Queued requests continued after connection failure.");
    check(fallbackRequests === 1, "Water silently fell back to the browser engine.");
    return { status: "PASS", checks, peakRequests: peak };
  } finally {
    globalThis.fetch = originalFetch;
  }
}
