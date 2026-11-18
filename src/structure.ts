/**
 * Java-free structural validation, XML safety checks and native catalog data.
 *
 * Structural validation complements (does not replace) the Logisim CLI
 * round-trip in LogisimService.validatePath: it runs without Java, gives
 * precise messages, and catches problems before Logisim is ever invoked.
 */
import type { Document, Element } from "@xmldom/xmldom";

export interface StructureReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  circuits: number;
  components: number;
  wires: number;
  scope: string;
}

/** Native component names per standard library descriptor (Logisim-evolution 3.8 / 4.0). */
export const NATIVE_CATALOG: Array<{ library: string; defaultNumber: string; components: string[] }> = [
  { library: "#Wiring", defaultNumber: "0", components: ["Splitter", "Pin", "Probe", "Tunnel", "Pull Resistor", "Clock", "Constant", "Power", "Ground", "Transistor", "Transmission Gate", "Bit Extender", "Power On Reset"] },
  { library: "#Gates", defaultNumber: "1", components: ["NOT Gate", "Buffer", "AND Gate", "OR Gate", "NAND Gate", "NOR Gate", "XOR Gate", "XNOR Gate", "Odd Parity", "Even Parity", "Controlled Buffer", "Controlled Inverter", "PLA"] },
  { library: "#Plexers", defaultNumber: "2", components: ["Multiplexer", "Demultiplexer", "Decoder", "Priority Encoder", "BitSelector"] },
  { library: "#Arithmetic", defaultNumber: "3", components: ["Adder", "Subtractor", "Multiplier", "Divider", "Negator", "Comparator", "Shifter", "BitAdder", "BitFinder", "FPAdder", "FPSubtractor", "FPMultiplier", "FPDivider", "FPNegator", "FPComparator", "FPToInt", "IntToFP"] },
  { library: "#Memory", defaultNumber: "4", components: ["D Flip-Flop", "T Flip-Flop", "J-K Flip-Flop", "S-R Flip-Flop", "Register", "Counter", "Shift Register", "Random", "RAM", "ROM"] },
  { library: "#I/O", defaultNumber: "5", components: ["Button", "DipSwitch", "Joystick", "Keyboard", "LED", "RGBLED", "7-Segment Display", "Hex Digit Display", "DotMatrix", "TTY", "LedBar", "Slider", "Buzzer"] },
  { library: "#Base", defaultNumber: "8", components: ["Text"] },
];

export const EDIT_OPERATION_EXAMPLES = [
  { action: "add_circuit", name: "alu", set_main: false },
  { action: "set_main", name: "alu" },
  { action: "add_component", circuit: "main", library: "1", name: "AND Gate", at: [300, 200], attributes: { inputs: 2, size: 50 } },
  { action: "add_wire", circuit: "main", points: [[100, 100], [200, 100], [200, 180]] },
  { action: "set_attributes", circuit: "main", at: [300, 200], attributes: { label: "result", negate0: null } },
  { action: "move_component", circuit: "main", at: [300, 200], to: [400, 200] },
  { action: "remove_component", circuit: "main", at: [400, 200], remove_wires: false },
  { action: "remove_wire", circuit: "main", from: [100, 100], to: [200, 100] },
];

const LOCATION = /^\((-?\d+),(-?\d+)\)$/;

function children(parent: Element, tagName?: string): Element[] {
  const result: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index);
    if (node?.nodeType === 1 && (!tagName || node.nodeName === tagName)) result.push(node as Element);
  }
  return result;
}

function point(value: string | null): { x: number; y: number } | null {
  const match = LOCATION.exec(value ?? "");
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** Reject DTDs/entities (XXE and billion-laughs) before any parser sees the text. */
export function assertSafeXmlText(xml: string): void {
  if (Buffer.byteLength(xml, "utf8") > 20_000_000) throw new Error("XML exceeds the 20 MB limit");
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) throw new Error("DTD and entity declarations are not allowed in Logisim project XML");
}

