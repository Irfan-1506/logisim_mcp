/**
 * Boolean-expression synthesis into native, editable Logisim circuits.
 *
 * Pipeline: parse -> constant-fold -> share common sub-expressions -> lay out.
 * Two layout styles are available:
 *   - "wires":   hand the gate graph to the certified layout/router in layout.ts,
 *                producing real orthogonal wires (best for small circuits).
 *   - "tunnels": deterministic column layout that connects nets with labelled
 *                native Tunnels (scales to large / non-planar circuits).
 *   - "auto":    try "wires", fall back to "tunnels" if routing is infeasible.
 * Port offsets always come from the source-verified catalog in layout.ts.
 */
import { describeLayoutComponent, layoutGraph } from "./layout.js";
import type { LayoutComponentInput, LayoutConnectionInput } from "./layout.js";

export type Expr =
  | { kind: "var"; name: string }
  | { kind: "const"; value: 0 | 1 }
  | { kind: "not"; arg: Expr }
  | { kind: "and" | "or" | "xor"; left: Expr; right: Expr };

export type SynthesisStyle = "auto" | "wires" | "tunnels";

export interface SynthComponent {
  id: string;
  library: string;
  name: string;
  x: number;
  y: number;
  attributes: Record<string, string>;
}

export interface SynthWire {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface SynthesisResult {
  style: "wires" | "tunnels";
  fallbackReason: string | null;
  components: SynthComponent[];
  wires: SynthWire[];
  gateCount: number;
  inputs: string[];
  outputs: string[];
  simplified: Record<string, string>;
  truthTable: { header: string[]; rows: number[][] };
  vectors: string;
}

const MAX_INPUTS = 12;
const MAX_OUTPUTS = 32;
const MAX_EXPRESSION_LENGTH = 4096;
const MAX_NODES = 512;
const RESERVED = new Set(["not", "and", "or", "xor", "nand", "nor"]);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/* ------------------------------------------------------------------ parser */

type Token = { type: "id" | "const" | "op" | "lparen" | "rparen" | "postnot"; value: string; position: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) end += 1;
      const word = text.slice(index, end);
      const lower = word.toLowerCase();
      if (lower === "not") tokens.push({ type: "op", value: "~", position: index });
      else if (lower === "and") tokens.push({ type: "op", value: "&", position: index });
      else if (lower === "or") tokens.push({ type: "op", value: "|", position: index });
      else if (lower === "xor") tokens.push({ type: "op", value: "^", position: index });
      else tokens.push({ type: "id", value: word, position: index });
      index = end;
      continue;
    }
    if (char === "0" || char === "1") {
      if (/[0-9]/.test(text[index + 1] ?? "")) throw new Error(`Only the constants 0 and 1 are allowed (position ${index})`);
      tokens.push({ type: "const", value: char, position: index });
      index += 1;
      continue;
    }
    if (char === "(") tokens.push({ type: "lparen", value: char, position: index });
    else if (char === ")") tokens.push({ type: "rparen", value: char, position: index });
    else if (char === "'") tokens.push({ type: "postnot", value: char, position: index });
    else if (char === "~" || char === "!") tokens.push({ type: "op", value: "~", position: index });
    else if (char === "&" || char === "*" || char === "·") tokens.push({ type: "op", value: "&", position: index });
    else if (char === "|" || char === "+") tokens.push({ type: "op", value: "|", position: index });
    else if (char === "^" || char === "⊕") tokens.push({ type: "op", value: "^", position: index });
    else throw new Error(`Unexpected character '${char}' at position ${index}`);
    // Accept C-style doubled operators (&&, ||).
    if ((char === "&" || char === "|") && text[index + 1] === char) index += 1;
    index += 1;
  }
  return tokens;
}

/**
 * Parse a one-bit Boolean expression. Precedence (high to low):
 * NOT (~ ! not, postfix '), AND (& * and), XOR (^ xor), OR (| + or).
 */
