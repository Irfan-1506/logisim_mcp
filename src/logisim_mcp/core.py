from __future__ import annotations

import ast
import hashlib
import itertools
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from defusedxml import ElementTree as SafeET

LIBRARIES = {"Wiring": "0", "Gates": "1", "Plexers": "2", "Arithmetic": "3", "Memory": "4", "I/O": "5", "Base": "6"}
CATALOG = {
    "Wiring": ["Pin", "Tunnel", "Splitter", "Clock", "Constant", "Probe", "Pull Resistor", "Power", "Ground"],
    "Gates": ["NOT Gate", "Buffer", "AND Gate", "OR Gate", "NAND Gate", "NOR Gate", "XOR Gate", "XNOR Gate", "Controlled Buffer", "Controlled Inverter"],
    "Plexers": ["Multiplexer", "Demultiplexer", "Decoder", "Priority Encoder", "Bit Selector"],
    "Arithmetic": ["Adder", "Subtractor", "Multiplier", "Divider", "Negator", "Comparator", "Shifter", "Bit Adder", "Bit Finder"],
    "Memory": ["D Flip-Flop", "T Flip-Flop", "J-K Flip-Flop", "S-R Flip-Flop", "Register", "Counter", "Random", "RAM", "ROM"],
    "I/O": ["Button", "LED", "RGB LED", "7-Segment Display", "Hex Digit Display", "LED Matrix", "TTY", "Keyboard"],
    "Base": ["Text"],
}
LOCK = threading.RLock()

def xy(value):
    if isinstance(value, str):
        match = re.fullmatch(r"\((-?\d+),(-?\d+)\)", value)
        if not match:
            raise ValueError(f"Invalid coordinate: {value}")
        value = [int(x) for x in match.groups()]
    if not isinstance(value, (list, tuple)) or len(value) != 2 or any(type(v) is not int for v in value):
        raise ValueError("Coordinates must be [x, y] integers")
    if any(v < 0 or v > 100000 or v % 10 for v in value):
        raise ValueError("Coordinates must be on the 10-unit grid, between 0 and 100000")
    return tuple(value)

def loc(value):
    return "(%d,%d)" % xy(value)

def attrs(element):
    return {a.get("name"): a.get("val", a.text or "") for a in element.findall("a")}

def set_attrs(element, values):
    for key, value in values.items():
        if not isinstance(value, (str, int, bool)) and value is not None:
            raise ValueError("Attribute values must be strings, integers, booleans, or null")
        old = next((a for a in element.findall("a") if a.get("name") == key), None)
        if old is not None:
            element.remove(old)
        if value is not None:
            ET.SubElement(element, "a", name=key, val=str(value).lower() if isinstance(value, bool) else str(value))

def circuit(root, name):
    found = next((c for c in root.findall("circuit") if c.get("name") == name), None)
    if found is None:
        raise ValueError(f"Circuit not found: {name}")
    return found

def new_project(name="main"):
    root = ET.Element("project", source="3.8.0", version="1.0")
    root.text = "\nThis file is intended to be loaded by Logisim-evolution v3.8.0 or later.\n"
    for library, number in LIBRARIES.items():
        ET.SubElement(root, "lib", name=number, desc="#" + library)
    ET.SubElement(root, "main", name=name)
    ET.SubElement(root, "options")
    ET.SubElement(root, "mappings")
    ET.SubElement(root, "toolbar")
    c = ET.SubElement(root, "circuit", name=name)
    set_attrs(c, {"appearance": "logisim_evolution"})
    return root

def add_component(root, c, name, at, attributes=None, library=None):
    if library is None:
        library = next((lib for lib, names in CATALOG.items() if name in names), None)
    data = {"name": name, "loc": loc(at)}
    if library is not None:
        lib = next((l for l in root.findall("lib") if l.get("desc") == "#" + library or l.get("name") == library), None)
        if lib is None:
            raise ValueError(f"Unknown library: {library}")
        data["lib"] = lib.get("name")
    elif not any(x.get("name") == name for x in root.findall("circuit")):
        raise ValueError(f"Unknown component {name}; specify its existing library ID for custom components")
    if any(x.get("loc") == data["loc"] for x in c.findall("comp")):
        raise ValueError(f"A component already occupies {data['loc']}")
    comp = ET.SubElement(c, "comp", data)
    set_attrs(comp, attributes or {})
    return comp

