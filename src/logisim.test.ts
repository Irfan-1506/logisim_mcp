import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";
import { LogisimService } from "./logisim.js";

const execFileAsync = promisify(execFile);

test("creates, edits, validates, inspects, and simulates an AND circuit", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-test-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("and.circ", "main");

  await service.addComponent("and.circ", "main", { library: "0", name: "Pin", x: 100, y: 90, attributes: { label: "A", appearance: "NewPins" } });
  await service.addComponent("and.circ", "main", { library: "0", name: "Pin", x: 100, y: 130, attributes: { label: "B", appearance: "NewPins" } });
  await service.addComponent("and.circ", "main", { library: "1", name: "AND Gate", x: 200, y: 110 });
  await service.addComponent("and.circ", "main", { library: "0", name: "Pin", x: 250, y: 110, attributes: { label: "Y", facing: "west", type: "output", appearance: "NewPins" } });
  await service.addWire("and.circ", "main", 100, 90, 150, 90);
  await service.addWire("and.circ", "main", 100, 130, 150, 130);
  await service.addWire("and.circ", "main", 200, 110, 250, 110);

  const inspection = await service.inspectProject("and.circ", "main");
  assert.equal(inspection.totalItems, 7);
  assert.equal((inspection.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 4);

  const validation = await service.validateProject("and.circ");
  assert.equal(validation.valid, true);

  const table = await service.truthTable("and.circ", "main");
  assert.equal(table.exitCode, 0);
  assert.match(table.stdout, /A\s+B\s+Y/);
  assert.match(table.stdout, /1\s+1\s+1/);

  const vectorPath = join(workspace, "and.txt");
  await writeFile(vectorPath, "A B Y\n0 0 0\n0 1 0\n1 0 0\n1 1 1\n", "utf8");
  const vector = await service.testVector("and.circ", "main", "and.txt");
  assert.equal(vector.failed, 0);
  assert.equal(vector.passed, 4);
  assert.equal(vector.success, true);

  const projectXml = await readFile(join(workspace, "and.circ"), "utf8");
  assert.match(projectXml, /name="AND Gate"/);
});

