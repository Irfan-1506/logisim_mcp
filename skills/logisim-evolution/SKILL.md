---
name: logisim-evolution
description: Use this skill whenever a user asks to create, inspect, edit, wire, validate, simulate, test, convert, save, or open a Logisim or Logisim-evolution .circ project. It guides agents to use the logisim_* MCP tools safely and to verify circuit behavior before launching the GUI.
compatibility: Requires the logisim MCP server and Logisim-evolution 4.0.0 or a compatible release.
---

# Logisim-evolution MCP

Use the `logisim_*` MCP tools for saved Logisim-evolution projects. Do not
claim an operation used MCP if the tools were unavailable. If a newly installed
server is not visible, ask the user to restart OpenCode instead of importing
the server's internal JavaScript classes or editing `.circ` XML directly.

## Standard Workflow

1. Call `logisim_get_status` before the first operation. Confirm the executable,
   workspace root, version, and write-validation setting.
2. Resolve the project path with `logisim_list_projects` when the user did not
   give an exact path. Keep every path inside the configured workspace.
3. When a working source circuit already exists, prefer
   `logisim_copy_circuit` over rebuilding it component by component.
4. Call `logisim_inspect_project` before changing an existing project. Its
   component and wire indexes are the only reliable indexes for update/remove
   calls.
5. Call `logisim_describe_component` before using unfamiliar attributes or
   semantic ports. Do not guess names, direction, width, or geometry.
6. For a new project, call `logisim_create_project` with `overwrite: false`.
   Only overwrite an existing file when the user explicitly requests it.
7. For an empty circuit made from supported components, prefer
   `logisim_layout_graph`. Supply semantic components and directed connections;
   let the engine place and route the whole graph atomically.
8. When coordinates are already known, use `logisim_apply_batch` for component
   and wire arrays. Do not issue dozens of individual add calls or write raw XML.
9. Use individual component and wire tools only for a genuinely small edit.
10. Inspect the finished circuit, then call `logisim_validate_project`.
11. Verify combinational behavior with `logisim_truth_table` or an exhaustive
   `logisim_test_vector`. Treat nonzero failed-vector counts as a failed test
   even if Logisim exits with status 0.
12. Call `logisim_launch_gui` only after validation and requested simulation
   pass. Report the saved project path and test result to the user.

## Tool Selection

| Intent | Tool |
| --- | --- |
| Check installation or running GUI processes | `logisim_get_status` |
| List or describe verified components and ports | `logisim_describe_component` |
| Find projects | `logisim_list_projects` |
| Read circuits, components, wires, and indexes | `logisim_inspect_project` |
| Create a project | `logisim_create_project` |
| Clone an existing circuit into a new project | `logisim_copy_circuit` |
| Add or select circuits | `logisim_add_circuit`, `logisim_set_main_circuit` |
| Place or modify components | `logisim_add_component`, `logisim_update_component` |
| Remove a component | `logisim_remove_component` |
| Add or remove wire segments | `logisim_add_wire`, `logisim_remove_wire` |
| Add or replace arrays in one transaction | `logisim_apply_batch` |
| Place and route a complete new graph atomically | `logisim_layout_graph` |
| Check that Logisim can load the file | `logisim_validate_project` |
| Enumerate small combinational circuits | `logisim_truth_table` |
| Assert labeled input/output cases | `logisim_test_vector` |
| Run Logisim's test-bench convention | `logisim_test_bench` |
| Open the saved project | `logisim_launch_gui` |
| Upgrade an older project format | `logisim_convert_project` |

## Project and Component Rules

- Use exact Logisim component names and library numbers. Common built-in
  libraries are `0` Wiring, `1` Gates, `2` Plexers, `3` Arithmetic, `4`
  Memory, and `5` Input/Output.
- Place subcircuit components by omitting `library` and using the exact circuit
  name as the component name.
- Use a 10-unit grid unless an existing project clearly uses another layout.
- Give every external input and output Pin a unique `label`. Test vectors match
  labels, not visual position.
- A normal input Pin uses library `0`, name `Pin`, and its location is the wire
  connection point. Useful attributes include `label`, `width`, and
  `appearance: "NewPins"`.
