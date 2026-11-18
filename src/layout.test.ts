import assert from "node:assert/strict";
import test from "node:test";
import { LayoutError, describeLayoutComponent, layoutGraph, layoutInternals, listLayoutComponents } from "./layout.js";
import type { LayoutGraphInput } from "./layout.js";

const andGraph: LayoutGraphInput = {
  components: [
    { id: "A", library: "0", name: "Pin", attributes: { label: "A" } },
    { id: "B", library: "0", name: "Pin", attributes: { label: "B" } },
    { id: "gate", library: "1", name: "AND Gate" },
    { id: "Y", library: "0", name: "Pin", attributes: { label: "Y", type: "output", facing: "west" } },
  ],
  connections: [
    { from: { component: "A", port: "port" }, to: { component: "gate", port: "in0" } },
    { from: { component: "B", port: "port" }, to: { component: "gate", port: "in1" } },
    { from: { component: "gate", port: "out" }, to: { component: "Y", port: "port" } },
  ],
};

const ringGraph: LayoutGraphInput = {
  components: [
    { id: "CLK", library: "0", name: "Clock" },
    { id: "RST", library: "0", name: "Pin" },
    ...["FF0", "FF1", "FF2"].map((id) => ({ id, library: "4", name: "D Flip-Flop" })),
    ...["Q0", "Q1", "Q2"].map((id) => ({ id, library: "0", name: "Pin", attributes: { type: "output" } })),
  ],
  connections: [
    ...["FF0", "FF1", "FF2"].map((component) => ({ net: "clock", from: { component: "CLK", port: "out" }, to: { component, port: "clock" } })),
    { net: "reset_init", from: { component: "RST", port: "port" }, to: { component: "FF0", port: "preset" } },
    { net: "reset_init", from: { component: "RST", port: "port" }, to: { component: "FF1", port: "reset" } },
    { net: "reset_init", from: { component: "RST", port: "port" }, to: { component: "FF2", port: "reset" } },
    ...[0, 1, 2].flatMap((index) => {
      const next = (index + 1) % 3;
      return [
        { net: `q${index}`, from: { component: `FF${index}`, port: "q" }, to: { component: `FF${next}`, port: "d" } },
        { net: `q${index}`, from: { component: `FF${index}`, port: "q" }, to: { component: `Q${index}`, port: "port" } },
      ];
    }),
  ],
};

test("rotates verified gate geometry and semantic ports", () => {
  const component = layoutInternals.resolveComponent({ id: "gate", library: "1", name: "AND Gate", attributes: { facing: "south" } });
  assert.deepEqual(component.geometry.bounds, { left: -25, top: -50, right: 25, bottom: 0 });
  assert.deepEqual(component.geometry.ports.find((port) => port.id === "in0")?.offset, { x: -20, y: -50 });
  assert.deepEqual(component.geometry.ports.find((port) => port.id === "in1")?.offset, { x: 20, y: -50 });
  assert.equal(component.geometry.ports.find((port) => port.id === "out")?.escape, "south");

  const west = layoutInternals.resolveComponent({ id: "gate", library: "1", name: "AND Gate", attributes: { facing: "west", negate0: "true" } });
  assert.deepEqual(west.geometry.ports.find((port) => port.id === "in0")?.offset, { x: 60, y: -20 });
  assert.deepEqual(west.geometry.ports.find((port) => port.id === "in1")?.offset, { x: 50, y: 20 });
});

test("accounts for the source-verified XOR and XNOR additional width", () => {
  const xor = layoutInternals.resolveComponent({ id: "xor", library: "1", name: "XOR Gate" });
  const xnor = layoutInternals.resolveComponent({ id: "xnor", library: "1", name: "XNOR Gate" });
  assert.equal(xor.geometry.bounds.left, -60);
  assert.equal(xor.geometry.ports.find((port) => port.id === "in0")?.offset.x, -60);
  assert.equal(xnor.geometry.bounds.left, -70);
  assert.equal(xnor.geometry.ports.find((port) => port.id === "in1")?.offset.x, -70);
});

test("uses Logisim's size and output-negation gate label anchors", () => {
  const labelCenterX = (name: string): number => {
    const resolved = layoutInternals.resolveComponent({ id: "gate", library: "1", name, attributes: { label: "G" } });
    return (resolved.geometry.labelBounds!.left + resolved.geometry.labelBounds!.right) / 2;
  };
  assert.equal(labelCenterX("XOR Gate"), -25);
  assert.equal(labelCenterX("NAND Gate"), -35);
  assert.equal(labelCenterX("XNOR Gate"), -35);
});