test("atomically lays out and exhaustively simulates a two-bit Adder graph", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-layout-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("adder.circ", "TwoBitAdder");
  const result = await service.layoutGraph("adder.circ", "TwoBitAdder", {
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
  assert.equal(result.layout.objective.crossings, 0);
  assert.equal(result.layout.objective.overlap, 0);
  assert.equal(result.layout.objective.alignment, 0);
  assert.equal(result.layout.certificate.netsConnected, 5);
  assert.equal(result.layout.certificate.netsAcyclic, 5);
  const inputLabel = result.layout.components.find((component) => component.id === "A")!;
  const outputLabel = result.layout.components.find((component) => component.id === "Sum")!;
  assert.ok(inputLabel.labelBounds!.right <= inputLabel.bounds.left);
  assert.ok(outputLabel.labelBounds!.left >= outputLabel.bounds.right);
  assert.equal(result.validation?.exitCode, 0);
  assert.deepEqual(Object.keys(result.componentIndexes).sort(), ["A", "B", "Cin", "Cout", "Sum", "add"]);

  const rows = ["A[2] B[2] Cin Sum[2] Cout"];
  for (let a = 0; a < 4; a += 1) {
    for (let b = 0; b < 4; b += 1) {
      for (let carry = 0; carry < 2; carry += 1) {
        const total = a + b + carry;
        rows.push(`${a.toString(2).padStart(2, "0")} ${b.toString(2).padStart(2, "0")} ${carry} ${(total & 3).toString(2).padStart(2, "0")} ${total >> 2}`);
      }
    }
  }
  await writeFile(join(workspace, "adder.txt"), `${rows.join("\n")}\n`, "utf8");
  const vector = await service.testVector("adder.circ", "TwoBitAdder", "adder.txt");
  assert.equal(vector.passed, 32);
  assert.equal(vector.failed, 0);
});

test("lays out, round-trips, and decodes a four-bit legacy Splitter into LEDs", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-splitter-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("splitter.circ", "SplitterToLeds");
  const result = await service.layoutGraph("splitter.circ", "SplitterToLeds", {
    components: [
      { id: "A", library: "0", name: "Pin", attributes: { label: "A", width: "4" } },
      { id: "split", library: "0", name: "Splitter", attributes: { appear: "legacy", fanout: "4", incoming: "4", bit0: "0", bit1: "1", bit2: "2", bit3: "3" } },
      ...Array.from({ length: 4 }, (_, index) => ({ id: `led${index}`, library: "5", name: "LED", attributes: { label: `LED${index}` } })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `out${index}`, library: "0", name: "Pin", attributes: { label: `O${index}`, type: "output", facing: "west" } })),
    ],
    connections: [
      { from: { component: "A", port: "port" }, to: { component: "split", port: "bus" } },
      ...Array.from({ length: 4 }, (_, index) => ({ from: { component: "split", port: `out${index}` }, to: { component: `led${index}`, port: "in" } })),
      ...Array.from({ length: 4 }, (_, index) => ({ from: { component: "split", port: `out${index}` }, to: { component: `out${index}`, port: "port" } })),
    ],
  });
  assert.equal(result.validation?.exitCode, 0);
  assert.equal(result.layout.certificate.netsConnected, 5);
  assert.equal(result.layout.certificate.netsAcyclic, 5);
  const inventory = await service.inspectProject("splitter.circ", "SplitterToLeds");
  const components = (inventory.items as Array<{ kind: string; library: string; name: string; attributes: Record<string, string> }>).filter((item) => item.kind === "component");
  const splitter = components.find((item) => item.name === "Splitter");
  assert.equal(splitter?.library, "0");
  assert.equal(splitter?.attributes.appear, "legacy");
  assert.equal(components.filter((item) => item.name === "LED" && item.library === "5").length, 4);
  const validation = await service.validateProject("splitter.circ");
  assert.equal(validation.valid, true);
  await writeFile(join(workspace, "splitter.txt"), "A[4] O0 O1 O2 O3\n0000 0 0 0 0\n0101 1 0 1 0\n1010 0 1 0 1\n1111 1 1 1 1\n", "utf8");
  const vector = await service.testVector("splitter.circ", "SplitterToLeds", "splitter.txt");
  assert.equal(vector.passed, 4);
  assert.equal(vector.failed, 0);
});

test("matches Logisim geometry for rotated negated gates and XOR", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-layout-geometry-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("geometry.circ", "GeometryCheck");
  const result = await service.layoutGraph("geometry.circ", "GeometryCheck", {
    components: [
      { id: "A", library: "0", name: "Pin", attributes: { label: "A" } },
      { id: "B", library: "0", name: "Pin", attributes: { label: "B" } },
      { id: "C", library: "0", name: "Pin", attributes: { label: "C" } },
      { id: "and", library: "1", name: "AND Gate", attributes: { facing: "south", negate0: "true" } },
      { id: "xor", library: "1", name: "XOR Gate" },
      { id: "Y", library: "0", name: "Pin", attributes: { label: "Y", type: "output", facing: "west" } },
    ],
    connections: [
      { from: { component: "A", port: "port" }, to: { component: "and", port: "in0" } },
      { from: { component: "B", port: "port" }, to: { component: "and", port: "in1" } },
      { from: { component: "and", port: "out" }, to: { component: "xor", port: "in0" } },
      { from: { component: "C", port: "port" }, to: { component: "xor", port: "in1" } },
      { from: { component: "xor", port: "out" }, to: { component: "Y", port: "port" } },
    ],
  });
  assert.equal(result.validation?.exitCode, 0);
  assert.equal(result.layout.objective.crossings, 0);

  const rows = ["A B C Y"];
  for (let a = 0; a < 2; a += 1) {
    for (let b = 0; b < 2; b += 1) {
      for (let c = 0; c < 2; c += 1) rows.push(`${a} ${b} ${c} ${Number((!a && Boolean(b)) !== Boolean(c))}`);
    }
  }
  await writeFile(join(workspace, "geometry.txt"), `${rows.join("\n")}\n`, "utf8");
  const vector = await service.testVector("geometry.circ", "GeometryCheck", "geometry.txt");
  assert.equal(vector.passed, 8);
  assert.equal(vector.failed, 0);
});

