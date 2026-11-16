"""stdio MCP interface; all circuit files are ordinary native XML."""
import os
from pathlib import Path
from typing import Any
from defusedxml import ElementTree as SafeET

from mcp.server.fastmcp import FastMCP
from .core import CATALOG, LOCK, Store, circuit, new_project, simulate, synthesize, validate

mcp = FastMCP("logisim-evolution", instructions="Create editable native Logisim Evolution .circ files. Start with component_catalog. Use synthesize_logic for combinational Boolean logic, or create_project and edit_project for arbitrary circuits. Inspect before editing and pass expected_sha256. Validate structurally, then run_test_vectors for electrical verification. Never claim an untested circuit is electrically verified. All paths are relative to LOGISIM_WORKSPACE.")
store = Store(os.environ.get("LOGISIM_WORKSPACE", str(Path.cwd() / "circuits")))

@mcp.tool()
def list_projects() -> dict:
    """List .circ projects available inside the configured workspace."""
    return {"workspace": str(store.workspace), "projects": sorted(str(p.relative_to(store.workspace)) for p in store.workspace.rglob("*.circ") if p.resolve().is_relative_to(store.workspace))}

@mcp.tool()
def component_catalog() -> dict:
    """Get native library/component names, edit operation schema and verified gate geometry."""
    return {"libraries": CATALOG, "coordinates": "10-unit grid. Component at = its anchor, NOT its bounding-box corner.",
            "verified_geometry": {"east_facing_size50_two_input_gates": {"AND Gate": {"output": [0, 0], "inputs": [[-50, -20], [-50, 20]]}, "OR Gate": {"output": [0, 0], "inputs": [[-50, -20], [-50, 20]]}, "XOR Gate": {"output": [0, 0], "inputs": [[-60, -20], [-60, 20]]}}, "east_facing_NOT_size30": {"output": [0, 0], "inputs": [[-30, 0]]}, "Pin_and_Tunnel": "connection at component anchor"},
            "attributes": "Use exact Logisim attribute names: facing, width, label, inputs, size; Pin output=true for outputs. Raw attributes for other components require native verification.",
            "operations": [
                {"action": "add_circuit", "name": "alu"},
                {"action": "set_main", "name": "alu"},
                {"action": "add_component", "circuit": "main", "name": "AND Gate", "at": [300, 200], "attributes": {"inputs": 2, "size": 50, "facing": "east"}},
                {"action": "add_wire", "circuit": "main", "points": [[100, 100], [200, 100], [200, 200]]},
                {"action": "set_attributes", "circuit": "main", "at": [300, 200], "attributes": {"label": "result"}},
                {"action": "move_component", "circuit": "main", "at": [300, 200], "to": [400, 200]},
                {"action": "remove_component", "circuit": "main", "at": [400, 200]},
                {"action": "remove_wire", "circuit": "main", "from": [100, 100], "to": [200, 100]}],
            "edit_notes": "Moves/removals do not reroute or remove wires. Include wire changes in the same atomic edit. Existing unknown XML, appearances, ROM contents and library declarations are preserved semantically."}

@mcp.tool()
def create_project(path: str, main_circuit: str = "main", overwrite: bool = False) -> dict:
    """Create a native editable .circ project with built-in libraries. Existing files need overwrite=true."""
    with LOCK:
        return store.write(path, new_project(main_circuit), overwrite)

@mcp.tool()
def inspect_project(path: str) -> dict:
    """Read circuits, components, exact attributes, wires and SHA256 for a native .circ file."""
    with LOCK:
        return store.inspect(path)

@mcp.tool()
def read_project_xml(path: str) -> str:
    """Read native XML, including custom appearance and memory data, for detailed inspection."""
    store.read(path)
    return store.path(path).read_text(encoding="utf-8-sig")

@mcp.tool()
def import_project_xml(path: str, xml: str, overwrite: bool = False) -> dict:
    """Import or save complete native .circ XML after structural validation. Supports advanced components, custom appearances and memory contents. DTD/entities are forbidden. Existing files require overwrite=true and are backed up. External libraries referenced by imported XML must be available to Logisim."""
    if len(xml.encode("utf-8")) > 20_000_000:
        raise ValueError("XML exceeds 20 MB limit")
    root = SafeET.fromstring(xml, forbid_dtd=True)
    with LOCK:
        return store.write(path, root, overwrite)