export function parseExpression(text: string, inputs: ReadonlySet<string>): Expr {
  if (text.length > MAX_EXPRESSION_LENGTH) throw new Error(`Expression longer than ${MAX_EXPRESSION_LENGTH} characters`);
  const tokens = tokenize(text);
  let position = 0;
  let nodes = 0;
  const count = <T extends Expr>(node: T): T => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new Error(`Expression has more than ${MAX_NODES} nodes`);
    return node;
  };
  const peek = (): Token | undefined => tokens[position];
  const fail = (message: string): never => {
    const token = peek();
    throw new Error(`${message} ${token ? `near '${token.value}' (position ${token.position})` : "at end of expression"} in: ${text}`);
  };

  const primary = (): Expr => {
    const token = peek();
    if (!token) return fail("Expected an operand");
    if (token.type === "op" && token.value === "~") {
      position += 1;
      return count({ kind: "not", arg: postfix() });
    }
    if (token.type === "lparen") {
      position += 1;
      const inner = orExpr();
      if (peek()?.type !== "rparen") fail("Expected ')'");
      position += 1;
      return inner;
    }
    if (token.type === "const") {
      position += 1;
      return count({ kind: "const", value: token.value === "1" ? 1 : 0 });
    }
    if (token.type === "id") {
      if (!inputs.has(token.value)) fail(`Unknown input '${token.value}'`);
      position += 1;
      return count({ kind: "var", name: token.value });
    }
    return fail("Expected an operand");
  };
  const postfix = (): Expr => {
    let node = primary();
    while (peek()?.type === "postnot") {
      position += 1;
      node = count({ kind: "not", arg: node });
    }
    return node;
  };
  const binary = (operator: string, kind: "and" | "or" | "xor", next: () => Expr) => (): Expr => {
    let node = next();
    while (peek()?.type === "op" && peek()!.value === operator) {
      position += 1;
      node = count({ kind, left: node, right: next() });
    }
    return node;
  };
  const andExpr = binary("&", "and", postfix);
  const xorExpr = binary("^", "xor", andExpr);
  const orExpr = binary("|", "or", xorExpr);

  const result = orExpr();
  if (position !== tokens.length) fail("Unexpected token");
  return result;
}

export function evaluate(expression: Expr, values: Readonly<Record<string, number>>): 0 | 1 {
  switch (expression.kind) {
    case "var":
      return values[expression.name] ? 1 : 0;
    case "const":
      return expression.value;
    case "not":
      return evaluate(expression.arg, values) ? 0 : 1;
    case "and":
      return (evaluate(expression.left, values) & evaluate(expression.right, values)) as 0 | 1;
    case "or":
      return (evaluate(expression.left, values) | evaluate(expression.right, values)) as 0 | 1;
    case "xor":
      return (evaluate(expression.left, values) ^ evaluate(expression.right, values)) as 0 | 1;
  }
}

/** Constant folding and double-negation removal; never changes the function. */
export function simplify(expression: Expr): Expr {
  if (expression.kind === "var" || expression.kind === "const") return expression;
  if (expression.kind === "not") {
    const arg = simplify(expression.arg);
    if (arg.kind === "const") return { kind: "const", value: arg.value ? 0 : 1 };
    if (arg.kind === "not") return arg.arg;
    return { kind: "not", arg };
  }
  const left = simplify(expression.left);
  const right = simplify(expression.right);
  const constant = left.kind === "const" ? left : right.kind === "const" ? right : null;
  const other = constant === left ? right : left;
  if (left.kind === "const" && right.kind === "const") {
    return { kind: "const", value: evaluate({ kind: expression.kind, left, right }, {}) };
  }
  if (constant) {
    if (expression.kind === "and") return constant.value ? other : { kind: "const", value: 0 };
    if (expression.kind === "or") return constant.value ? { kind: "const", value: 1 } : other;
    return constant.value ? simplify({ kind: "not", arg: other }) : other;
  }
  return { kind: expression.kind, left, right };
}

/** Canonical key; commutative operands are sorted so A&B and B&A share a gate. */
export function expressionKey(expression: Expr): string {
  switch (expression.kind) {
    case "var":
      return expression.name;
    case "const":
      return String(expression.value);
    case "not":
      return `~(${expressionKey(expression.arg)})`;
    default: {
      const [a, b] = [expressionKey(expression.left), expressionKey(expression.right)].sort();
      return `${expression.kind}(${a},${b})`;
    }
  }
}

export function formatExpression(expression: Expr): string {
  switch (expression.kind) {
    case "var":
      return expression.name;
    case "const":
      return String(expression.value);
    case "not":
      return expression.arg.kind === "var" || expression.arg.kind === "const" ? `~${formatExpression(expression.arg)}` : `~(${formatExpression(expression.arg)})`;
    default: {
      const symbol = expression.kind === "and" ? "&" : expression.kind === "or" ? "|" : "^";
      return `(${formatExpression(expression.left)} ${symbol} ${formatExpression(expression.right)})`;
    }
  }
}