test("adds more than one hundred components in one atomic batch", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-batch-"));
  const service = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await service.initialize();
  await service.createProject("batch.circ", "Batch");
  const components = Array.from({ length: 105 }, (_, index) => ({
    id: `clock${index}`,
    library: "0",
    name: "Clock",
    x: 100 + (index % 15) * 50,
    y: 100 + Math.floor(index / 15) * 50,
    attributes: { appearance: "NewPins" },
  }));
  const result = await service.applyBatch("batch.circ", "Batch", components, [], false);
  assert.equal(result.componentIndexes.length, 105);
  assert.equal(result.componentIndexes[104]?.id, "clock104");
  const inspection = await service.inspectProject("batch.circ", "Batch", 0, 200);
  assert.equal((inspection.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 105);
  const replacement = await service.applyBatch("batch.circ", "Batch", [{ id: "only", library: "0", name: "Clock", x: 100, y: 100 }], [], true);
  assert.deepEqual(replacement.componentIndexes, [{ id: "only", index: 0 }]);
  const replacedInspection = await service.inspectProject("batch.circ", "Batch");
  assert.equal((replacedInspection.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 1);
});

test("copies a circuit and its subcircuit dependency closure into one new project", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-copy-"));
  const writer = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await writer.initialize();
  await writer.createProject("source.circ", "Top");
  await writer.addCircuit("source.circ", "Child");
  await writer.addCircuit("source.circ", "Grandchild");
  await writer.addCircuit("source.circ", "Unused");
  await writer.applyBatch("source.circ", "Top", [{ id: "child", name: "Child", x: 200, y: 150 }], [], false);
  await writer.applyBatch("source.circ", "Child", [{ id: "grandchild", name: "Grandchild", x: 200, y: 150 }], [], false);

  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  const copied = await service.copyCircuit("source.circ", "Top", "copied.circ", false);
  assert.deepEqual(copied.copiedCircuits, ["Child", "Grandchild", "Top"]);
  const inspection = await service.inspectProject("copied.circ");
  assert.deepEqual((inspection.circuits as Array<{ name: string }>).map((circuit) => circuit.name).sort(), ["Child", "Grandchild", "Top"]);
  assert.equal(inspection.mainCircuit, "Top");
});