test("canonicalizes legacy Output Pins as west-facing sinks", () => {
  const output = layoutInternals.resolveComponent({ id: "Y", library: "0", name: "Pin", attributes: { output: "true" } });
  assert.equal(output.geometry.ports[0]?.role, "sink");
  assert.equal(output.geometry.ports[0]?.escape, "west");
  assert.equal(output.geometry.attributes.type, "output");
  assert.equal(output.geometry.attributes.output, undefined);
  assert.equal(output.geometry.attributes.facing, "west");

  const southClassicBus = layoutInternals.resolveComponent({ id: "bus", library: "0", name: "Pin", attributes: { width: "4", appearance: "classic", facing: "south" } });
  assert.deepEqual(southClassicBus.geometry.bounds, { left: -20, top: -20, right: 20, bottom: 0 });
});

test("describes dynamic sequential component attributes and semantic ports", () => {
  const description = describeLayoutComponent("4", "Register", { width: "4", appearance: "logisim_evolution" });
  assert.equal(description.supported, true);
  assert.deepEqual((description.ports as Array<{ id: string; width: number }>).map((port) => [port.id, port.width]), [
    ["q", 4], ["d", 4], ["clock", 1], ["clear", 1], ["enable", 1],
  ]);
  assert.ok(listLayoutComponents().some((component) => component.library === "0" && component.name === "Clock"));
  assert.ok(listLayoutComponents().some((component) => component.library === "4" && component.name === "Counter"));
  assert.throws(
    () => describeLayoutComponent("4", "D Flip-Flop", { widht: "9" }),
    (error: unknown) => error instanceof LayoutError && error.code === "UNKNOWN_ATTRIBUTE" && /logisim_describe_component/.test(error.message),
  );
  assert.throws(
    () => describeLayoutComponent("1", "AND Gate", { negateN: "true" }),
    (error: unknown) => error instanceof LayoutError && error.code === "UNKNOWN_ATTRIBUTE",
  );
  assert.throws(
    () => describeLayoutComponent("1", "AND Gate", { negate00: "true" }),
    (error: unknown) => error instanceof LayoutError && error.code === "INVALID_ATTRIBUTE",
  );
  assert.throws(
    () => describeLayoutComponent("0", "Pin", { labelloc: "south" }),
    (error: unknown) => error instanceof LayoutError && error.code === "UNKNOWN_ATTRIBUTE",
  );
});

test("describes source-verified LED geometry and strictly validates public attributes", () => {
  const expectedBounds = {
    east: { left: -20, top: -10, right: 0, bottom: 10 },
    south: { left: -10, top: -20, right: 10, bottom: 0 },
    west: { left: 0, top: -10, right: 20, bottom: 10 },
    north: { left: -10, top: 0, right: 10, bottom: 20 },
  };
  for (const [facing, bounds] of Object.entries(expectedBounds)) {
    const description = describeLayoutComponent("5", "LED", { facing });
    assert.deepEqual(description.boundsRelativeToAnchor, bounds);
    assert.deepEqual(description.ports, [{ id: "in", role: "sink", width: 1, required: true, offsetFromAnchor: { x: 0, y: 0 }, escape: facing }]);
  }
  assert.throws(() => describeLayoutComponent("5", "LED", { facing: "diagonal" }), LayoutError);
  assert.throws(() => describeLayoutComponent("5", "LED", { labelloc: "inside" }), LayoutError);
  assert.throws(() => describeLayoutComponent("5", "LED", { color: "red" }), LayoutError);
  assert.throws(() => describeLayoutComponent("5", "LED", { active: "TRUE" }), LayoutError);
  assert.throws(() => describeLayoutComponent("5", "LED", { dummy: "true" }), LayoutError);
  assert.throws(() => describeLayoutComponent("5", "LED", { MAPINFO: "x" }), LayoutError);
  for (const color of ["#00000000", "#ffffffff", "#f00000", "2147483647", "-2147483648", "0x7fffffff", "-0x80000000", "017"]) {
    assert.equal((describeLayoutComponent("5", "LED", { color }) as { supported: boolean }).supported, true, color);
  }
  for (const color of ["2147483648", "-2147483649", "0x80000000", "-0x80000001", "020000000000", "#100000000", "+#ffffffff", "--1", "0x", "08", "#12xz", " #ffffff"]) {
    assert.throws(() => describeLayoutComponent("5", "LED", { color }), LayoutError, color);
  }
});