def wire(c, points):
    if len(points) < 2:
        raise ValueError("A wire path needs at least two points")
    for a, b in zip(points, points[1:]):
        a, b = xy(a), xy(b)
        if a == b or (a[0] != b[0] and a[1] != b[1]):
            raise ValueError("Wire segments must be nonzero and horizontal or vertical")
        pair = {loc(a), loc(b)}
        if not any({w.get("from"), w.get("to")} == pair for w in c.findall("wire")):
            ET.SubElement(c, "wire", {"from": loc(a), "to": loc(b)})

def validate(root):
    errors, warnings = [], []
    if root.tag != "project":
        errors.append("Root must be <project>")
    circuits = root.findall("circuit")
    names = [c.get("name") for c in circuits]
    if len(names) != len(set(names)) or any(not n for n in names):
        errors.append("Circuit names must be nonempty and unique")
    main = root.find("main")
    if main is None or main.get("name") not in names:
        errors.append("Main circuit is missing or unknown")
    libs = {l.get("name") for l in root.findall("lib")}
    edges = {n: [] for n in names}
    for c in circuits:
        occupied = set()
        for comp in c.findall("comp"):
            p = comp.get("loc")
            try:
                xy(p)
            except (ValueError, TypeError):
                errors.append(f"{c.get('name')}: invalid component location {p}")
            if p in occupied:
                warnings.append(f"{c.get('name')}: overlapping component anchors at {p}")
            occupied.add(p)
            if comp.get("lib") is not None and comp.get("lib") not in libs:
                errors.append(f"Unknown library {comp.get('lib')}")
            if comp.get("lib") is None:
                if comp.get("name") not in names:
                    errors.append(f"Unknown subcircuit {comp.get('name')}")
                else:
                    edges[c.get("name")].append(comp.get("name"))
        for w in c.findall("wire"):
            try:
                a, b = xy(w.get("from")), xy(w.get("to"))
                if a == b or (a[0] != b[0] and a[1] != b[1]):
                    raise ValueError()
            except (ValueError, TypeError):
                errors.append(f"{c.get('name')}: invalid wire {dict(w.attrib)}")
    def visit(n, stack):
        if n in stack:
            raise ValueError("Recursive subcircuit dependency")
        for child in edges[n]:
            visit(child, stack | {n})
    try:
        for n in names:
            visit(n, set())
    except (ValueError, RecursionError):
        errors.append("Recursive subcircuit dependency")
    return {"valid": not errors, "errors": errors, "warnings": warnings,
            "scope": "XML structure, library references, grid and wires; electrical correctness requires native simulation"}