test("validates source-verified Clock, D Flip-Flop, Register, and Counter geometry", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-sequential-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("sequential.circ", "Sequential");
  const result = await service.layoutGraph("sequential.circ", "Sequential", {
    components: [
      { id: "D", library: "0", name: "Pin", attributes: { label: "D" } },
      { id: "clock", library: "0", name: "Clock" },
      { id: "ff", library: "4", name: "D Flip-Flop" },
      { id: "register", library: "4", name: "Register", attributes: { width: "1" } },
      { id: "counter", library: "4", name: "Counter", attributes: { width: "1" } },
      { id: "Q", library: "0", name: "Pin", attributes: { label: "Q", output: "true" } },
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
  assert.equal(result.validation?.exitCode, 0);
  assert.equal(result.layout.objective.crossings, 0);
});

test("lays out and round-trips a three-DFF one-hot ring with external controls and taps", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-ring-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("ring.circ", "Ring");
  const result = await service.layoutGraph("ring.circ", "Ring", {
    components: [
      { id: "CLK", library: "0", name: "Pin", attributes: { label: "CLK" } },
      { id: "RST", library: "0", name: "Pin", attributes: { label: "RST" } },
      ...["FF0", "FF1", "FF2"].map((id) => ({ id, library: "4", name: "D Flip-Flop" })),
      ...[0, 1, 2].flatMap((index) => [
        { id: `LED${index}`, library: "5", name: "LED", attributes: { label: `LED${index}`, color: "#11223344", offcolor: "#102030", labelcolor: "#ffffff" } },
        { id: `Q${index}`, library: "0", name: "Pin", attributes: { label: `Q${index}`, type: "output" } },
      ]),
    ],
    connections: [
      ...["FF0", "FF1", "FF2"].map((component) => ({ net: "clock", from: { component: "CLK", port: "port" }, to: { component, port: "clock" } })),
      { net: "reset_init", from: { component: "RST", port: "port" }, to: { component: "FF0", port: "preset" } },
      { net: "reset_init", from: { component: "RST", port: "port" }, to: { component: "FF1", port: "reset" } },
      { net: "reset_init", from: { component: "RST", port: "port" }, to: { component: "FF2", port: "reset" } },
      ...[0, 1, 2].flatMap((index) => {
        const next = (index + 1) % 3;
        return [
          { net: `q${index}`, from: { component: `FF${index}`, port: "q" }, to: { component: `FF${next}`, port: "d" } },
          { net: `q${index}`, from: { component: `FF${index}`, port: "q" }, to: { component: `LED${index}`, port: "in" } },
          { net: `q${index}`, from: { component: `FF${index}`, port: "q" }, to: { component: `Q${index}`, port: "port" } },
        ];
      }),
    ],
  });
  assert.equal(result.validation?.exitCode, 0);
  assert.equal(result.layout.certificate.netsConnected, 5);
  assert.equal(result.layout.certificate.netsAcyclic, 5);
  assert.equal(result.layout.objective.crossings, 0);
  const inspection = await service.inspectProject("ring.circ", "Ring");
  assert.equal((inspection.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 11);
  const items = inspection.items as Array<{ kind: string; name: string; attributes: Record<string, string> }>;
  assert.deepEqual(items.filter((item) => item.kind === "component" && item.name === "Pin" && /^Q\d$/.test(item.attributes.label ?? "")).map((item) => item.attributes.label).sort(), ["Q0", "Q1", "Q2"]);
  assert.equal(items.find((item) => item.kind === "component" && item.name === "LED")?.attributes.color, "#11223344");
});

test("canonicalizes known low-level defaults and legacy Output Pins before writing", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-canonical-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("canonical.circ", "main");
  await service.applyBatch("canonical.circ", "main", [
    { id: "clock", library: "0", name: "Clock", x: 100, y: 100 },
    { id: "output", library: "0", name: "Pin", x: 200, y: 100, attributes: { output: "true", label: "Y" } },
    { id: "flipflop", library: "4", name: "D Flip-Flop", x: 300, y: 100 },
    { id: "hex", library: "0", name: "Pin", x: 400, y: 100, attributes: { width: "4", radix: "16", label: "HEX" } },
    { id: "mixed", library: "0", name: "Pin", x: 500, y: 100, attributes: { Output: "TRUE", label: "MIXED" } },
  ], []);
  const inspection = await service.inspectProject("canonical.circ", "main", 0, 20);
  const components = (inspection.items as Array<{ kind: string; name: string; attributes: Record<string, string> }>).filter((item) => item.kind === "component");
  assert.equal(components.find((component) => component.name === "Clock")?.attributes.appearance, "NewPins");
  assert.equal(components.find((component) => component.name === "D Flip-Flop")?.attributes.appearance, "classic");
  const output = components.find((component) => component.name === "Pin")!;
  assert.equal(output.attributes.type, "output");
  assert.equal(output.attributes.output, undefined);
  assert.equal(output.attributes.facing, "west");
  assert.equal(components.find((component) => component.attributes.label === "HEX")?.attributes.radix, "16");
  const mixed = components.find((component) => component.attributes.label === "MIXED")!;
  assert.equal(mixed.attributes.type, "output");
  assert.equal(mixed.attributes.Output, undefined);
});

test("converts a project without losing semantic inventory", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-convert-"));
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await service.createProject("source.circ", "main");
  await service.applyBatch("source.circ", "main", [{ library: "0", name: "Clock", x: 100, y: 100 }], []);
  const sourcePath = join(workspace, "source.circ");
  const sourceXml = await readFile(sourcePath, "utf8");
  await writeFile(sourcePath, sourceXml.replace('<lib desc="#Wiring" name="0"', '<lib desc="#Wiring" name="20"').replaceAll('lib="0"', 'lib="20"'), "utf8");
  const converted = await service.convertProject("source.circ", "converted.circ", false);
  assert.equal(converted.exitCode, 0);
  const inspection = await service.inspectProject("converted.circ", "main");
  assert.equal((inspection.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 1);
});

test("rejects executable external resources before invoking Logisim", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-external-"));
  const writer = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await writer.initialize();
  await writer.createProject("external.circ", "main");
  const path = join(workspace, "external.circ");
  const xml = await readFile(path, "utf8");
  await writeFile(path, xml.replace('desc="#Wiring"', 'desc="jar#plugin.jar#ExampleLibrary"'), "utf8");
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await assert.rejects(service.validateProject("external.circ"), /External JAR libraries are disabled/);
  await assert.rejects(service.launchGui("external.circ", "main"), /External JAR libraries are disabled/);
});

