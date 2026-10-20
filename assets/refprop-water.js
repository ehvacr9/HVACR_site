// The licensed DLL stays on the user's computer; only SI calculation results cross this API.
class RefpropConnectionError extends Error {
  name = "RefpropConnectionError";
}

export async function withRefpropWater(coolprop) {
  const loadInfo = async () => {
    try {
      const response = await fetch("./api/refprop/info", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      throw new RefpropConnectionError("無法連線至水的本機計算服務，請重新啟動服務並使用提供的網址。", { cause: error });
    }
  };
  const info = await loadInfo();
  const states = new Map();
  const lines = new Map();
  let activeRequests = 0;
  let connectionFailure;
  const waitingRequests = [];
  const request = async (endpoint, body) => {
    await new Promise((resolve) => {
      const start = () => { activeRequests += 1; resolve(); };
      if (activeRequests < 4) start();
      else waitingRequests.push(start);
    });
    try {
      if (connectionFailure) throw connectionFailure;
      let response;
      let data;
      try {
        response = await fetch(`./api/refprop/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-REFPROP-Token": info.token },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        data = await response.json();
      } catch (error) {
        connectionFailure = new RefpropConnectionError("水的本機計算服務已中斷，請重新啟動服務並重新整理網頁。", { cause: error });
        throw connectionFailure;
      }
      if (response.status === 403) {
        connectionFailure = new RefpropConnectionError("本機計算工作階段已失效，請重新整理網頁。");
        throw connectionFailure;
      }
      if (!response.ok) throw new Error(data.error || `水的計算失敗（HTTP ${response.status}）。`);
      return data;
    } finally {
      activeRequests -= 1;
      waitingRequests.shift()?.();
    }
  };
  const cached = (cache, key, create) => {
    if (!cache.has(key)) {
      if (cache.size >= 8192) cache.delete(cache.keys().next().value);
      const promise = create().catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
    }
    return cache.get(key);
  };
  const linePressure = (kind, temperature) => cached(lines, `${kind}|${temperature}`,
    () => request("line", { kind, temperature }).then((data) => data.pressure));
  return {
    ...coolprop,
    refpropWater: {
      constants: info.constants, melting: info.melting, linePressure,
      async assertReady() {
        if ((await loadInfo()).token !== info.token) {
          throw new RefpropConnectionError("本機計算工作階段已失效，請重新整理網頁。");
        }
      },
    },
    PropsSI(output, keyOne, valueOne, keyTwo, valueTwo, fluid) {
      if (fluid !== "Water") return coolprop.PropsSI(output, keyOne, valueOne, keyTwo, valueTwo, fluid);
      if (!keyOne && !keyTwo) {
        if (!(output in info.constants)) throw new Error(`未支援的水常數：${output}`);
        return info.constants[output];
      }
      const entries = [[keyOne, valueOne], [keyTwo, valueTwo]].sort(([a], [b]) => a.localeCompare(b));
      const key = JSON.stringify(entries);
      return cached(states, key, () => request("state", {
        keys: entries.map(([name]) => name), values: entries.map(([, value]) => value),
      })).then((state) => {
        if (!(output in state)) throw new Error(`未支援的水性質：${output}`);
        return state[output] === null ? NaN : state[output];
      });
    },
    factory(backend, fluid) {
      if (fluid !== "Water") return coolprop.factory(backend, fluid);
      const c = info.constants;
      return {
        molar_mass: () => c.molar_mass, gas_constant: () => c.gas_constant,
        Ttriple: () => c.Ttriple, p_triple: () => c.ptriple,
        T_critical: () => c.Tcrit, p_critical: () => c.pcrit,
        rhomass_critical: () => c.rhomass_critical,
        melting_line(output, input, temperature) {
          if (output !== coolprop.parameters.iP.value || input !== coolprop.parameters.iT.value) {
            throw new Error("水的熔化線僅支援指定 Ice Ih 溫度計算壓力。");
          }
          return linePressure("melting", temperature);
        },
      };
    },
  };
}