class Store:
    def __init__(self, workspace):
        self.workspace = Path(workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)

    def path(self, name):
        p = (self.workspace / name).resolve()
        if not p.is_relative_to(self.workspace) or p.suffix.lower() != ".circ":
            raise ValueError("Project path must be a .circ file inside LOGISIM_WORKSPACE")
        return p

    def read(self, name):
        p = self.path(name)
        if p.stat().st_size > 20_000_000:
            raise ValueError("Project exceeds 20 MB limit")
        return SafeET.parse(p).getroot()

    def write(self, name, root, overwrite=False, expected_sha256=None):
        p = self.path(name)
        report = validate(root)
        if not report["valid"]:
            raise ValueError("; ".join(report["errors"]))
        if p.exists() and not overwrite:
            raise ValueError("File exists; use overwrite=true explicitly")
        if expected_sha256 and (not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest() != expected_sha256):
            raise ValueError("File changed since inspection; inspect again before editing")
        p.parent.mkdir(parents=True, exist_ok=True)
        backup = None
        if p.exists():
            backup = p.with_name(p.name + f".{time.time_ns()}.bak")
            shutil.copy2(p, backup)
        ET.indent(root, space="  ")
        data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        fd, tmp = tempfile.mkstemp(dir=p.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, p)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return {"path": str(p), "sha256": hashlib.sha256(data).hexdigest(), "backup": str(backup) if backup else None, "validation": report}

    def inspect(self, name):
        root = self.read(name)
        return {"path": str(self.path(name)), "sha256": hashlib.sha256(self.path(name).read_bytes()).hexdigest(),
                "source": root.get("source"), "libraries": [dict(l.attrib) for l in root.findall("lib")],
                "circuits": [{"name": c.get("name"), "attributes": attrs(c),
                              "components": [{**dict(e.attrib), "attributes": attrs(e)} for e in c.findall("comp")],
                              "wires": [dict(e.attrib) for e in c.findall("wire")]} for c in root.findall("circuit")]}

    def edit(self, name, operations, expected_sha256=None):
        with LOCK:
            root = self.read(name)
            for op in operations:
                action = op["action"]
                if action == "add_circuit":
                    if not op.get("name") or any(c.get("name") == op["name"] for c in root.findall("circuit")):
                        raise ValueError("New circuit name must be nonempty and unique")
                    ET.SubElement(root, "circuit", name=op["name"])
                    continue
                if action == "set_main":
                    circuit(root, op["name"])
                    root.find("main").set("name", op["name"])
                    continue
                c = circuit(root, op.get("circuit", "main"))
                if action == "add_component":
                    add_component(root, c, op["name"], op["at"], op.get("attributes"), op.get("library"))
                elif action == "add_wire":
                    wire(c, op["points"])
                elif action == "remove_wire":
                    pair = {loc(op["from"]), loc(op["to"])}
                    matches = [w for w in c.findall("wire") if {w.get("from"), w.get("to")} == pair]
                    if not matches:
                        raise ValueError("Wire not found")
                    for w in matches:
                        c.remove(w)
                elif action in ("set_attributes", "remove_component", "move_component"):
                    matches = [e for e in c.findall("comp") if e.get("loc") == loc(op["at"])]
                    if len(matches) != 1:
                        raise ValueError("Component anchor must match exactly one component")
                    comp = matches[0]
                    if action == "set_attributes":
                        set_attrs(comp, op["attributes"])
                    elif action == "remove_component":
                        c.remove(comp)
                    else:
                        if any(e.get("loc") == loc(op["to"]) for e in c.findall("comp") if e is not comp):
                            raise ValueError("Destination anchor occupied")
                        comp.set("loc", loc(op["to"]))
                else:
                    raise ValueError(f"Unknown action: {action}")
            return self.write(name, root, overwrite=True, expected_sha256=expected_sha256)

def parse_expression(expression, inputs):
    if len(expression) > 4096:
        raise ValueError("Expression too long")
    tree = ast.parse(expression, mode="eval").body
    if sum(1 for _ in ast.walk(tree)) > 512:
        raise ValueError("Expression too complex")
    def check(n):
        if isinstance(n, ast.Name) and n.id in inputs:
            return
        if isinstance(n, ast.Constant) and type(n.value) in (int, bool) and n.value in (0, 1):
            return
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.Invert, ast.Not)):
            check(n.operand)
            return
        if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.BitAnd, ast.BitOr, ast.BitXor)):
            check(n.left)
            check(n.right)
            return
        raise ValueError("Use declared inputs, 0/1, ~ or not, &, |, ^ and parentheses only")
    check(tree)
    return tree

def evaluate(n, values):
    if isinstance(n, ast.Name):
        return values[n.id]
    if isinstance(n, ast.Constant):
        return int(n.value)
    if isinstance(n, ast.UnaryOp):
        return 1 - evaluate(n.operand, values)
    a, b = evaluate(n.left, values), evaluate(n.right, values)
    return a & b if isinstance(n.op, ast.BitAnd) else a | b if isinstance(n.op, ast.BitOr) else a ^ b