test("resolves legacy decode-only Splitter ports, mappings, and all facing geometry", () => {
  const attributes = { appear: "legacy", fanout: "3", incoming: "4", spacing: "1", bit0: "0", bit1: "2", bit2: "0", bit3: "1" };
  const expected = {
    east: { bounds: { left: 0, top: -10, right: 20, bottom: 10 }, outputs: [{ x: 20, y: -10 }, { x: 20, y: 0 }, { x: 20, y: 10 }], bus: "west", branch: "east" },
    west: { bounds: { left: -20, top: -10, right: 0, bottom: 10 }, outputs: [{ x: -20, y: -10 }, { x: -20, y: 0 }, { x: -20, y: 10 }], bus: "east", branch: "west" },
    north: { bounds: { left: -10, top: -20, right: 10, bottom: 0 }, outputs: [{ x: 10, y: -20 }, { x: 0, y: -20 }, { x: -10, y: -20 }], bus: "south", branch: "north" },
    south: { bounds: { left: -10, top: 0, right: 10, bottom: 20 }, outputs: [{ x: 10, y: 20 }, { x: 0, y: 20 }, { x: -10, y: 20 }], bus: "north", branch: "south" },
  };
  for (const [facing, expectation] of Object.entries(expected)) {
    const splitter = layoutInternals.resolveComponent({ id: "split", library: "0", name: "Splitter", attributes: { ...attributes, facing } });
    assert.deepEqual(splitter.geometry.bounds, expectation.bounds);
    assert.deepEqual(splitter.geometry.ports[0], { id: "bus", offset: { x: 0, y: 0 }, escape: expectation.bus, role: "sink", width: 4, required: true });
    assert.deepEqual(splitter.geometry.ports.slice(1).map((port) => ({ offset: port.offset, escape: port.escape, width: port.width })), expectation.outputs.map((offset, index) => ({ offset, escape: expectation.branch, width: [2, 1, 1][index] })));
  }
  const wide = layoutInternals.resolveComponent({ id: "wide", library: "0", name: "Splitter", attributes: { appear: "legacy", fanout: "8", incoming: "8", spacing: "9", bit0: "0", bit1: "1", bit2: "2", bit3: "3", bit4: "4", bit5: "5", bit6: "6", bit7: "7" } });
  assert.deepEqual(wide.geometry.bounds, { left: 0, top: -360, right: 20, bottom: 270 });
  const twoWay = layoutInternals.resolveComponent({ id: "two", library: "0", name: "Splitter", attributes: { appear: "legacy", fanout: "2", incoming: "4", bit0: "0", bit1: "0", bit2: "1", bit3: "1" } });
  assert.deepEqual(twoWay.geometry.bounds, { left: 0, top: -10, right: 20, bottom: 0 });
  assert.deepEqual(twoWay.geometry.ports.slice(1).map((port) => port.width), [2, 2]);
  const invalidAttributes: Record<string, string>[] = [{ appear: "left" }, { appear: "legacy", fanout: "1" }, { appear: "legacy", fanout: "9" }, { appear: "legacy", incoming: "65" }, { appear: "legacy", spacing: "0" }, { appear: "legacy", bit0: "0", bit1: "none" }, { appear: "legacy", bit0: "0", bit1: "2" }, { appear: "legacy", bit0: "0", bit1: "0" }, { appear: "legacy", bit0: "0", bit1: "1", bit2: "0" }];
  for (const attributes of invalidAttributes) {
    assert.throws(() => describeLayoutComponent("0", "Splitter", attributes), LayoutError);
  }
});