export function checkStructure(document: Document): StructureReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = document.documentElement;
  let componentTotal = 0;
  let wireTotal = 0;
  const scope = "XML structure, library and subcircuit references, recursion, coordinates and wire geometry. Electrical behaviour needs Logisim (validate/test tools).";
  if (!root || root.nodeName !== "project") {
    return { valid: false, errors: ["Root element must be <project>"], warnings, circuits: 0, components: 0, wires: 0, scope };
  }

  const libraries = new Map<string, string>();
  for (const library of children(root, "lib")) {
    const name = library.getAttribute("name") ?? "";
    if (libraries.has(name)) errors.push(`Duplicate library number '${name}'`);
    libraries.set(name, library.getAttribute("desc") ?? "");
  }

  const circuits = children(root, "circuit");
  const names = circuits.map((circuit) => circuit.getAttribute("name") ?? "");
  const seen = new Set<string>();
  for (const name of names) {
    if (!name) errors.push("Every circuit needs a non-empty name");
    else if (seen.has(name)) errors.push(`Duplicate circuit name '${name}'`);
    seen.add(name);
  }
  const mainName = children(root, "main")[0]?.getAttribute("name");
  if (circuits.length === 0) errors.push("Project contains no circuits");
  else if (!mainName) warnings.push("Project has no <main> element; Logisim will pick the first circuit");
  else if (!seen.has(mainName)) errors.push(`Main circuit '${mainName}' does not exist`);

  const edges = new Map<string, Set<string>>();
  for (const circuit of circuits) {
    const circuitName = circuit.getAttribute("name") ?? "";
    const dependencies = new Set<string>();
    edges.set(circuitName, dependencies);
    const anchors = new Map<string, string>();
    for (const component of children(circuit, "comp")) {
      componentTotal += 1;
      const componentName = component.getAttribute("name") ?? "";
      const loc = component.getAttribute("loc");
      const where = `${circuitName}: ${componentName || "<unnamed>"} at ${loc ?? "<no loc>"}`;
      if (!componentName) errors.push(`${where}: component has no name`);
      const location = point(loc);
      if (!location) errors.push(`${where}: invalid loc (expected "(x,y)")`);
      else {
        if (location.x % 10 !== 0 || location.y % 10 !== 0) warnings.push(`${where}: anchor is off the 10-unit grid`);
        const previous = anchors.get(loc!);
        if (previous !== undefined) warnings.push(`${circuitName}: ${componentName} and ${previous} share anchor ${loc}`);
        anchors.set(loc!, componentName);
      }
      if (component.hasAttribute("lib")) {
        const lib = component.getAttribute("lib") ?? "";
        if (!libraries.has(lib)) errors.push(`${where}: references undeclared library '${lib}'`);
      } else if (!seen.has(componentName)) {
        errors.push(`${where}: no library given and no circuit named '${componentName}' exists`);
      } else {
        dependencies.add(componentName);
      }
    }
    for (const wire of children(circuit, "wire")) {
      wireTotal += 1;
      const from = point(wire.getAttribute("from"));
      const to = point(wire.getAttribute("to"));
      const where = `${circuitName}: wire ${wire.getAttribute("from")} -> ${wire.getAttribute("to")}`;
      if (!from || !to) {
        errors.push(`${where}: invalid endpoint`);
        continue;
      }
      if (from.x === to.x && from.y === to.y) errors.push(`${where}: zero-length wire`);
      else if (from.x !== to.x && from.y !== to.y) errors.push(`${where}: wires must be horizontal or vertical`);
    }
  }

  // Recursive subcircuit use makes Logisim refuse to load the file.
  const state = new Map<string, number>();
  const visit = (name: string, trail: string[]): void => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) {
      errors.push(`Recursive subcircuit dependency: ${[...trail, name].join(" -> ")}`);
      return;
    }
    state.set(name, 1);
    for (const dependency of edges.get(name) ?? []) visit(dependency, [...trail, name]);
    state.set(name, 2);
  };
  for (const name of edges.keys()) visit(name, []);

  return { valid: errors.length === 0, errors, warnings, circuits: circuits.length, components: componentTotal, wires: wireTotal, scope };
}