def synthesize(inputs, outputs, circuit_name="main"):
    names = inputs + list(outputs)
    if not inputs or not outputs or len(inputs) > 12 or len(outputs) > 32:
        raise ValueError("Provide 1–12 inputs and 1–32 outputs")
    if len(names) != len(set(names)) or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", n) for n in names):
        raise ValueError("Input/output names must be unique identifiers starting with a letter")
    trees = {name: parse_expression(expr, inputs) for name, expr in outputs.items()}
    root = new_project(circuit_name)
    c = circuit(root, circuit_name)
    # Each net uses native Tunnel components, avoiding accidental wire crossings.
    def tunnel(net, at, facing="west"):
        add_component(root, c, "Tunnel", at, {"label": net, "facing": facing})
    for i, name in enumerate(inputs):
        y = 100 + i * 80
        add_component(root, c, "Pin", (100, y), {"label": name, "facing": "east"})
        tunnel(name, (180, y))
        wire(c, [(100, y), (180, y)])
    cache = {}
    def build(n):
        if isinstance(n, ast.Name):
            return n.id
        key = ast.dump(n)
        if key in cache:
            return cache[key]
        sources = [] if isinstance(n, ast.Constant) else [build(n.operand)] if isinstance(n, ast.UnaryOp) else [build(n.left), build(n.right)]
        index = len(cache)
        net = f"__mcp_net_{index}"
        x, y = 450 + (index // 12) * 400, 100 + (index % 12) * 120
        if isinstance(n, ast.Constant):
            add_component(root, c, "Constant", (x, y), {"value": hex(n.value)})
        elif isinstance(n, ast.UnaryOp):
            add_component(root, c, "NOT Gate", (x, y), {"size": 30, "facing": "east"})
            tunnel(sources[0], (x - 100, y), "east")
            wire(c, [(x - 100, y), (x - 30, y)])
        else:
            gate = "AND Gate" if isinstance(n.op, ast.BitAnd) else "OR Gate" if isinstance(n.op, ast.BitOr) else "XOR Gate"
            add_component(root, c, gate, (x, y), {"size": 50, "inputs": 2, "facing": "east"})
            dx = 60 if gate == "XOR Gate" else 50
            for source, dy in zip(sources, [-20, 20]):
                tunnel(source, (x - 100, y + dy), "east")
                wire(c, [(x - 100, y + dy), (x - dx, y + dy)])
        tunnel(net, (x + 80, y))
        wire(c, [(x, y), (x + 80, y)])
        cache[key] = net
        return net
    nets = {name: build(tree) for name, tree in trees.items()}
    out_x = 850 + ((max(len(cache), 1) - 1) // 12) * 400
    for i, (name, net) in enumerate(nets.items()):
        y = 100 + i * 80
        tunnel(net, (out_x, y), "east")
        add_component(root, c, "Pin", (out_x + 100, y), {"label": name, "output": True, "facing": "west"})
        wire(c, [(out_x, y), (out_x + 100, y)])
    rows = []
    for bits in itertools.product([0, 1], repeat=len(inputs)):
        values = dict(zip(inputs, bits))
        rows.append([*bits, *(evaluate(tree, values) for tree in trees.values())])
    vector = " ".join(names) + "\n" + "\n".join(" ".join(map(str, row)) for row in rows) + "\n"
    return root, vector, rows

def find_jar():
    configured = os.environ.get("LOGISIM_JAR")
    if configured:
        return Path(configured)
    candidates = list(Path("C:/Program Files/logisim-evolution/app").glob("*.jar"))
    return candidates[0] if candidates else None

def simulate(project, circuit_name, vectors, timeout=60):
    jar = find_jar()
    if not jar or not jar.is_file():
        raise ValueError("Set LOGISIM_JAR to your Logisim Evolution .jar file")
    if not 1 <= timeout <= 120:
        raise ValueError("Timeout must be 1–120 seconds")
    if len(vectors) > 1_000_000:
        raise ValueError("Test vector exceeds 1 MB")
    with tempfile.TemporaryDirectory(prefix="logisim-mcp-") as tmp:
        vector_file = Path(tmp) / "vectors.txt"
        vector_file.write_text(vectors, encoding="utf-8")
        command = [os.environ.get("LOGISIM_JAVA", "java"), "-jar", str(jar), "--no-splash", "--locale", "en", "--test-vector", circuit_name, str(vector_file), str(project)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, errors="replace")
        except subprocess.TimeoutExpired as exc:
            raise ValueError(f"Logisim simulation exceeded {timeout} seconds") from exc
        output = result.stdout + "\n" + result.stderr
        # Logisim 3.8 may exit zero even when vectors fail. Parse its result summary.
        summary = re.search(r"Passed:\s*(\d+),\s*Failed:\s*(\d+)", output, re.I)
        passed = bool(summary and int(summary[1]) > 0 and int(summary[2]) == 0 and result.returncode == 0)
        return {"passed": passed, "passed_rows": int(summary[1]) if summary else None,
                "failed_rows": int(summary[2]) if summary else None, "exit_code": result.returncode,
                "output": output[-20000:], "jar": str(jar)}