test("produces a deterministic feasible orthogonal layout", () => {
  const first = layoutGraph(andGraph);
  const second = layoutGraph({
    components: [...andGraph.components].reverse(),
    connections: [...andGraph.connections].reverse(),
  });
  assert.deepEqual(first, second);
  assert.equal(first.objective.crossings, 0);
  assert.equal(first.objective.overlap, 0);
  assert.equal(first.objective.alignment, 0);
  assert.ok(first.wires.every((wire) => wire.from.x === wire.to.x || wire.from.y === wire.to.y));
  assert.equal(first.objective.length, first.wires.reduce((sum, wire) => sum + Math.abs(wire.to.x - wire.from.x) + Math.abs(wire.to.y - wire.from.y), 0));
  assert.equal(first.certificate.netsConnected, 3);
  assert.equal(first.certificate.netsAcyclic, 3);
  assert.ok(first.certificate.minimumComponentGap! >= first.certificate.componentClearance);
  assert.ok(first.certificate.minimumWireComponentGap! >= first.certificate.wireClearance);
  assert.ok(first.certificate.minimumWireSpacing! >= first.certificate.wireSpacing);
});

test("includes labels in visible footprints and certifies their clearances", () => {
  const plan = layoutGraph({
    components: [
      { id: "A", library: "0", name: "Pin", attributes: { label: "LONG_INPUT_LABEL_ALPHA" } },
      { id: "B", library: "0", name: "Pin", attributes: { label: "LONG_INPUT_LABEL_BETA" } },
      { id: "gate", library: "1", name: "AND Gate" },
      { id: "Y", library: "0", name: "Pin", attributes: { label: "LONG_OUTPUT_LABEL", type: "output", facing: "west" } },
    ],
    connections: andGraph.connections,
  });
  assert.ok(plan.components.filter((component) => component.id !== "gate").every((component) => component.labelBounds));
  assert.ok(plan.components.every((component) => component.footprint.left <= component.bounds.left && component.footprint.right >= component.bounds.right));
  assert.ok(plan.certificate.minimumComponentGap! >= plan.certificate.componentClearance);
  assert.ok(plan.certificate.minimumWireComponentGap! >= plan.certificate.wireClearance);
  const input = plan.components.find((component) => component.id === "A")!;
  const output = plan.components.find((component) => component.id === "Y")!;
  assert.ok(input.labelBounds!.right <= input.bounds.left);
  assert.ok(output.labelBounds!.left >= output.bounds.right);
  assert.equal(input.attributes.labelloc, undefined);
});

test("rejects a Clock label that occupies its required wire escape", () => {
  assert.throws(
    () => layoutGraph({
      components: [
        { id: "clock", library: "0", name: "Clock", attributes: { label: "CLOCK", labelloc: "east" } },
        { id: "Y", library: "0", name: "Pin", attributes: { type: "output", facing: "west" } },
      ],
      connections: [{ from: { component: "clock", port: "out" }, to: { component: "Y", port: "port" } }],
      options: { wireClearance: 0 },
    }),
    (error: unknown) => error instanceof LayoutError && error.code === "NO_FEASIBLE_LAYOUT" && /visible footprint/.test(error.message),
  );
});

test("raises placement gaps to satisfy clearance and enforces wider wire spacing", () => {
  const clearancePlan = layoutGraph({
    ...andGraph,
    options: { componentClearance: 100, rowSpacing: 10, layerSpacing: 10 },
  });
  assert.ok(clearancePlan.certificate.minimumComponentGap! >= 100);

  const spacingPlan = layoutGraph({ ...andGraph, options: { wireSpacing: 20 } });
  assert.equal(spacingPlan.certificate.wireSpacing, 20);
  assert.ok(spacingPlan.certificate.minimumWireSpacing! >= 20);
});

test("orders Adder terminals by semantic port position and routes without crossings", () => {
  const plan = layoutGraph({
    components: [
      { id: "A", library: "0", name: "Pin", attributes: { label: "A", width: "2" } },
      { id: "B", library: "0", name: "Pin", attributes: { label: "B", width: "2" } },
      { id: "Cin", library: "0", name: "Pin", attributes: { label: "Cin" } },
      { id: "add", library: "3", name: "Adder", attributes: { width: "2" } },
      { id: "Sum", library: "0", name: "Pin", attributes: { label: "Sum", width: "2", type: "output", facing: "west" } },
      { id: "Cout", library: "0", name: "Pin", attributes: { label: "Cout", type: "output", facing: "west" } },
    ],
    connections: [
      { from: { component: "A", port: "port" }, to: { component: "add", port: "a" } },
      { from: { component: "B", port: "port" }, to: { component: "add", port: "b" } },
      { from: { component: "Cin", port: "port" }, to: { component: "add", port: "cin" } },
      { from: { component: "add", port: "sum" }, to: { component: "Sum", port: "port" } },
      { from: { component: "add", port: "cout" }, to: { component: "Cout", port: "port" } },
    ],
  });
  const positions = new Map(plan.components.map((component) => [component.id, component.anchor]));
  assert.ok(positions.get("Cin")!.y < positions.get("A")!.y);
  assert.ok(positions.get("A")!.y < positions.get("B")!.y);
  assert.ok(positions.get("Sum")!.y < positions.get("Cout")!.y);
  assert.equal(plan.objective.crossings, 0);
  assert.equal(plan.objective.overlap, 0);
});