@mcp.tool()
def create_example(path: str, example: str = "full_adder", overwrite: bool = False, verify: bool = True) -> dict:
    """Create editable example: half_adder, full_adder, mux2, decoder2, or adder4. verify=true exhaustively checks generated output against its Boolean specification in native Logisim."""
    designs = {
        "half_adder": (["A", "B"], {"Sum": "A ^ B", "Carry": "A & B"}),
        "full_adder": (["A", "B", "Cin"], {"Sum": "A ^ B ^ Cin", "Cout": "(A & B) | (Cin & (A ^ B))"}),
        "mux2": (["A", "B", "Sel"], {"Y": "(A & ~Sel) | (B & Sel)"}),
        "decoder2": (["A", "B"], {"Y0": "~A & ~B", "Y1": "~A & B", "Y2": "A & ~B", "Y3": "A & B"}),
    }
    if example == "adder4":
        inputs = [f"A{i}" for i in range(4)] + [f"B{i}" for i in range(4)] + ["Cin"]
        outputs, carry = {}, "Cin"
        for i in range(4):
            outputs[f"S{i}"] = f"A{i} ^ B{i} ^ ({carry})"
            carry = f"(A{i} & B{i}) | ((A{i} ^ B{i}) & ({carry}))"
        outputs["Cout"] = carry
    elif example in designs:
        inputs, outputs = designs[example]
    else:
        raise ValueError("Choose half_adder, full_adder, mux2, decoder2, or adder4")
    return synthesize_logic(path, inputs, outputs, overwrite=overwrite, verify=verify)

@mcp.tool()
def edit_project(path: str, operations: list[dict[str, Any]], expected_sha256: str | None = None) -> dict:
    """Apply an atomic batch of native edits, backing up the previous file. Get operation schemas from component_catalog. Pass inspect_project's SHA256 to prevent stale edits. Component moves require explicit wire edits."""
    if not 1 <= len(operations) <= 5000:
        raise ValueError("Provide 1–5000 operations")
    return store.edit(path, operations, expected_sha256)

@mcp.tool()
def validate_project(path: str) -> dict:
    """Validate XML structure and references; this is NOT an electrical simulation."""
    return validate(store.read(path))

@mcp.tool()
def synthesize_logic(path: str, inputs: list[str], outputs: dict[str, str], circuit_name: str = "main", overwrite: bool = False, verify: bool = True) -> dict:
    """Generate laid-out native gates, pins and labeled tunnels from one-bit Boolean expressions. Supports ~ (NOT), & (AND), | (OR), ^ (XOR), parentheses and 0/1. Example inputs=['A','B'], outputs={'Sum':'A ^ B','Carry':'A & B'}. Up to 12 inputs; verify runs every truth-table row in installed Logisim. Writes .circ before verification and reports simulation separately."""
    with LOCK:
        root, vectors, rows = synthesize(inputs, outputs, circuit_name)
        result = store.write(path, root, overwrite)
        result["truth_table_rows"] = len(rows)
        result["test_vectors"] = vectors
        if verify:
            try:
                result["simulation"] = simulate(store.path(path), circuit_name, vectors)
            except (ValueError, OSError) as exc:
                result["simulation"] = {"passed": False, "error": str(exc)}
        else:
            result["simulation"] = {"status": "not_run"}
        return result

@mcp.tool()
def run_test_vectors(path: str, vectors: str, circuit_name: str = "main", timeout_seconds: int = 60) -> dict:
    """Run native Logisim test vectors. Header is whitespace-separated pin labels (bus example A[4]); subsequent rows contain input and expected output values. Example: 'A B Sum Carry\n0 0 0 0\n0 1 1 0\n1 0 1 0\n1 1 0 1\n'. Requires Java and LOGISIM_JAR. Reports actual passed/failed counts, not just process exit status."""
    with LOCK:
        circuit(store.read(path), circuit_name)
        return simulate(store.path(path), circuit_name, vectors, timeout_seconds)

@mcp.resource("logisim://guide")
def guide() -> str:
    return "Native .circ workflow: component_catalog -> synthesize_logic or create_project/edit_project -> inspect_project -> validate_project -> run_test_vectors. Boolean synthesis produces editable gates and tunnels, not an image. Use ~, &, |, ^ with explicit parentheses. Advanced components use exact native attributes and explicit pin coordinates. Keep files under LOGISIM_WORKSPACE; use relative paths. Close or reload a project in the GUI after external edits. Backups are adjacent .bak files. Structural validity does not prove electrical behavior."

@mcp.prompt()
def design_circuit(requirements: str) -> str:
    """Guide an assistant through creating and checking an editable circuit."""
    return f"Design this Logisim Evolution circuit: {requirements}\nUse the Logisim MCP tools. Discover components first. For combinational one-bit logic use synthesize_logic with verify=true. For other circuits inspect native attributes and batch components/wires. Deliver a .circ path and report actual simulation results and any unverified behavior."

def main():
    mcp.run(transport="stdio")

if __name__ == "__main__":
    main()