- A normal output Pin also uses library `0` and name `Pin`, with attribute
  `type: "output"`; automatic layout defaults it to `facing: "west"`. Legacy
  `output: "true"` is accepted and canonicalized.
- Widths are strings in component attributes, for example `width: "2"`.
- Do not invent attributes or connection coordinates for uncommon components.
  Inspect a known working instance or consult the installed Logisim source.

## Known Port Geometry

For the default east-facing components below, `(x, y)` is the component anchor:

- Two-input AND/OR gate: output `(x, y)`; inputs `(x-50, y-20)` and
  `(x-50, y+20)`. NAND/NOR/XOR inputs use `x-60`; XNOR inputs use `x-70`.
- Arithmetic Adder: result `(x, y)`; A `(x-40, y-10)`; B `(x-40, y+10)`;
  carry-in `(x-20, y-20)`; carry-out `(x-20, y+20)`.

Shared coordinates form electrical connections. Crossing lines are not assumed
to connect unless they share an explicit endpoint. Split every bend into two
wire calls because `logisim_add_wire` rejects diagonal segments.

## Automatic Layout

Use `logisim_layout_graph` only on an empty circuit. The operation refuses a
non-empty target so it cannot silently replace an existing design. It performs
one locked transaction and creates one backup; no partial layout is saved when
placement, routing, connectivity validation, or Logisim validation fails.

Supported semantic ports:

| Component | Ports |
| --- | --- |
| Wiring `Pin` | `port` |
| AND/OR/XOR/NAND/NOR/XNOR Gate | `in0` through `inN`, `out` |
| `NOT Gate`, `Buffer` | `in`, `out` |
| Arithmetic `Adder` | `a`, `b`, `sum`, `cin`, `cout` |
| Wiring `Clock` | `out` |
| Memory `D Flip-Flop` | `d`, `clock`, `q`, `notq`, `reset`, `preset` |
| Memory `Register` | `d`, `clock`, `q`, `clear`, `enable` |
| Memory `Counter` | `data`, `clock`, `q`, `clear`, `load`, `updown`, `enable`, `carry` |
| I/O `LED` | `in` (one-bit sink) |
| Wiring `Splitter` | decode-only `bus` sink; `out0` through `outN` drivers |

Connections are directed from a driver to a sink. An input Pin is a circuit
driver; a Pin with `type: "output"` is a sink. Reusing the same driver port
automatically creates one fanout net. Set the same explicit `net` id on related
connections when clarity is useful.

`LED` supports its verified public facing, color, active, and label attributes;
hidden dummy/MAPINFO attributes are not accepted. `Splitter` automatic layout
accepts only `appear: "legacy"`, fanout 2--8, incoming 1--64, spacing 1--9,
and explicit `bit0` through `bit(incoming-1)` branch assignments. No assignment
may be `none`, and every branch must have at least one bit. This is a
decode-only projection: connect an upstream driver to `bus` and each `outN` to
downstream sinks; reverse-combine use and nonlegacy appearances are rejected.

Example legacy four-way decode attributes:

```json
{"appear":"legacy","fanout":"4","incoming":"4","bit0":"0","bit1":"1","bit2":"2","bit3":"3"}
```

The engine rejects:

- unknown component geometry or semantic ports;
- width mismatches and sink-to-sink or driver-to-driver edges;
- nets without exactly one driver;
- dangling required ports or disconnected component graphs;
- component overlap, off-grid ports, diagonal wires, crossings, and routes
  through component clearance areas;
- label/component or label/wire collisions and different-net wire-spacing
  violations;
- unbounded or exhausted searches.

Visible footprints include conservative label bounds. Placement raises row and
layer gaps to satisfy `component_clearance`; routing supports hard
`wire_spacing` between different nets. Each returned plan includes a
`certificate` that independently rechecks measured component, component-wire,
and wire-wire clearances, region/grid containment, directional port escapes,
and connected acyclic net trees. Omit `region` to allow deterministic growth
for large verified components; supply it only when the drawing must stay within
fixed bounds.