test("lays out a connected sequential chain with shared clock fanout", () => {
  const plan = layoutGraph({
    components: [
      { id: "D", library: "0", name: "Pin" },
      { id: "clock", library: "0", name: "Clock" },
      { id: "ff", library: "4", name: "D Flip-Flop" },
      { id: "register", library: "4", name: "Register", attributes: { width: "1" } },
      { id: "counter", library: "4", name: "Counter", attributes: { width: "1" } },
      { id: "Q", library: "0", name: "Pin", attributes: { output: "true" } },
    ],
    connections: [
      { from: { component: "D", port: "port" }, to: { component: "ff", port: "d" } },
      { net: "clock", from: { component: "clock", port: "out" }, to: { component: "ff", port: "clock" } },
      { net: "clock", from: { component: "clock", port: "out" }, to: { component: "register", port: "clock" } },
      { net: "clock", from: { component: "clock", port: "out" }, to: { component: "counter", port: "clock" } },
      { from: { component: "ff", port: "q" }, to: { component: "register", port: "d" } },
      { from: { component: "register", port: "q" }, to: { component: "counter", port: "data" } },
      { from: { component: "counter", port: "q" }, to: { component: "Q", port: "port" } },
    ],
  });
  assert.equal(plan.objective.crossings, 0);
  assert.equal(plan.objective.overlap, 0);
  assert.equal(plan.components.find((component) => component.id === "Q")?.ports[0]?.role, "sink");
});

test("routes a canonical three-DFF one-hot ring through a certified exterior feedback channel", () => {
  const first = layoutGraph(ringGraph);
  const second = layoutGraph({ components: [...ringGraph.components].reverse(), connections: [...ringGraph.connections].reverse() });
  assert.deepEqual(first, second);
  assert.equal(first.objective.crossings, 0);
  assert.equal(first.objective.overlap, 0);
  assert.equal(first.certificate.netsConnected, 5);
  assert.equal(first.certificate.netsAcyclic, 5);
  assert.ok(first.certificate.minimumComponentGap! >= first.certificate.componentClearance);
  assert.ok(first.certificate.minimumWireComponentGap! >= first.certificate.wireClearance);
  assert.ok(first.certificate.minimumWireSpacing! >= first.certificate.wireSpacing);
  assert.ok(first.components.every((component) => component.footprint.left >= first.region.left + first.certificate.componentClearance
    && component.footprint.right <= first.region.right - first.certificate.componentClearance
    && component.footprint.top >= first.region.top + first.certificate.componentClearance
    && component.footprint.bottom <= first.region.bottom - first.certificate.componentClearance));
  const coarseCompatible = layoutGraph({ ...ringGraph, region: { left: 20, top: 20, right: 1400, bottom: 1100 }, options: { grid: 5, maxAStarStates: 1_000_000 } });
  assert.equal(coarseCompatible.grid, 5);
  assert.equal(coarseCompatible.certificate.netsConnected, 5);
  assert.throws(
    () => layoutGraph({ ...ringGraph, region: { left: 20, top: 20, right: 600, bottom: 600 } }),
    (error: unknown) => error instanceof LayoutError && error.code === "NO_FEASIBLE_LAYOUT",
  );
});

test("builds a shared fanout net as one crossing-free tree", () => {
  const plan = layoutGraph({
    components: [
      { id: "source", library: "0", name: "Pin" },
      { id: "left", library: "0", name: "Pin", attributes: { type: "output", facing: "west" } },
      { id: "right", library: "0", name: "Pin", attributes: { type: "output", facing: "west" } },
    ],
    connections: [
      { net: "fanout", from: { component: "source", port: "port" }, to: { component: "left", port: "port" } },
      { net: "fanout", from: { component: "source", port: "port" }, to: { component: "right", port: "port" } },
    ],
  });
  assert.ok(plan.wires.length > 0);
  assert.ok(plan.wires.every((wire) => wire.net === "fanout"));
  assert.equal(plan.objective.crossings, 0);
});