test("launches the GUI from the validated file descriptor rather than a replaceable path", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux /proc/self/fd/3 descriptor passing is Linux-only");
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-launch-"));
  const executable = join(workspace, "fake-logisim");
  const capturedPath = join(workspace, "captured.circ");
  const capturedArgument = join(workspace, "captured-argument.txt");
  await writeFile(executable, `#!/bin/sh\nsleep 0.2\nprintf '%s\\n' "$2" > '${capturedArgument}'\ncp -- "$2" '${capturedPath}'\n`, { mode: 0o700 });
  const service = new LogisimService({ workspaceRoot: workspace, executable, validateWrites: false });
  await service.initialize();
  await service.createProject("launch.circ", "main");
  const projectPath = join(workspace, "launch.circ");
  const expectedXml = await readFile(projectPath, "utf8");

  const launched = await service.launchGui("launch.circ");
  await rename(projectPath, join(workspace, "validated.circ"));
  await writeFile(projectPath, "replacement", "utf8");

  const deadline = Date.now() + 3_000;
  while (true) {
    try {
      await stat(capturedPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || Date.now() >= deadline) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  assert.equal(await readFile(capturedPath, "utf8"), expectedXml);
  const descriptorArgument = (await readFile(capturedArgument, "utf8")).trim();
  assert.equal(descriptorArgument, "/proc/self/fd/3");
  assert.equal(launched.path, projectPath);
  assert.equal(launched.secureDescriptor, true);
});

test("reports actionable wire-repair diagnostics with component guidance", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-diagnostics-"));
  const writer = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await writer.initialize();
  await writer.createProject("bad.circ", "main");
  await writer.applyBatch("bad.circ", "main", [
    { library: "0", name: "Pin", x: 100, y: 90, attributes: { label: "A", appearance: "NewPins" } },
    { library: "0", name: "Pin", x: 100, y: 130, attributes: { label: "B", appearance: "NewPins" } },
    { library: "1", name: "XOR Gate", x: 200, y: 110 },
    { library: "0", name: "Pin", x: 250, y: 110, attributes: { label: "Y", type: "output", facing: "west", appearance: "NewPins" } },
  ], [
    { fromX: 100, fromY: 90, toX: 150, toY: 90 },
    { fromX: 100, fromY: 130, toX: 150, toY: 130 },
    { fromX: 200, fromY: 110, toX: 250, toY: 110 },
  ]);
  const service = new LogisimService({ workspaceRoot: workspace });
  await service.initialize();
  await assert.rejects(
    service.validateProject("bad.circ"),
    /wire (added|removed) or repaired by Logisim[\s\S]*logisim_describe_component/i,
  );
});

