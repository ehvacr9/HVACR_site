import ctypes as ct
import itertools
import json
import math
import sys
import threading
import unittest
from http.client import HTTPConnection
from http.server import HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local"))
from refprop_water import RefpropError, RefpropWater
from serve_refprop import Handler


class WaterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.water = RefpropWater(r"C:\Program Files (x86)\REFPROP")

    def test_constants_and_reference_state(self):
        water = self.water
        self.assertAlmostEqual(water.constants["molar_mass"], 0.018015268)
        self.assertEqual(water.constants["pcrit"], 22064000)
        state = water.state("T", 300, "P", 101325)
        self.assertAlmostEqual(state["D"], 996.556935, places=5)
        self.assertAlmostEqual(state["H"], 112654.900, places=2)
        self.assertAlmostEqual(state["C"], 4180.636, places=2)
        self.assertAlmostEqual(state["V"], 0.0008537425, places=9)
        triple = water.state("T", 273.16, "Q", 0)
        self.assertLess(abs(triple["U"]), 1e-3)
        self.assertLess(abs(triple["S"]), 1e-5)
        for temperature, pressure, phase in [(300, 101325, 0), (450, 200000, 5),
                                            (700, 30e6, 1), (700, 1e5, 2), (300, 30e6, 3)]:
            with self.subTest(phase=phase):
                self.assertEqual(water.state("T", temperature, "P", pressure)["Phase"], phase)

    def test_all_property_pairs(self):
        water = self.water
        reference = water.state("T", 450, "P", 200000)
        for one, two in itertools.combinations("TPDHSU", 2):
            with self.subTest(pair=one + two):
                if {one, two} == {"H", "U"}:
                    with self.assertRaises(RefpropError):
                        water.state(one, reference[one], two, reference[two])
                    continue
                for a, b in [(one, two), (two, one)]:
                    state = water.state(a, reference[a], b, reference[b])
                    self.assertAlmostEqual(state["T"], 450, delta=0.001)
                    self.assertAlmostEqual(state["P"], 200000, delta=1)

    def test_saturation_and_quality(self):
        water = self.water
        triple_pressure = self.water.state("T", 273.16, "Q", 0)["P"]
        for key, value in [("T", 373.15), ("P", 101325), ("P", 1000), ("P", triple_pressure)]:
            for quality in [0, 0.25, 0.5, 0.75, 1]:
                with self.subTest(key=key, quality=quality):
                    state = water.state(key, value, "Q", quality)
                    self.assertEqual(state["Phase"], 6)
                    self.assertEqual(state["Q"], quality)
                    self.assertAlmostEqual(state["H"] - state["U"], state["P"] / state["D"], delta=0.01)
                    if 0 < quality < 1:
                        self.assertIsNone(state["C"])
                        self.assertIsNone(state["O"])
                        self.assertIsNone(state["V"])
                    else:
                        self.assertGreater(state["C"], state["O"])
                        self.assertGreater(state["V"], 0)
                    recovered = water.state("D", state["D"], "Q", quality)
                    if quality == 0 and state["T"] < 277.2:
                        self.assertGreater(recovered["T"], 277.2)
                        self.assertAlmostEqual(recovered["D"], state["D"], delta=1e-4)
                    else:
                        self.assertAlmostEqual(recovered["T"], state["T"], delta=1e-4)
                        self.assertAlmostEqual(recovered["P"], state["P"], delta=1)

    def test_two_phase_caloric_flash_consistency(self):
        reference = self.water.state("T", 373.15, "Q", 0.5)
        for pair in ["DH", "DS", "DU", "SU", "PH", "PS", "PU", "HS", "TH", "TS", "TU"]:
            one, two = pair
            with self.subTest(pair=pair):
                state = self.water.state(one, reference[one], two, reference[two])
                self.assertAlmostEqual(state["T"], reference["T"], delta=1e-4)
                self.assertAlmostEqual(state["P"], reference["P"], delta=1)
                for key in [one, two]:
                    self.assertAlmostEqual(state[key], reference[key], delta=max(1e-5, abs(reference[key]) * 1e-7))
                self.assertAlmostEqual(state["H"] - state["U"], state["P"] / state["D"], delta=0.01)

    def test_entropy_chart_edge_and_density_multiple_roots(self):
        for entropy in range(1000, 9000, 1000):
            with self.subTest(entropy=entropy):
                state = self.water.state("P", 1000, "S", entropy)
                self.assertAlmostEqual(state["S"], entropy, delta=0.01)
                self.assertAlmostEqual(state["P"], 1000, delta=0.001)
        warm = self.water.state("T", 279, "Q", 0)
        recovered = self.water.state("D", warm["D"], "Q", 0)
        self.assertAlmostEqual(recovered["T"], 279, delta=1e-4)

    def test_solid_lines_and_coexisting_states(self):
        water = self.water
        self.assertAlmostEqual(water.line("sublimation", 230), 8.947352740189151, places=9)
        # Direct MELTT(260 K) selects another ice branch in REFPROP 9.1.
        self.assertAlmostEqual(water.line("melting", 260), 138268113.0, delta=10)
        for index in range(81):
            t = 251.165 + (water.melting_temperature_max - 251.165) * index / 80
            p = water.line("melting", t)
            self.assertAlmostEqual(water.melting_temperature(p), t, delta=1e-7)
            liquid = water.state("T|liquid", t, "P", p)
            self.assertGreater(liquid["D"], 900)
            self.assertAlmostEqual(liquid["P"], p, delta=0.01)
            self.assertAlmostEqual(liquid["H"] - liquid["U"], p / liquid["D"], delta=0.01)
        for index in range(81):
            t = 50 + (273.16 - 50) * index / 80
            p = water.line("sublimation", t)
            self.assertTrue(math.isfinite(p) and p > 0)
            if t >= water.constants["Tmin"]:
                vapor = water.state("P", p, "T|gas", t)
                self.assertLess(vapor["D"], 0.01)
                self.assertGreater(vapor["C"], vapor["O"])

    def test_limits_and_unsupported_inputs(self):
        for args in [
            ("T", 2100, "P", 101325), ("T", 240, "P", 101325),
            ("T", math.nan, "P", 101325), ("P", -1, "Q", 0),
            ("T", 300, "Q", 1.1), ("T", 300, "T", 301),
            ("H", 1e6, "Q", 0), ("S", 4000, "Q", 0.5),
            ("U", 1e6, "Q", 1), ("T|solid", 260, "P", 1e6),
        ]:
            with self.subTest(args=args), self.assertRaises(RefpropError):
                self.water.state(*args)
        for line, temp in [("melting", 250), ("melting", 274), ("sublimation", 49), ("sublimation", 274)]:
            with self.subTest(line=line, temp=temp), self.assertRaises(RefpropError):
                self.water.line(line, temp)

    def test_against_direct_native_tp_flash(self):
        water = self.water
        for temperature, pressure in [(300, 101325), (450, 2e5), (700, 30e6), (1500, 10e6)]:
            with self.subTest(temperature=temperature, pressure=pressure):
                t, p = ct.c_double(temperature), ct.c_double(pressure / 1000)
                d, dl, dv = ct.c_double(), ct.c_double(), ct.c_double()
                x, y = (ct.c_double * 20)(), (ct.c_double * 20)()
                values = [ct.c_double() for _ in range(7)]
                ierr, error = ct.c_int(), ct.create_string_buffer(255)
                water.dll.TPFLSHdll(ct.byref(t), ct.byref(p), water.z, ct.byref(d),
                                    ct.byref(dl), ct.byref(dv), x, y,
                                    *(ct.byref(v) for v in values),
                                    ct.byref(ierr), error, ct.c_int(255))
                self.assertEqual(ierr.value, 0, error.value)
                actual = water.state("P", pressure, "T", temperature)
                self.assertAlmostEqual(actual["D"], d.value * water.mass, places=8)
                self.assertAlmostEqual(actual["H"], values[2].value * 1000 / water.mass, places=6)
                self.assertAlmostEqual(actual["S"], values[3].value * 1000 / water.mass, places=6)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        cls.server.water = RefpropWater(r"C:\Program Files (x86)\REFPROP")
        cls.server.token = "unit-test-session-token"
        cls.server.authority = f"127.0.0.1:{cls.server.server_port}"
        cls.server.origin = "http://" + cls.server.authority
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_info_static_files_and_private_paths(self):
        status, data = self.request("GET", "/api/refprop/info")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["token"], self.server.token)
        for path in ["/assets/refprop-water.js", "/pycool.html?water=refprop", "/tests/water-tests.html"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 200)
        self.assertEqual(self.request("GET", "/pycool.html")[0], 302)
        for path in ["/.git/config", "/local/refprop_water.py", "/tests/test_refprop_water.py",
                     "/../.git/config", "/%2e%2e/REFPROP/fluids/WATER.FLD", "/local/"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)

    def test_origin_and_token_checks(self):
        for headers in [{"Host": "example.com"}, {"Origin": "https://example.com"},
                        {"Sec-Fetch-Site": "cross-site"}]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request("GET", "/api/refprop/info", headers=headers)[0], 403)
        self.assertEqual(self.request("POST", "/api/refprop/state", "{}")[0], 403)

    def test_api_errors_and_si_outputs(self):
        headers = {"X-REFPROP-Token": self.server.token, "Content-Type": "application/json"}
        status, data = self.request("POST", "/api/refprop/state", json.dumps({
            "keys": ["T", "P"], "values": [300, 101325],
        }), headers)
        self.assertEqual(status, 200)
        self.assertAlmostEqual(json.loads(data)["D"], 996.556935, places=5)
        status, data = self.request("POST", "/api/refprop/line",
                                    '{"kind":"sublimation","temperature":230}', headers)
        self.assertEqual(status, 200)
        self.assertAlmostEqual(json.loads(data)["pressure"], 8.94735274, places=8)
        for body in ["[]", "null", "{}", "{", '{"keys":["T","T"],"values":[300,301]}',
                     '{"keys":["T","P"],"values":[true,100000]}',
                     '{"keys":["T","P"],"values":[2100,100000]}']:
            with self.subTest(body=body):
                status, data = self.request("POST", "/api/refprop/state", body, headers)
                self.assertEqual(status, 422)
                self.assertTrue(json.loads(data)["error"])


if __name__ == "__main__":
    unittest.main()
