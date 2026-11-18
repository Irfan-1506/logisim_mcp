import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LogisimService } from "./logisim.js";
import { launcherExists, parseLogisimVersion, resolveLauncher } from "./platform.js";
import { assertSafeXmlText } from "./structure.js";
import { evaluate, parseExpression, simplify, synthesizeCircuit } from "./synthesis.js";

test("platform resolves executable, jar, and version strings cross-platform", () => {
  const execLauncher = resolveLauncher({ executable: "/custom/logisim" }, {});
  assert.equal(execLauncher.kind, "executable");
  assert.equal(execLauncher.command, "/custom/logisim");

  const jarLauncher = resolveLauncher({}, { LOGISIM_JAR: "/opt/logisim.jar", LOGISIM_JAVA: "/opt/jdk/bin/java" });
  assert.equal(jarLauncher.kind, "jar");
  assert.equal(jarLauncher.command, "/opt/jdk/bin/java");
  assert.deepEqual(jarLauncher.prefixArgs, ["-jar", "/opt/logisim.jar"]);

  assert.equal(parseLogisimVersion("Logisim-evolution v3.8.0\n"), "3.8.0");
  assert.equal(parseLogisimVersion("Logisim-evolution 4.0.0"), "4.0.0");
});

test("boolean parser, simplifier, and truth table handle precedence and sharing", () => {
  const inputs = new Set(["A", "B", "Cin"]);
  const expr = parseExpression("~(A ^ B) | (A & 1) | (B & 0)", inputs);
  const folded = simplify(expr);
  assert.equal(evaluate(folded, { A: 1, B: 0, Cin: 0 }), 1);
  assert.equal(evaluate(folded, { A: 0, B: 0, Cin: 0 }), 1);

  const synth = synthesizeCircuit(
    { inputs: ["A", "B"], outputs: { X: "A & B", Y: "B & A" } },
    "tunnels",
  );
  // Commutative expressions A&B and B&A share a single AND gate.
  assert.equal(synth.gateCount, 1);
  assert.equal(synth.truthTable.rows.length, 4);
  assert.match(synth.vectors, /^A B X Y\n0 0 0 0\n0 1 0 0\n1 0 0 0\n1 1 1 1\n$/);
});

test("XML safety rejects DTD and entity declarations", () => {
  assert.throws(() => assertSafeXmlText('<!DOCTYPE foo><project/>'), /DTD/);
  assert.throws(() => assertSafeXmlText('<!ENTITY x "y"><project/>'), /DTD/);
});

test("unified anchor editing, optimistic sha256 concurrency, XML import/read, and structure checks", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "logisim-unified-test-"));
  try {
    const service = new LogisimService({ workspaceRoot: workspace, validateWrites: false });
    await service.initialize();

    const created = await service.createProject("demo.circ", "main");
    assert.ok(typeof created.sha256 === "string" && (created.sha256 as string).length === 64);

    const inspected = await service.inspectProject("demo.circ");
    const sha1 = inspected.sha256 as string;

    const edited = await service.editProject(
      "demo.circ",
      [
        { action: "add_component", name: "Pin", at: [100, 100], attributes: { label: "A" } },
        { action: "add_component", name: "Pin", at: [100, 140], attributes: { label: "B" } },
        { action: "add_component", name: "AND Gate", at: [200, 120], attributes: { inputs: 2, size: 50 } },
        { action: "add_component", name: "Pin", at: [240, 120], attributes: { label: "Y", type: "output", facing: "west" } },
        { action: "add_wire", points: [[100, 100], [150, 100]] },
        { action: "add_wire", points: [[100, 140], [150, 140]] },
        { action: "add_wire", points: [[200, 120], [240, 120]] },
      ],
      sha1,
    );
    assert.equal(edited.applied, 7);
    assert.notEqual(edited.sha256, sha1);

    // Stale SHA256 must be rejected.
    await assert.rejects(
      () => service.editProject("demo.circ", [{ action: "add_circuit", name: "sub" }], sha1),
      /changed since it was inspected/i,
    );

    const structure = await service.checkStructure("demo.circ");
    assert.equal(structure.valid, true);
    assert.equal(structure.components, 4);
    assert.equal(structure.wires, 3);

    const raw = await service.readXml("demo.circ");
    assert.match(raw.xml, /AND Gate/);

    const reimported = await service.importXml("copy.circ", raw.xml, false);
    assert.equal(reimported.sha256, raw.sha256);

    // Recursive subcircuit must be caught by structural validation.
    await service.editProject("demo.circ", [{ action: "add_circuit", name: "loop" }]);
    await assert.rejects(
      () => service.editProject("demo.circ", [{ action: "add_component", circuit: "loop", name: "loop", at: [100, 100] }]),
      /Recursive subcircuit/i,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("synthesizeLogic (wires + tunnels) and createExample simulate end-to-end when Logisim is installed", async (t) => {
  const launcher = resolveLauncher();
  if (!launcherExists(launcher)) {
    t.skip("Logisim-evolution is not installed in this environment");
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), "logisim-unified-sim-"));
  try {
    const service = new LogisimService({ workspaceRoot: workspace });
    await service.initialize();

    const planar = await service.synthesizeLogic("planar.circ", ["A", "B", "C"], { Y: "(A & B) | C" }, { verify: true, style: "wires" });
    assert.equal(planar.style, "wires");
    assert.equal((planar.simulation as { success: boolean }).success, true);
    assert.equal((planar.simulation as { passed: number }).passed, 8);

    const fullAdder = await service.createExample("full_adder.circ", "full_adder", { verify: true, style: "auto" });
    assert.equal(fullAdder.style, "tunnels");
    assert.equal((fullAdder.simulation as { success: boolean }).success, true);
    assert.equal((fullAdder.simulation as { passed: number }).passed, 8);

    const adder4 = await service.createExample("adder4.circ", "adder4", { verify: true, style: "tunnels" });
    assert.equal(adder4.style, "tunnels");
    assert.equal((adder4.simulation as { success: boolean }).success, true);
    assert.equal((adder4.simulation as { passed: number }).passed, 512);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