/* ----------------------------------------------------------- specification */

export interface LogicSpec {
  inputs: string[];
  outputs: Record<string, string>;
}

export function validateNames(spec: LogicSpec): void {
  const outputNames = Object.keys(spec.outputs);
  if (spec.inputs.length < 1 || spec.inputs.length > MAX_INPUTS) throw new Error(`Provide 1-${MAX_INPUTS} inputs`);
  if (outputNames.length < 1 || outputNames.length > MAX_OUTPUTS) throw new Error(`Provide 1-${MAX_OUTPUTS} outputs`);
  const seen = new Set<string>();
  for (const name of [...spec.inputs, ...outputNames]) {
    if (!IDENTIFIER.test(name)) throw new Error(`'${name}' is not a valid pin name (letter first, then letters/digits/_; max 32 chars)`);
    if (RESERVED.has(name.toLowerCase())) throw new Error(`'${name}' is a reserved operator word`);
    if (seen.has(name)) throw new Error(`Pin name '${name}' is used more than once`);
    seen.add(name);
  }
}

export function buildTruthTable(inputs: string[], expressions: Array<[string, Expr]>): { header: string[]; rows: number[][]; vectors: string } {
  const header = [...inputs, ...expressions.map(([name]) => name)];
  const rows: number[][] = [];
  for (let mask = 0; mask < 1 << inputs.length; mask += 1) {
    const values: Record<string, number> = {};
    // First input is the most significant bit, so rows read like a textbook table.
    inputs.forEach((name, index) => {
      values[name] = (mask >> (inputs.length - 1 - index)) & 1;
    });
    rows.push([...inputs.map((name) => values[name]!), ...expressions.map(([, expression]) => evaluate(expression, values))]);
  }
  const vectors = `${header.join(" ")}\n${rows.map((row) => row.join(" ")).join("\n")}\n`;
  return { header, rows, vectors };
}

/* --------------------------------------------------------------- gate DAG */

interface Node {
  id: string;
  kind: "const" | "not" | "and" | "or" | "xor";
  value?: 0 | 1;
  sources: string[]; // input names or node ids
}

function buildDag(expressions: Array<[string, Expr]>, inputs: string[]): { nodes: Node[]; outputNets: Array<[string, string]> } {
  let prefix = "net";
  while (inputs.some((name) => name.startsWith(prefix))) prefix = `g${prefix}`;
  const nodes: Node[] = [];
  const byKey = new Map<string, string>();
  const visit = (expression: Expr): string => {
    if (expression.kind === "var") return expression.name;
    const key = expressionKey(expression);
    const existing = byKey.get(key);
    if (existing) return existing;
    let node: Node;
    if (expression.kind === "const") node = { id: `${prefix}${nodes.length}`, kind: "const", value: expression.value, sources: [] };
    else if (expression.kind === "not") node = { id: "", kind: "not", sources: [visit(expression.arg)] };
    else node = { id: "", kind: expression.kind, sources: [visit(expression.left), visit(expression.right)] };
    node.id = `${prefix}${nodes.length}`;
    nodes.push(node);
    byKey.set(key, node.id);
    return node.id;
  };
  const outputNets = expressions.map(([name, expression]): [string, string] => [name, visit(expression)]);
  return { nodes, outputNets };
}

const GATE_NAMES = { not: "NOT Gate", and: "AND Gate", or: "OR Gate", xor: "XOR Gate" } as const;

function portOffsets(name: string): Record<string, { x: number; y: number }> {
  const description = describeLayoutComponent("1", name, {}) as { ports?: Array<{ id: string; offsetFromAnchor: { x: number; y: number } }> };
  const result: Record<string, { x: number; y: number }> = {};
  for (const port of description.ports ?? []) result[port.id] = port.offsetFromAnchor;
  return result;
}

/* ---------------------------------------------------------- tunnel layout */