test("normalizes high-fanout routing to one connected acyclic tree", () => {
  const components: LayoutGraphInput["components"] = [{ id: "source", library: "0", name: "Pin" }];
  const connections: LayoutGraphInput["connections"] = [];
  for (let index = 0; index < 8; index += 1) {
    const id = `sink${index}`;
    components.push({ id, library: "0", name: "Pin", attributes: { type: "output", facing: "west" } });
    connections.push({ net: "fanout", from: { component: "source", port: "port" }, to: { component: id, port: "port" } });
  }
  const plan = layoutGraph({ components, connections, region: { left: 20, top: 20, right: 2400, bottom: 1800 } });
  const vertices = new Set<string>();
  const edges = new Set<string>();
  for (const wire of plan.wires) {
    const dx = Math.sign(wire.to.x - wire.from.x) * plan.grid;
    const dy = Math.sign(wire.to.y - wire.from.y) * plan.grid;
    let current = { ...wire.from };
    while (current.x !== wire.to.x || current.y !== wire.to.y) {
      const next = { x: current.x + dx, y: current.y + dy };
      const endpoints = [`${current.x},${current.y}`, `${next.x},${next.y}`].sort();
      vertices.add(endpoints[0]!);
      vertices.add(endpoints[1]!);
      edges.add(endpoints.join("|"));
      current = next;
    }
  }
  assert.equal(edges.size, vertices.size - 1);
  assert.equal(plan.certificate.netsConnected, 1);
  assert.equal(plan.certificate.netsAcyclic, 1);
});

test("routes every source-verified catalog component through the same certificate", () => {
  for (const entry of listLayoutComponents()) {
    const targetAttributes = entry.library === "0" && entry.name === "Splitter"
      ? { appear: "legacy", bit0: "0", bit1: "1" } : undefined;
    const target = layoutInternals.resolveComponent({ id: "target", library: entry.library, name: entry.name, attributes: targetAttributes });
    const components: LayoutGraphInput["components"] = [{ id: "target", library: entry.library, name: entry.name, attributes: targetAttributes }];
    const connections: LayoutGraphInput["connections"] = [];
    for (const port of target.geometry.ports.filter((candidate) => candidate.required)) {
      const id = `pin_${port.id}`;
      const attributes = {
        ...(port.width === 1 ? {} : { width: String(port.width) }),
        ...(port.role === "driver" ? { type: "output", facing: "west" } : {}),
      };
      components.push({ id, library: "0", name: "Pin", attributes });
      connections.push(port.role === "driver"
        ? { from: { component: "target", port: port.id }, to: { component: id, port: "port" } }
        : { from: { component: id, port: "port" }, to: { component: "target", port: port.id } });
    }
    const plan = layoutGraph({ components, connections, region: { left: 20, top: 20, right: 3000, bottom: 2500 } });
    assert.equal(plan.certificate.netsConnected, connections.length, `${entry.library}:${entry.name}`);
    assert.equal(plan.certificate.netsAcyclic, connections.length, `${entry.library}:${entry.name}`);
    assert.ok(plan.certificate.minimumComponentGap! >= plan.certificate.componentClearance, `${entry.library}:${entry.name}`);
  }
});

test("grows the implicit region for large supported component variants", () => {
  const plan = layoutGraph({
    components: [
      { id: "clock", library: "0", name: "Clock" },
      { id: "counter", library: "4", name: "Counter", attributes: { width: "64", appearance: "evolution" } },
      { id: "Q", library: "0", name: "Pin", attributes: { width: "64", type: "output", facing: "west" } },
    ],
    connections: [
      { from: { component: "clock", port: "out" }, to: { component: "counter", port: "clock" } },
      { from: { component: "counter", port: "q" }, to: { component: "Q", port: "port" } },
    ],
  });
  assert.ok(plan.region.bottom > 1200);
  assert.equal(plan.certificate.netsConnected, 2);
});