test("serializes concurrent writes so components are not lost", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-concurrency-"));
  const serviceA = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  const serviceB = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await Promise.all([serviceA.initialize(), serviceB.initialize()]);
  await serviceA.createProject("parallel.circ", "main");

  await Promise.all([
    serviceA.addComponent("parallel.circ", "main", { library: "0", name: "Clock", x: 100, y: 100 }),
    serviceB.addComponent("parallel.circ", "main", { library: "0", name: "Clock", x: 200, y: 100 }),
  ]);

  const inspection = await serviceA.inspectProject("parallel.circ", "main");
  assert.equal((inspection.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 2);
});

test("preserves project mode and rejects a symlinked backup directory", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-security-"));
  const service = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await service.initialize();
  await service.createProject("secure.circ", "main");
  if (process.platform === "linux") {
    await chmod(join(workspace, "secure.circ"), 0o600);
    await service.addComponent("secure.circ", "main", { library: "0", name: "Clock", x: 100, y: 100 });
    assert.equal((await stat(join(workspace, "secure.circ"))).mode & 0o777, 0o600);
    await execFileAsync("/usr/bin/setfacl", ["-m", "u:nobody:r", join(workspace, "secure.circ")]);
    await service.addComponent("secure.circ", "main", { library: "0", name: "Clock", x: 150, y: 100 });
    const acl = await execFileAsync("/usr/bin/getfacl", ["--absolute-names", join(workspace, "secure.circ")]);
    assert.match(acl.stdout, /user:nobody:r--/);
  }

  const otherDirectory = await mkdtemp(join(tmpdir(), "logisim-mcp-outside-"));
  const secret = join(otherDirectory, "secret.txt");
  await writeFile(secret, "must not be disclosed", "utf8");
  const maliciousLock = join(workspace, ".secure.circ.mcp.lock");
  try {
    await symlink(secret, maliciousLock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") {
      t.skip("Creating symlinks on Windows requires Developer Mode or elevation");
      return;
    }
    throw error;
  }
  await assert.rejects(
    service.addComponent("secure.circ", "main", { library: "0", name: "Clock", x: 175, y: 100 }),
    /lock path is not a regular file/i,
  );
  await rm(maliciousLock);
  await mkdir(join(workspace, "nested"));
  await writeFile(join(workspace, "nested", "project.circ"), await readFile(join(workspace, "secure.circ")));
  await symlink(otherDirectory, join(workspace, "nested", ".logisim-mcp"));
  await assert.rejects(
    service.addComponent("nested/project.circ", "main", { library: "0", name: "Clock", x: 200, y: 100 }),
    /Backup path is not a real directory/,
  );
});

test("allows concurrent first backups for different projects", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-backup-race-"));
  const serviceA = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  const serviceB = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await Promise.all([serviceA.initialize(), serviceB.initialize()]);
  await Promise.all([serviceA.createProject("a.circ"), serviceB.createProject("b.circ")]);
  await Promise.all([
    serviceA.addComponent("a.circ", "main", { library: "0", name: "Clock", x: 100, y: 100 }),
    serviceB.addComponent("b.circ", "main", { library: "0", name: "Clock", x: 100, y: 100 }),
  ]);
  const [a, b] = await Promise.all([serviceA.inspectProject("a.circ", "main"), serviceB.inspectProject("b.circ", "main")]);
  assert.equal((a.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 1);
  assert.equal((b.circuits as Array<{ componentCount: number }>)[0]?.componentCount, 1);
});

test("rejects malformed XML instead of repairing parser warnings", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-mcp-xml-"));
  const service = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
  await service.initialize();
  await writeFile(join(workspace, "bad.circ"), "<?xml version=\"1.0\"?><project><circuit name=main/></project>", "utf8");
  await assert.rejects(service.inspectProject("bad.circ"), /Invalid Logisim XML/);
});