function tunnelLayout(inputs: string[], nodes: Node[], outputNets: Array<[string, string]>): { components: SynthComponent[]; wires: SynthWire[] } {
  const components: SynthComponent[] = [];
  const wires: SynthWire[] = [];
  const wire = (fromX: number, fromY: number, toX: number, toY: number): void => {
    if (fromX !== toX || fromY !== toY) wires.push({ fromX, fromY, toX, toY });
  };
  // Tunnel default facing is west (label extends east of the anchor); only write non-defaults.
  const tunnel = (label: string, x: number, y: number, facing: "east" | "west"): void => {
    components.push({ id: `t${components.length}`, library: "0", name: "Tunnel", x, y, attributes: facing === "west" ? { label } : { facing, label } });
  };

  const PIN_X = 100;
  const PIN_PITCH = 60;
  const TOP = 100;
  const COLUMN_X = 420;
  const COLUMN_PITCH = 420;
  const ROW_PITCH = 100;
  const ROWS = 12;

  inputs.forEach((name, index) => {
    const y = TOP + index * PIN_PITCH;
    components.push({ id: `in_${name}`, library: "0", name: "Pin", x: PIN_X, y, attributes: { label: name } });
    wire(PIN_X, y, PIN_X + 40, y);
    tunnel(name, PIN_X + 40, y, "west");
  });

  nodes.forEach((node, index) => {
    const x = COLUMN_X + Math.floor(index / ROWS) * COLUMN_PITCH;
    const y = TOP + (index % ROWS) * ROW_PITCH;
    if (node.kind === "const") {
      components.push({ id: node.id, library: "0", name: "Constant", x, y, attributes: node.value === 0 ? { value: "0x0" } : {} });
    } else {
      const gate = GATE_NAMES[node.kind];
      components.push({ id: node.id, library: "1", name: gate, x, y, attributes: {} });
      const offsets = portOffsets(gate);
      const portIds = node.kind === "not" ? ["in"] : ["in0", "in1"];
      node.sources.forEach((source, sourceIndex) => {
        const offset = offsets[portIds[sourceIndex]!];
        if (!offset) throw new Error(`No verified port ${portIds[sourceIndex]} for ${gate}`);
        const tunnelX = x - 110;
        tunnel(source, tunnelX, y + offset.y, "east");
        wire(tunnelX, y + offset.y, x + offset.x, y + offset.y);
      });
    }
    wire(x, y, x + 40, y);
    tunnel(node.id, x + 40, y, "west");
  });

  const columns = Math.max(1, Math.ceil(nodes.length / ROWS));
  const outX = COLUMN_X + columns * COLUMN_PITCH - 120;
  outputNets.forEach(([name, net], index) => {
    const y = TOP + index * PIN_PITCH;
    tunnel(net, outX, y, "east");
    wire(outX, y, outX + 60, y);
    components.push({ id: `out_${name}`, library: "0", name: "Pin", x: outX + 60, y, attributes: { label: name, type: "output" } });
  });
  return { components, wires };
}

/* ------------------------------------------------------------ wired layout */

function wiredLayout(inputs: string[], nodes: Node[], outputNets: Array<[string, string]>): { components: SynthComponent[]; wires: SynthWire[] } {
  if (nodes.some((node) => node.kind === "const")) throw new Error("constant outputs are only supported by the tunnel layout");
  const layoutComponents: LayoutComponentInput[] = [];
  const connections: LayoutConnectionInput[] = [];
  const driver = (net: string): { component: string; port: string } =>
    inputs.includes(net) ? { component: `in_${net}`, port: "port" } : { component: net, port: "out" };
  for (const name of inputs) layoutComponents.push({ id: `in_${name}`, library: "0", name: "Pin", attributes: { label: name } });
  for (const node of nodes) {
    const gate = GATE_NAMES[node.kind as "not" | "and" | "or" | "xor"];
    layoutComponents.push({ id: node.id, library: "1", name: gate, attributes: {} });
    const portIds = node.kind === "not" ? ["in"] : ["in0", "in1"];
    node.sources.forEach((source, index) => connections.push({ from: driver(source), to: { component: node.id, port: portIds[index]! }, net: source }));
  }
  for (const [name, net] of outputNets) {
    layoutComponents.push({ id: `out_${name}`, library: "0", name: "Pin", attributes: { label: name, type: "output" } });
    connections.push({ from: driver(net), to: { component: `out_${name}`, port: "port" }, net });
  }
  if (layoutComponents.length > 64) throw new Error(`${layoutComponents.length} components exceed the router limit of 64`);
  if (connections.length > 128) throw new Error(`${connections.length} connections exceed the router limit of 128`);
  const plan = layoutGraph({ components: layoutComponents, connections });
  return {
    components: plan.components.map((component) => ({
      id: component.id,
      library: component.library,
      name: component.name,
      x: component.anchor.x,
      y: component.anchor.y,
      attributes: component.attributes,
    })),
    wires: plan.wires.map((segment) => ({ fromX: segment.from.x, fromY: segment.from.y, toX: segment.to.x, toY: segment.to.y })),
  };
}