test("certifies a coarse-grid feedback edge without routing through a component", () => {
  const plan = layoutGraph({
      components: [
        { id: "g1", library: "1", name: "NOT Gate" },
        { id: "g2", library: "1", name: "NOT Gate" },
      ],
      connections: [
        { from: { component: "g1", port: "out" }, to: { component: "g2", port: "in" } },
        { from: { component: "g2", port: "out" }, to: { component: "g1", port: "in" } },
      ],
      options: { grid: 30, componentClearance: 30, wireClearance: 30, layerSpacing: 30, rowSpacing: 30 },
    });
  assert.equal(plan.objective.crossings, 0);
  assert.ok(plan.certificate.minimumWireComponentGap! >= plan.certificate.wireClearance);
  assert.equal(
    layoutInternals.segmentIntersectsRectInterior(
      { x: 30, y: 60 },
      { x: 120, y: 60 },
      { left: 60, top: 51, right: 90, bottom: 69 },
    ),
    true,
  );
});

test("classifies and certifies a singleton feedback SCC", () => {
  const graph: LayoutGraphInput = {
    components: [
      { id: "loop", library: "1", name: "NOT Gate" },
      { id: "tap", library: "0", name: "Pin", attributes: { type: "output" } },
    ],
    connections: [
      { net: "loop", from: { component: "loop", port: "out" }, to: { component: "loop", port: "in" } },
      { net: "loop", from: { component: "loop", port: "out" }, to: { component: "tap", port: "port" } },
    ],
  };
  const plan = layoutGraph(graph);
  assert.deepEqual(plan, layoutGraph({ components: [...graph.components].reverse(), connections: [...graph.connections].reverse() }));
  assert.equal(plan.certificate.netsConnected, 1);
  assert.equal(plan.certificate.netsAcyclic, 1);
  assert.equal(plan.objective.crossings, 0);
});

test("accepts fractional objective weights and enforces bounded unique candidates", () => {
  const plan = layoutGraph({
    ...andGraph,
    options: { weights: { length: 0.125 } },
  });
  assert.ok(Number.isFinite(plan.objective.score));
  assert.equal(plan.candidatesEvaluated, 2);
  assert.equal(plan.routingAttempts, 4);
  assert.throws(
    () => layoutGraph({ ...andGraph, options: { maxCandidates: 13 } }),
    (error: unknown) => error instanceof LayoutError && error.code === "INVALID_OPTIONS",
  );
});

test("rejects missing ports, width mismatches, and disconnected graphs", () => {
  assert.throws(
    () => layoutGraph({
      components: andGraph.components,
      connections: andGraph.connections.slice(0, 2),
    }),
    (error: unknown) => error instanceof LayoutError && error.code === "INVALID_GRAPH" && /Required port/.test(error.message),
  );
  assert.throws(
    () => layoutGraph({
      components: [
        { id: "A", library: "0", name: "Pin", attributes: { width: "2" } },
        { id: "Y", library: "0", name: "Pin", attributes: { type: "output", facing: "west" } },
      ],
      connections: [{ from: { component: "A", port: "port" }, to: { component: "Y", port: "port" } }],
    }),
    (error: unknown) => error instanceof LayoutError && /Width mismatch/.test(error.message),
  );
  assert.throws(
    () => layoutGraph({
      components: [...andGraph.components, { id: "unused", library: "0", name: "Pin" }],
      connections: andGraph.connections,
    }),
    (error: unknown) => error instanceof LayoutError && error.code === "INVALID_GRAPH",
  );
  assert.throws(
    () => layoutGraph({
      components: [
        { id: "source", library: "0", name: "Pin" },
        { id: "split", library: "0", name: "Splitter", attributes: { appear: "legacy", bit0: "0", bit1: "1" } },
        { id: "bus", library: "0", name: "Pin", attributes: { width: "2", type: "output", facing: "west" } },
      ],
      connections: [
        { from: { component: "source", port: "port" }, to: { component: "split", port: "out0" } },
        { from: { component: "split", port: "bus" }, to: { component: "bus", port: "port" } },
      ],
    }),
    (error: unknown) => error instanceof LayoutError && error.code === "INVALID_GRAPH" && /not a sink/.test(error.message),
  );
});

test("rejects unsupported component geometry instead of guessing", () => {
  assert.throws(
    () => layoutGraph({
      components: [
        { id: "clock", library: "0", name: "Power-On Reset" },
        { id: "Y", library: "0", name: "Pin", attributes: { type: "output", facing: "west" } },
      ],
      connections: [{ from: { component: "clock", port: "out" }, to: { component: "Y", port: "port" } }],
    }),
    (error: unknown) => error instanceof LayoutError && error.code === "UNSUPPORTED_COMPONENT",
  );
});