Pin labels are fixed by Logisim opposite their Pin facing and are modeled there.
For labeled Clocks, omit `labelloc` to let layout use `north` instead of the
west default. Explicit label locations can make a graph infeasible when they
occupy a required wire escape.

It minimizes a weighted objective over Manhattan length, bends, component
distance error, grid alignment, and regional congestion after all hard
constraints pass. The result is the best deterministic candidate examined,
not a claim of global mathematical optimality. Crossing-free routing is
impossible for arbitrary non-planar graphs, so infeasible graphs fail without
writing partial XML.

Minimal AND example:

```json
{
  "components": [
    {"id":"A","library":"0","name":"Pin","attributes":{"label":"A"}},
    {"id":"B","library":"0","name":"Pin","attributes":{"label":"B"}},
    {"id":"G","library":"1","name":"AND Gate"},
    {"id":"Y","library":"0","name":"Pin","attributes":{"label":"Y","type":"output","facing":"west"}}
  ],
  "connections": [
    {"from":{"component":"A","port":"port"},"to":{"component":"G","port":"in0"}},
    {"from":{"component":"B","port":"port"},"to":{"component":"G","port":"in1"}},
    {"from":{"component":"G","port":"out"},"to":{"component":"Y","port":"port"}}
  ]
}
```

Keep default search options unless a concrete layout fails. If tuning is
necessary, adjust the finite region or spacing before raising search limits.

## Bulk and Copy

`logisim_copy_circuit` is the first choice for rebuilding or branching a known
design. It copies the selected circuit and every referenced subcircuit into a
new validated project, preserving libraries and project settings. Do not
reconstruct a large existing design through individual component calls.

`logisim_apply_batch` accepts `components` and `wires` arrays in one atomic
operation. Use optional component `id` values to receive a stable id-to-index
result. Use `replace: false` to append. Set `replace: true` only when the user
intends to clear all existing components, wires, and custom appearance data in
the target circuit.

If Logisim repairs or normalizes a batch, the error reports the affected
component attributes and added/removed wire endpoints. Follow its suggestion to
call `logisim_describe_component`; do not bypass validation by editing `.circ`
XML directly.

Projects containing external `jar#` or `file#` libraries or `filePath`
resources are intentionally rejected before Logisim execution. Do not weaken
this sandbox to make an external plug-in load; ask the user to replace it with
built-in or copied circuit content.

## Test Vectors

Create test vectors as workspace-relative text files. The first non-comment
line names Pin labels. Add `[width]` for buses:

```text
A[2] B[2] Cin Sum[2] Cout
00 00 0 00 0
01 10 1 00 1
11 11 1 11 1
```

For a combinational circuit with a manageable number of input bits, test every
input combination. Compute expected outputs independently from the circuit
being tested. Use `logisim_test_vector` with the exact circuit name and vector
path, and require `failed: 0`.

Truth tables grow exponentially. Prefer targeted vectors when a circuit has
many input bits or state. Use `logisim_test_bench` only for projects following
Logisim's `logisim_test_verif` test-bench signal convention.

## Safe Editing

- The server creates backups and validates writes by default; do not bypass
  those safeguards for convenience.
- Re-inspect after any removal because component and wire indexes can change.
- Removing a component does not remove its wires. Inspect and remove dangling
  wire segments explicitly.
- Avoid parallel mutations of one circuit even though the server serializes
  writes. Sequential edits make indexes and failure recovery easier to reason
  about.
- Do not modify a project that is only open with unsaved GUI changes. MCP edits
  target the saved file, not the editor's in-memory state.

## GUI Limitation

`logisim_launch_gui` starts Logisim with an optional project and top-level
circuit. It preflights the project and opens the validated file descriptor, so
a pathname replacement cannot redirect the launch. It cannot click, select,
poke, or mutate an already-running canvas. After external MCP edits, reopen the
file in Logisim to see the saved state.

## Completion Report

State:

- the absolute saved `.circ` path;
- the circuit name and external input/output interface;
- validation status;
- truth-table or test-vector totals;
- whether the GUI was launched;
- any unverified behavior or unsupported live-GUI request.