/* ------------------------------------------------------------------ entry */

export function synthesizeCircuit(spec: LogicSpec, style: SynthesisStyle = "auto"): SynthesisResult {
  validateNames(spec);
  const inputSet = new Set(spec.inputs);
  const expressions = Object.entries(spec.outputs).map(([name, text]): [string, Expr] => [name, simplify(parseExpression(text, inputSet))]);
  const table = buildTruthTable(spec.inputs, expressions);
  const { nodes, outputNets } = buildDag(expressions, spec.inputs);

  let layout: { components: SynthComponent[]; wires: SynthWire[] } | null = null;
  let used: "wires" | "tunnels" = "tunnels";
  let fallbackReason: string | null = null;
  if (style !== "tunnels") {
    try {
      layout = wiredLayout(spec.inputs, nodes, outputNets);
      used = "wires";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (style === "wires") throw new Error(`Wired layout failed: ${message}. Use style "tunnels" or "auto".`);
      fallbackReason = message;
    }
  }
  if (!layout) layout = tunnelLayout(spec.inputs, nodes, outputNets);

  return {
    style: used,
    fallbackReason,
    components: layout.components,
    wires: layout.wires,
    gateCount: nodes.filter((node) => node.kind !== "const").length,
    inputs: spec.inputs,
    outputs: Object.keys(spec.outputs),
    simplified: Object.fromEntries(expressions.map(([name, expression]) => [name, formatExpression(expression)])),
    truthTable: { header: table.header, rows: table.rows },
    vectors: table.vectors,
  };
}

/* --------------------------------------------------------------- examples */

function rippleAdder(bits: number): LogicSpec {
  const inputs = [...Array.from({ length: bits }, (_, i) => `A${i}`), ...Array.from({ length: bits }, (_, i) => `B${i}`), "Cin"];
  const outputs: Record<string, string> = {};
  let carry = "Cin";
  for (let i = 0; i < bits; i += 1) {
    outputs[`S${i}`] = `A${i} ^ B${i} ^ (${carry})`;
    carry = `(A${i} & B${i}) | ((A${i} ^ B${i}) & (${carry}))`;
  }
  outputs.Cout = carry;
  return { inputs, outputs };
}

export const EXAMPLES: Record<string, { description: string; spec: LogicSpec }> = {
  half_adder: { description: "1-bit half adder", spec: { inputs: ["A", "B"], outputs: { Sum: "A ^ B", Carry: "A & B" } } },
  full_adder: { description: "1-bit full adder", spec: { inputs: ["A", "B", "Cin"], outputs: { Sum: "A ^ B ^ Cin", Cout: "(A & B) | (Cin & (A ^ B))" } } },
  mux2: { description: "2:1 multiplexer", spec: { inputs: ["A", "B", "Sel"], outputs: { Y: "(A & ~Sel) | (B & Sel)" } } },
  mux4: { description: "4:1 multiplexer", spec: { inputs: ["D0", "D1", "D2", "D3", "S1", "S0"], outputs: { Y: "(D0 & ~S1 & ~S0) | (D1 & ~S1 & S0) | (D2 & S1 & ~S0) | (D3 & S1 & S0)" } } },
  decoder2: { description: "2-to-4 decoder", spec: { inputs: ["A", "B"], outputs: { Y0: "~A & ~B", Y1: "~A & B", Y2: "A & ~B", Y3: "A & B" } } },
  comparator1: { description: "1-bit magnitude comparator", spec: { inputs: ["A", "B"], outputs: { GT: "A & ~B", EQ: "~(A ^ B)", LT: "~A & B" } } },
  half_subtractor: { description: "1-bit half subtractor", spec: { inputs: ["A", "B"], outputs: { Diff: "A ^ B", Borrow: "~A & B" } } },
  full_subtractor: { description: "1-bit full subtractor", spec: { inputs: ["A", "B", "Bin"], outputs: { Diff: "A ^ B ^ Bin", Bout: "(~A & B) | (~(A ^ B) & Bin)" } } },
  parity4: { description: "4-bit even-parity generator", spec: { inputs: ["D0", "D1", "D2", "D3"], outputs: { P: "D0 ^ D1 ^ D2 ^ D3" } } },
  adder4: { description: "4-bit ripple-carry adder (A0..A3, B0..B3, Cin; bit 0 least significant)", spec: rippleAdder(4) },
};
