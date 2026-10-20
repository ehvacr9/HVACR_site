"""SI-unit adapter for a locally licensed REFPROP legacy DLL; no NIST data included."""

import ctypes as ct
import logging
import math
from functools import lru_cache
from pathlib import Path


class RefpropError(ValueError):
    pass


class RefpropWater:
    def __init__(self, directory):
        directory = Path(directory).resolve(strict=True)
        dll = directory / ("REFPRP64.DLL" if ct.sizeof(ct.c_void_p) == 8 else "REFPROP.DLL")
        self.dll = ct.WinDLL(str(dll))
        self.z = (ct.c_double * 20)(1)
        nc, ierr, error = ct.c_int(1), ct.c_int(), ct.create_string_buffer(255)
        files = str(directory / "fluids" / "WATER.FLD").encode("ascii")
        mixture = str(directory / "fluids" / "HMX.BNC").encode("ascii")
        self.dll.SETUPdll(ct.byref(nc), files, mixture, b"DEF",
                          ct.byref(ierr), error, ct.c_int(len(files)),
                          ct.c_int(len(mixture)), ct.c_int(3), ct.c_int(255))
        self._check(ierr, error, "SETUP")
        values = [ct.c_double() for _ in range(10)]
        self.dll.INFOdll(ct.byref(nc), *(ct.byref(v) for v in values))
        mass, triple, normal, tc, pc, dc, _, _, _, gas = [v.value for v in values]
        self.mass = mass
        limits = [ct.c_double() for _ in range(4)]
        self.dll.LIMITSdll(b"EOS", self.z, *(ct.byref(v) for v in limits), ct.c_int(3))
        tmin, tmax, _, pmax = [v.value for v in limits]
        self.constants = {
            "Tmin": tmin, "Tmax": tmax, "pmax": pmax * 1000,
            "Ttriple": triple, "Tcrit": tc, "pcrit": pc * 1000,
            "rhomass_critical": dc * mass, "molar_mass": mass / 1000,
            "gas_constant": gas, "normal_boiling_temperature": normal,
        }
        self.constants["ptriple"] = self.line("sublimation", triple)
        if any(not math.isfinite(v) or v <= 0 for v in self.constants.values()):
            raise RefpropError("REFPROP returned invalid fluid constants.")
        # Older DLLs select a high-pressure ice branch in MELTT. Invert MELTP
        # only below the Ice Ih / Ice III boundary instead.
        self.melting_pressure_max = self._native_line("MELTT", 251.165)
        low, high = self.constants["ptriple"], self.melting_pressure_max
        for _ in range(64):
            middle = (low + high) / 2
            value, code, message = self._melting_temperature(middle)
            if code == 2:  # Native lower-pressure limit, not an EOS failure.
                low = middle
            elif code != 0:
                raise RefpropError(f"MELTP [{code}]: {message}")
            else:
                high = middle
        self.melting_pressure_min = high
        self.melting_temperature_max = self.melting_temperature(high)

    @staticmethod
    def _check(ierr, error, operation):
        message = error.value.decode("cp1252", errors="replace").strip()
        if ierr.value > 0:
            raise RefpropError(f"{operation} [{ierr.value}]: {message}")
        if ierr.value < 0:
            logging.warning("%s [%s]: %s", operation, ierr.value, message)

    @lru_cache(maxsize=8192)
    def line(self, kind, temperature):
        if kind not in ("melting", "sublimation"):
            raise RefpropError("Unknown solid line.")
        minimum = 251.165 if kind == "melting" else 50
        maximum = self.melting_temperature_max if kind == "melting" else 273.16
        if not math.isfinite(temperature) or not minimum <= temperature <= maximum:
            raise RefpropError(f"{kind}: temperature must be {minimum} to {maximum} K.")
        if kind == "melting":
            if temperature == minimum:
                return self.melting_pressure_max
            if temperature == maximum:
                return self.melting_pressure_min
            low, high = self.melting_pressure_min, self.melting_pressure_max
            for _ in range(56):
                middle = (low + high) / 2
                if self.melting_temperature(middle) > temperature:
                    low = middle
                else:
                    high = middle
            return (low + high) / 2
        return self._native_line("SUBLT", temperature)

    def _native_line(self, name, temperature):
        t, p, ierr, error = ct.c_double(temperature), ct.c_double(), ct.c_int(), ct.create_string_buffer(255)
        function = getattr(self.dll, name + "dll")
        function(ct.byref(t), self.z, ct.byref(p), ct.byref(ierr), error, ct.c_int(255))
        self._check(ierr, error, name)
        if not math.isfinite(p.value) or p.value <= 0:
            raise RefpropError(f"{name}: invalid pressure.")
        return p.value * 1000

    def _melting_temperature(self, pressure):
        p, t, ierr, error = ct.c_double(pressure / 1000), ct.c_double(), ct.c_int(), ct.create_string_buffer(255)
        self.dll.MELTPdll(ct.byref(p), self.z, ct.byref(t), ct.byref(ierr), error, ct.c_int(255))
        return t.value, ierr.value, error.value.decode("cp1252", errors="replace").strip()

    def melting_temperature(self, pressure):
        value, code, message = self._melting_temperature(pressure)
        if code != 0 or not math.isfinite(value):
            raise RefpropError(f"MELTP [{code}]: {message}")
        return value

    def _density_quality(self, density, quality):
        low = self.constants["Ttriple"]
        # Do not ask the legacy saturation solver to evaluate the singular critical endpoint.
        high = self.constants["Tcrit"] - 1e-7
        at = lambda t: self.state("T", t, "Q", quality)["D"]
        if quality < 0.5:
            left, right = low, high
            # Saturated mixture density can have a maximum (including water's
            # liquid density maximum). Select the warmer root if both exist.
            for _ in range(64):
                a, b = (2 * left + right) / 3, (left + 2 * right) / 3
                if at(a) < at(b):
                    left = a
                else:
                    right = b
            peak = (left + right) / 2
            if at(high) <= density <= at(peak):
                low = peak
            else:
                high = peak
        low_density, high_density = at(low), at(high)
        if not min(low_density, high_density) <= density <= max(low_density, high_density):
            raise RefpropError("Density/quality state is outside the saturation range.")
        increasing = high_density > low_density
        for _ in range(56):
            middle = (low + high) / 2
            if (at(middle) < density) == increasing:
                low = middle
            else:
                high = middle
        result = self.state("T", (low + high) / 2, "Q", quality)
        if abs(result["D"] - density) > 1e-6 * density:
            raise RefpropError("Density/quality flash did not converge to the requested density.")
        return result

    def _pressure_quality(self, pressure, quality):
        low, high = self.constants["Ttriple"], self.constants["Tcrit"] - 1e-7
        first = self.state("T", low, "Q", quality)
        last = self.state("T", high, "Q", quality)
        tolerance = max(1e-8, pressure * 1e-6)
        if abs(pressure - first["P"]) <= tolerance:
            return first
        if not first["P"] <= pressure <= last["P"]:
            raise RefpropError("Pressure/quality state is outside the saturation range.")
        # Legacy PQFLSH is unreliable very close to the triple point.
        for _ in range(56):
            middle = (low + high) / 2
            if self.state("T", middle, "Q", quality)["P"] < pressure:
                low = middle
            else:
                high = middle
        result = self.state("T", (low + high) / 2, "Q", quality)
        if abs(result["P"] - pressure) > tolerance:
            raise RefpropError("Pressure/quality flash did not converge to the requested pressure.")
        return result

    def _refine_caloric_flash(self, inputs, temperature):
        fixed = "D" if "D" in inputs else "S"
        target = next(key for key in inputs if key != fixed)
        tolerance = max(1e-6, abs(inputs[target]) * 1e-8)
        for _ in range(24):
            state = self.state("T", temperature, fixed, inputs[fixed])
            residual = state[target] - inputs[target]
            if abs(residual) <= tolerance:
                return state
            step = max(1e-4, temperature * 1e-6)
            low = max(self.constants["Tmin"], temperature - step)
            high = min(self.constants["Tmax"], temperature + step)
            derivative = (self.state("T", high, fixed, inputs[fixed])[target]
                          - self.state("T", low, fixed, inputs[fixed])[target]) / (high - low)
            if not math.isfinite(derivative) or derivative == 0:
                break
            temperature -= residual / derivative
            if not self.constants["Tmin"] <= temperature <= self.constants["Tmax"]:
                break
        raise RefpropError("REFPROP caloric flash did not converge to both requested properties.")

    @lru_cache(maxsize=8192)
    def state(self, key_one, value_one, key_two, value_two):
        phase = None
        if "|" in key_one:
            key_one, phase = key_one.split("|", 1)
        if "|" in key_two:
            key_two, phase = key_two.split("|", 1)
        if phase is not None and (phase not in ("liquid", "gas") or {key_one, key_two} != {"T", "P"}):
            raise RefpropError("Phase selection is supported only for liquid/gas T,P states.")
        keys = {key_one, key_two}
        if len(keys) != 2 or not keys <= set("TPDHSUQ"):
            raise RefpropError("Select two distinct supported properties.")
        if not all(math.isfinite(v) for v in (value_one, value_two)):
            raise RefpropError("Inputs must be finite.")
        inputs = dict(zip((key_one, key_two), (value_one, value_two)))
        for key in keys & set("TPD"):
            if inputs[key] <= 0:
                raise RefpropError(f"{key} must be positive.")
        if "Q" in keys and not 0 <= inputs["Q"] <= 1:
            raise RefpropError("Quality must be between 0 and 1.")
        if keys == {"D", "Q"}:
            return self._density_quality(inputs["D"], inputs["Q"])
        if keys == {"P", "Q"}:
            return self._pressure_quality(inputs["P"], inputs["Q"])
        specifications = {
            "TP": ("TPFLSH", "T P z D Dl Dv x y Q U H S O C W"),
            "TD": ("TDFLSH", "T D z P Dl Dv x y Q U H S O C W"),
            "PD": ("PDFLSH", "P D z T Dl Dv x y Q U H S O C W"),
            "PH": ("PHFLSH", "P H z T D Dl Dv x y Q U S O C W"),
            "PS": ("PSFLSH", "P S z T D Dl Dv x y Q U H O C W"),
            "PU": ("PEFLSH", "P U z T D Dl Dv x y Q H S O C W"),
            "TH": ("THFLSH", "T H z kr P D Dl Dv x y Q U S O C W"),
            "TS": ("TSFLSH", "T S z kr P D Dl Dv x y Q U H O C W"),
            "TU": ("TEFLSH", "T U z kr P D Dl Dv x y Q H S O C W"),
            "DH": ("DHFLSH", "D H z T P Dl Dv x y Q U S O C W"),
            "DS": ("DSFLSH", "D S z T P Dl Dv x y Q U H O C W"),
            "DU": ("DEFLSH", "D U z T P Dl Dv x y Q H S O C W"),
            "HS": ("HSFLSH", "H S z T P D Dl Dv x y Q U O C W"),
            "US": ("ESFLSH", "U S z T P D Dl Dv x y Q H O C W"),
            "TQ": ("TQFLSH", "T Q z kq P D Dl Dv x y U H S O C W"),
        }
        spec = next((v for k, v in specifications.items() if set(k) == keys), None)
        if spec is None:
            raise RefpropError("REFPROP does not support this property pair.")
        native = {k: ct.c_double() for k in "TPDHSUQOCW"}
        native.update(Dl=ct.c_double(), Dv=ct.c_double(), z=self.z,
                      x=(ct.c_double * 20)(), y=(ct.c_double * 20)(),
                      kr=ct.c_int(1), kq=ct.c_int(2))
        for key, value in inputs.items():
            factor = 0.001 if key == "P" else 1 / self.mass if key == "D" else self.mass / 1000 if key in "HSU" else 1
            native[key].value = value * factor
        ierr, error = ct.c_int(), ct.create_string_buffer(255)
        name, arguments = spec
        if phase:
            kph, guess = ct.c_int(1 if phase == "liquid" else 2), ct.c_int(0)
            self.dll.TPRHOdll(ct.byref(native["T"]), ct.byref(native["P"]), self.z,
                             ct.byref(kph), ct.byref(guess), ct.byref(native["D"]),
                             ct.byref(ierr), error, ct.c_int(255))
            self._check(ierr, error, "TPRHO")
            thermal = [ct.c_double() for _ in range(8)]
            self.dll.THERMdll(ct.byref(native["T"]), ct.byref(native["D"]), self.z,
                              *(ct.byref(v) for v in thermal))
            for key, value in zip("PUHSOCW", thermal):
                native[key].value = value.value
            native["Q"].value = -1 if phase == "liquid" else 2
        else:
            getattr(self.dll, name + "dll")(
                *(native[k] if k in ("z", "x", "y") else ct.byref(native[k]) for k in arguments.split()),
                ct.byref(ierr), error, ct.c_int(255),
            )
            self._check(ierr, error, name)
        result = {k: native[k].value for k in "TPDHSUQOCW"}
        result["P"] *= 1000
        result["D"] *= self.mass
        for key in "HSUOC":
            result[key] *= 1000 / self.mass
        if (not all(math.isfinite(result[k]) for k in "TPDHSUQ")
                or result["T"] < self.constants["Tmin"] - 1e-8
                or result["T"] > self.constants["Tmax"]
                or not 0 < result["P"] <= self.constants["pmax"]
                or result["D"] <= 0):
            raise RefpropError("State is outside the REFPROP fluid model limits.")
        q, t, p = result["Q"], result["T"], result["P"]
        if 0 <= q <= 1:
            result["Phase"] = 6
        elif t >= self.constants["Tcrit"]:
            result["Phase"] = 1 if p >= self.constants["pcrit"] else 2
        elif p >= self.constants["pcrit"]:
            result["Phase"] = 3
        else:
            result["Phase"] = 0 if result["D"] > self.constants["rhomass_critical"] else 5
        if q == 0 or q == 1:
            # Flash routines use sentinel heat capacities at saturation endpoints.
            density = native["Dl"] if q == 0 else native["Dv"]
            thermal = [ct.c_double() for _ in range(8)]
            self.dll.THERMdll(ct.byref(native["T"]), ct.byref(density), self.z,
                              *(ct.byref(v) for v in thermal))
            result["O"] = thermal[4].value * 1000 / self.mass
            result["C"] = thermal[5].value * 1000 / self.mass
        result["V"] = None
        if not 0 < q < 1:
            eta, conductivity = ct.c_double(), ct.c_double()
            self.dll.TRNPRPdll(ct.byref(native["T"]), ct.byref(native["D"]), self.z,
                              ct.byref(eta), ct.byref(conductivity),
                              ct.byref(ierr), error, ct.c_int(255))
            self._check(ierr, error, "TRNPRP")
            if not math.isfinite(eta.value) or eta.value <= 0:
                raise RefpropError("REFPROP returned invalid viscosity.")
            result["V"] = eta.value * 1e-6
        else:
            result["C"] = result["O"] = None
        for key in "CO":
            if result[key] is not None and (not math.isfinite(result[key]) or result[key] <= 0):
                raise RefpropError(f"REFPROP returned invalid {key}.")
        if 0 <= q <= 1 and keys != {"T", "Q"}:
            # Some legacy two-phase flashes leave an input caloric value intact
            # even when their solved state is inconsistent. Re-evaluate the state.
            result = self.state("T", t, "Q", q)
        matches = all(abs(result[key] - value) <= max(1e-6, abs(value) * 1e-6)
                      for key, value in inputs.items())
        consistent = abs(result["H"] - result["U"] - result["P"] / result["D"]) <= max(
            0.01, abs(result["H"]) * 1e-7)
        if not matches or not consistent:
            if keys in ({"D", "H"}, {"D", "S"}, {"D", "U"}, {"S", "U"}):
                return self._refine_caloric_flash(inputs, t)
            raise RefpropError("REFPROP flash result does not match both requested properties.")
        return result
