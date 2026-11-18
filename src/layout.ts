export type Facing = "east" | "south" | "west" | "north";
export type PortRole = "driver" | "sink";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LayoutComponentInput {
  id: string;
  library: string;
  name: string;
  attributes?: Record<string, string>;
}

export interface LayoutEndpointInput {
  component: string;
  port: string;
}

export interface LayoutConnectionInput {
  from: LayoutEndpointInput;
  to: LayoutEndpointInput;
  net?: string;
}

export interface LayoutWeights {
  length: number;
  bends: number;
  crossings: number;
  overlap: number;
  spacing: number;
  alignment: number;
  congestion: number;
}

export interface LayoutOptionsInput {
  grid?: number;
  componentClearance?: number;
  wireClearance?: number;
  wireSpacing?: number;
  layerSpacing?: number;
  rowSpacing?: number;
  minimumDistance?: number;
  maximumDistance?: number;
  congestionRegionSize?: number;
  congestionLimit?: number;
  maxCandidates?: number;
  maxAStarStates?: number;
  weights?: Partial<LayoutWeights>;
}

export interface LayoutGraphInput {
  components: LayoutComponentInput[];
  connections: LayoutConnectionInput[];
  region?: Rect;
  options?: LayoutOptionsInput;
}

export interface LayoutPortPlan {
  id: string;
  role: PortRole;
  width: number;
  required: boolean;
  point: Point;
  escape: Facing;
}

export interface LayoutComponentPlan {
  id: string;
  library: string;
  name: string;
  attributes: Record<string, string>;
  anchor: Point;
  bounds: Rect;
  footprint: Rect;
  labelBounds?: Rect;
  ports: LayoutPortPlan[];
}

export interface LayoutWirePlan {
  net: string;
  from: Point;
  to: Point;
}

export interface LayoutObjective {
  score: number;
  length: number;
  bends: number;
  crossings: number;
  overlap: number;
  spacing: number;
  alignment: number;
  congestion: number;
  weights: LayoutWeights;
}

export interface LayoutPlan {
  components: LayoutComponentPlan[];
  wires: LayoutWirePlan[];
  objective: LayoutObjective;
  candidatesEvaluated: number;
  routingAttempts: number;
  region: Rect;
  grid: number;
  certificate: LayoutCertificate;
}

export interface LayoutCertificate {
  componentClearance: number;
  wireClearance: number;
  wireSpacing: number;
  minimumComponentGap: number | null;
  minimumWireComponentGap: number | null;
  minimumWireSpacing: number | null;
  componentPairsChecked: number;
  wireComponentPairsChecked: number;
  wirePairsChecked: number;
  netsConnected: number;
  netsAcyclic: number;
}

export interface ComponentAttributeDescription {
  name: string;
  type: string;
  default?: string;
  values?: string[];
  range?: number[];
  affectsGeometry?: boolean;
  notes?: string;
}

export interface ComponentCatalogDescription {
  library: string;
  name: string;
  summary: string;
  attributes: ComponentAttributeDescription[];
}

interface PortGeometry {
  id: string;
  offset: Point;
  escape: Facing;
  role: PortRole;
  width: number;
  required: boolean;
}

interface ComponentGeometry {
  bounds: Rect;
  footprint?: Rect;
  labelBounds?: Rect;
  ports: PortGeometry[];
  attributes: Record<string, string>;
}

interface ResolvedComponent extends LayoutComponentInput {
  geometry: ComponentGeometry;
}

interface Terminal {
  key: string;
  component: string;
  port: PortGeometry;
}

interface Net {
  id: string;
  driver: Terminal;
  sinks: Terminal[];
}

interface LayoutOptions {
  grid: number;
  componentClearance: number;
  wireClearance: number;
  wireSpacing: number;
  layerSpacing: number;
  rowSpacing: number;
  minimumDistance: number;
  maximumDistance: number;
  congestionRegionSize: number;
  congestionLimit: number;
  maxCandidates: number;
  maxAStarStates: number;
  weights: LayoutWeights;
}

interface UnitEdge {
  a: Point;
  b: Point;
  net: string;
}

interface RoutedLayout {
  wires: LayoutWirePlan[];
  unitEdges: UnitEdge[];
}

interface SearchBudget {
  used: number;
  limit: number;
}

const DEFAULT_REGION: Rect = { left: 20, top: 20, right: 1800, bottom: 1200 };
const DEFAULT_WEIGHTS: LayoutWeights = {
  length: 1,
  bends: 20,
  crossings: 100_000,
  overlap: 100_000,
  spacing: 2,
  alignment: 10,
  congestion: 8,
};
const GATE_NAMES = new Set(["AND Gate", "OR Gate", "XOR Gate", "NAND Gate", "NOR Gate", "XNOR Gate"]);
const DIRECTIONS: Array<{ facing: Facing; dx: number; dy: number }> = [
  { facing: "east", dx: 1, dy: 0 },
  { facing: "south", dx: 0, dy: 1 },
  { facing: "west", dx: -1, dy: 0 },
  { facing: "north", dx: 0, dy: -1 },
];
const FACING_ATTRIBUTE: ComponentAttributeDescription = { name: "facing", type: "enum", default: "east", values: ["east", "south", "west", "north"], affectsGeometry: true };
const WIDTH_ATTRIBUTE: ComponentAttributeDescription = { name: "width", type: "integer string", default: "1", range: [1, 64], affectsGeometry: true };
const LABEL_ATTRIBUTE: ComponentAttributeDescription = { name: "label", type: "string", default: "" };
const LABEL_FONT_ATTRIBUTE: ComponentAttributeDescription = { name: "labelfont", type: "Logisim font string" };
const LABEL_LOCATION_ATTRIBUTE: ComponentAttributeDescription = { name: "labelloc", type: "enum", values: ["north", "south", "east", "west", "center"] };
const LED_COLOR_ATTRIBUTE: ComponentAttributeDescription = { name: "color", type: "Java Color.decode or #RRGGBBAA", default: "#f00000" };
const SPLITTER_BIT_ATTRIBUTE: ComponentAttributeDescription = { name: "bitN", type: "dynamic enum string", values: ["none", "0..fanout-1"], affectsGeometry: true, notes: "Replace N with a canonical zero-based bit index below incoming." };
const COMPONENT_CATALOG: ComponentCatalogDescription[] = [
  {
    library: "0", name: "Pin", summary: "Circuit input driver or circuit output sink, including buses.",
    attributes: [FACING_ATTRIBUTE, WIDTH_ATTRIBUTE, { name: "type", type: "enum", default: "input", values: ["input", "output"], notes: "Output Pins are sinks inside the circuit." }, { name: "output", type: "legacy boolean string", values: ["true", "false"], notes: "Accepted as a legacy alias and canonicalized to type='output'." }, { name: "appearance", type: "enum", default: "NewPins", values: ["NewPins", "classic"], affectsGeometry: true }, { name: "radix", type: "enum", default: "2", values: ["2"], affectsGeometry: true }, { name: "behavior", type: "enum", default: "simple", values: ["simple", "tristate", "pulldown", "pullup"] }, { name: "initial", type: "hex string" }, LABEL_ATTRIBUTE, LABEL_FONT_ATTRIBUTE],
  },
  {
    library: "0", name: "Clock", summary: "One-bit periodic source for sequential circuits.",
    attributes: [FACING_ATTRIBUTE, { name: "highDuration", type: "integer string", default: "1", range: [1, 2_147_483_647] }, { name: "lowDuration", type: "integer string", default: "1", range: [1, 2_147_483_647] }, { name: "phaseOffset", type: "integer string", default: "0", range: [0, 2_147_483_647] }, { name: "appearance", type: "enum", default: "NewPins", values: ["NewPins", "classic"], affectsGeometry: true }, LABEL_ATTRIBUTE, LABEL_LOCATION_ATTRIBUTE, LABEL_FONT_ATTRIBUTE],
  },
  {
    library: "0", name: "Splitter", summary: "Decode-only bus splitter. Automatic layout supports legacy appearance only; native reverse-combine use is intentionally unsupported.",
    attributes: [FACING_ATTRIBUTE, { name: "fanout", type: "integer string", default: "2", range: [1, 64], affectsGeometry: true }, { name: "incoming", type: "integer string", default: "2", range: [1, 64], affectsGeometry: true }, { name: "appear", type: "enum", default: "left", values: ["left", "right", "center", "legacy"], affectsGeometry: true }, { name: "spacing", type: "integer string", default: "1", range: [1, 9], affectsGeometry: true }, SPLITTER_BIT_ATTRIBUTE],
  },
  {
    library: "5", name: "LED", summary: "One-bit indicator sink.",
    attributes: [{ ...FACING_ATTRIBUTE, default: "west" }, LED_COLOR_ATTRIBUTE, { name: "offcolor", type: "Java Color.decode or #RRGGBBAA", default: "#404040" }, { name: "active", type: "boolean string", default: "true", values: ["true", "false"] }, LABEL_ATTRIBUTE, { ...LABEL_LOCATION_ATTRIBUTE, default: "east" }, { ...LABEL_FONT_ATTRIBUTE, default: "SansSerif bold 16" }, { name: "labelcolor", type: "Java Color.decode or #RRGGBBAA", default: "#0000ff" }, { name: "labelvisible", type: "boolean string", default: "true", values: ["true", "false"] }],
  },
  ...[...GATE_NAMES].map((name): ComponentCatalogDescription => ({
    library: "1", name, summary: `${name} with configurable input count and bus width.`,
    attributes: [FACING_ATTRIBUTE, WIDTH_ATTRIBUTE, { name: "inputs", type: "integer string", default: "2", range: [2, 64], affectsGeometry: true }, { name: "size", type: "enum string", default: "50", values: ["30", "50", "70"], affectsGeometry: true }, { name: "negateN", type: "boolean string", default: "false", values: ["true", "false"], affectsGeometry: true, notes: "Replace N with a zero-based input index, for example negate0." }, { name: "out", type: "enum", default: "01", values: ["01", "0Z", "Z1"] }, ...(name.includes("XOR") ? [{ name: "xor", type: "enum", default: "1", values: ["1", "odd"] } satisfies ComponentAttributeDescription] : []), LABEL_ATTRIBUTE, LABEL_FONT_ATTRIBUTE],
  })),
  { library: "1", name: "NOT Gate", summary: "Configurable-width inverter.", attributes: [FACING_ATTRIBUTE, WIDTH_ATTRIBUTE, { name: "size", type: "enum string", default: "30", values: ["20", "30"], affectsGeometry: true }, { name: "out", type: "enum", default: "01", values: ["01", "0Z", "Z1"] }, LABEL_ATTRIBUTE, LABEL_FONT_ATTRIBUTE] },
  { library: "1", name: "Buffer", summary: "Configurable-width non-inverting buffer.", attributes: [FACING_ATTRIBUTE, WIDTH_ATTRIBUTE, { name: "out", type: "enum", default: "01", values: ["01", "0Z", "Z1"] }, LABEL_ATTRIBUTE, LABEL_FONT_ATTRIBUTE] },
  { library: "3", name: "Adder", summary: "Binary adder with carry input and output.", attributes: [{ ...WIDTH_ATTRIBUTE, default: "8" }] },
  { library: "4", name: "D Flip-Flop", summary: "One-bit D flip-flop with Q, inverted Q, reset, and preset.", attributes: [{ name: "trigger", type: "enum", default: "rising", values: ["rising", "falling", "high", "low"] }, { name: "appearance", type: "enum", default: "classic", values: ["classic", "evolution", "logisim_evolution"], affectsGeometry: true }, LABEL_ATTRIBUTE, LABEL_FONT_ATTRIBUTE] },
  { library: "4", name: "Register", summary: "Clocked or level-sensitive multi-bit register.", attributes: [{ ...WIDTH_ATTRIBUTE, default: "8" }, { name: "trigger", type: "enum", default: "rising", values: ["rising", "falling", "high", "low"] }, { name: "showInTab", type: "boolean string", default: "false", values: ["true", "false"] }, { name: "appearance", type: "enum", default: "classic", values: ["classic", "evolution", "logisim_evolution"], affectsGeometry: true }, LABEL_ATTRIBUTE, LABEL_LOCATION_ATTRIBUTE, LABEL_FONT_ATTRIBUTE] },
  { library: "4", name: "Counter", summary: "Configurable-width clocked counter with load, direction, enable, and carry.", attributes: [{ ...WIDTH_ATTRIBUTE, default: "8" }, { name: "max", type: "hex string", notes: "Defaults to the maximum value for width." }, { name: "ongoal", type: "enum", default: "wrap", values: ["wrap", "stay", "continue", "load"] }, { name: "trigger", type: "enum", default: "rising", values: ["rising", "falling"] }, { name: "appearance", type: "enum", default: "classic", values: ["classic", "evolution", "logisim_evolution"], affectsGeometry: true }, LABEL_ATTRIBUTE, LABEL_LOCATION_ATTRIBUTE, LABEL_FONT_ATTRIBUTE] },
].sort((left, right) => lexical(`${left.library}|${left.name}`, `${right.library}|${right.name}`));

export class LayoutError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LayoutError";
  }
}

function canonicalizeLegacyPinAttributes(attributes: Record<string, string>): void {
  for (const originalName of Object.keys(attributes)) {
    const name = originalName.toLowerCase();
    if (!["output", "type", "behavior", "tristate", "pull"].includes(name)) continue;
    const value = attributes[originalName]!;
    if (attributes[name] === undefined) attributes[name] = value.toLowerCase();
    if (originalName !== name) delete attributes[originalName];
  }
  if (attributes.behavior === undefined) {
    if (attributes.pull === "up") attributes.behavior = "pullup";
    else if (attributes.pull === "down") attributes.behavior = "pulldown";
    else if (attributes.tristate === "true") attributes.behavior = "tristate";
  }
  delete attributes.pull;
  delete attributes.tristate;
}

function validateCatalogAttributes(input: LayoutComponentInput, attributes: Record<string, string>): void {
  const description = COMPONENT_CATALOG.find((component) => component.library === input.library && component.name === input.name);
  if (!description) return;
  for (const [name, value] of Object.entries(attributes)) {
    let attribute = description.attributes.find((candidate) => candidate.name !== "negateN" && candidate.name === name);
    if (!attribute && /^negate\d+$/.test(name)) {
      const indexText = name.slice("negate".length);
      if (String(Number(indexText)) !== indexText) throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' must use a canonical zero-based index such as negate0`);
      attribute = description.attributes.find((candidate) => candidate.name === "negateN");
    }
    if (!attribute && input.library === "0" && input.name === "Splitter" && /^bit\d+$/.test(name)) {
      const indexText = name.slice("bit".length);
      if (String(Number(indexText)) !== indexText) throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' must use a canonical zero-based bit index such as bit0`);
      attribute = description.attributes.find((candidate) => candidate.name === "bitN");
    }
    if (!attribute) {
      throw new LayoutError("UNKNOWN_ATTRIBUTE", `Component ${input.library}:${input.name} does not define attribute '${name}'. Call logisim_describe_component for accepted names.`);
    }
    if (attribute.values && attribute.name !== "bitN" && !attribute.values.includes(value)) {
      throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' on ${input.name} must be one of ${attribute.values.join(", ")}; got '${value}'`);
    }
    if (attribute.range) {
      if (!/^-?\d+$/.test(value) || Number(value) < attribute.range[0]! || Number(value) > attribute.range[1]!) {
        throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' on ${input.name} must be an integer from ${attribute.range[0]} to ${attribute.range[1]}; got '${value}'`);
      }
    }
  }
}

function validateColor(value: string, name: string): void {
  // Logisim 4.0.0 Attributes.ColorAttribute parses #RRGGBBAA itself (RGBA),
  // then delegates every other spelling to Color.decode / Integer.decode.
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return;
  const match = /^([+-]?)(.*)$/.exec(value)!;
  const sign = match[1] === "-" ? -1n : 1n;
  const unsigned = match[2]!;
  let radix = 10;
  let digits = unsigned;
  if (unsigned.startsWith("0x") || unsigned.startsWith("0X")) {
    radix = 16;
    digits = unsigned.slice(2);
  } else if (unsigned.startsWith("#")) {
    radix = 16;
    digits = unsigned.slice(1);
  } else if (unsigned.length > 1 && unsigned.startsWith("0")) {
    radix = 8;
    digits = unsigned.slice(1);
  }
  const validDigits = radix === 16 ? /^[0-9a-fA-F]+$/ : radix === 8 ? /^[0-7]+$/ : /^(?:0|[1-9]\d*)$/;
  if (!validDigits.test(digits)) {
    throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' must be a bounded Java Color.decode value or #RRGGBBAA; got '${value}'`);
  }
  let magnitude = 0n;
  for (const digit of digits.toLowerCase()) magnitude = magnitude * BigInt(radix) + BigInt(parseInt(digit, radix));
  const decoded = sign * magnitude;
  if (decoded < -2_147_483_648n || decoded > 2_147_483_647n) {
    throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' is outside Java Integer.decode's signed 32-bit range; got '${value}'`);
  }
}

function defaultSplitterDistribution(fanout: number, incoming: number): number[] {
  const result: number[] = [];
  const perBranch = Math.floor(incoming / fanout);
  let extras = incoming % fanout;
  let branch = 0;
  let remaining = 0;
  for (let bit = 0; bit < incoming; bit += 1) {
    if (remaining === 0) {
      remaining = perBranch + (extras > 0 ? 1 : 0);
      if (extras > 0) extras -= 1;
      branch += 1;
    }
    result.push(branch - 1);
    remaining -= 1;
  }
  return result;
}

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function key(point: Point): string {
  return `${point.x},${point.y}`;
}

function parsePoint(value: string): Point {
  const parts = value.split(",");
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new LayoutError("INTERNAL", `Invalid point key '${value}'`);
  return { x, y };
}

function edgeKey(a: Point, b: Point): string {
  const left = key(a);
  const right = key(b);
  return lexical(left, right) <= 0 ? `${left}|${right}` : `${right}|${left}`;
}

function snapUp(value: number, grid: number): number {
  return Math.ceil(value / grid) * grid;
}

function snapDown(value: number, grid: number): number {
  return Math.floor(value / grid) * grid;
}

function onGrid(value: number, grid: number): boolean {
  return value % grid === 0;
}

function parseInteger(attributes: Record<string, string>, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = attributes[name];
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw)) throw new LayoutError("UNSUPPORTED_COMPONENT", `Attribute '${name}' must be an integer, got '${raw}'`);
  const value = Number(raw);
  if (value < minimum || value > maximum) {
    throw new LayoutError("UNSUPPORTED_COMPONENT", `Attribute '${name}' must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseFacing(attributes: Record<string, string>, fallback: Facing = "east"): Facing {
  const value = attributes.facing ?? fallback;
  if (value !== "east" && value !== "south" && value !== "west" && value !== "north") {
    throw new LayoutError("UNSUPPORTED_COMPONENT", `Unsupported facing '${value}'`);
  }
  return value;
}

function rotatePoint(point: Point, facing: Facing): Point {
  const negate = (value: number): number => value === 0 ? 0 : -value;
  if (facing === "south") return { x: negate(point.y), y: point.x };
  if (facing === "west") return { x: negate(point.x), y: negate(point.y) };
  if (facing === "north") return { x: point.y, y: negate(point.x) };
  return { ...point };
}

function rotateFacing(facing: Facing, orientation: Facing): Facing {
  const index = DIRECTIONS.findIndex((item) => item.facing === facing);
  const turns = DIRECTIONS.findIndex((item) => item.facing === orientation);
  return DIRECTIONS[(index + turns) % DIRECTIONS.length]!.facing;
}

function rotateRect(rect: Rect, facing: Facing): Rect {
  const points = [
    rotatePoint({ x: rect.left, y: rect.top }, facing),
    rotatePoint({ x: rect.left, y: rect.bottom }, facing),
    rotatePoint({ x: rect.right, y: rect.top }, facing),
    rotatePoint({ x: rect.right, y: rect.bottom }, facing),
  ];
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function unionRects(rectangles: Rect[]): Rect {
  return {
    left: Math.min(...rectangles.map((rect) => rect.left)),
    top: Math.min(...rectangles.map((rect) => rect.top)),
    right: Math.max(...rectangles.map((rect) => rect.right)),
    bottom: Math.max(...rectangles.map((rect) => rect.bottom)),
  };
}

function labelFontSize(attributes: Record<string, string>): number {
  const raw = attributes.labelfont;
  if (!raw) return 12;
  const match = /(\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (!match) return 12;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size < 1 || size > 1000) {
    throw new LayoutError("INVALID_ATTRIBUTE", "Label font size must be between 1 and 1000 for automatic layout");
  }
  return size;
}

function addVisibleFootprint(geometry: ComponentGeometry, component: LayoutComponentInput): void {
  const label = geometry.attributes.label ?? "";
  if (label.length === 0 || geometry.attributes.labelvisible === "false") {
    geometry.footprint = { ...geometry.bounds };
    delete geometry.labelBounds;
    return;
  }
  const fontSize = labelFontSize(geometry.attributes);
  const glyphs = Math.max(1, [...label].length);
  // A deliberately conservative em box keeps font and italic overhangs inside the footprint.
  const width = Math.ceil(glyphs * fontSize * 1.25 + 8);
  const height = Math.ceil(fontSize * 1.25 + 4);
  const gap = 2;
  let centerX = (geometry.bounds.left + geometry.bounds.right) / 2;
  let centerY = (geometry.bounds.top + geometry.bounds.bottom) / 2;
  let centerPadding = 0;
  const pinEscape = geometry.ports[0]?.escape ?? "east";
  const oppositePinFacing = DIRECTIONS[(DIRECTIONS.findIndex((direction) => direction.facing === pinEscape) + 2) % DIRECTIONS.length]!.facing;
  const defaultLocation = component.library === "0" && component.name === "Pin"
    ? oppositePinFacing
    : component.library === "0" && component.name === "Clock"
      ? "west"
      : component.library === "1" && GATE_NAMES.has(component.name) ? "center"
        : component.library === "5" && component.name === "LED" ? "east" : "north";
  const location = geometry.attributes.labelloc ?? defaultLocation;
  if (component.library === "1" && GATE_NAMES.has(component.name)) {
    const size = Number(component.attributes?.size ?? "50");
    const outputNegated = component.name === "NAND Gate" || component.name === "NOR Gate" || component.name === "XNOR Gate";
    const distance = size / 2 + (outputNegated ? 10 : 0);
    const facing = geometry.ports.find((port) => port.id === "out")!.escape;
    centerX = facing === "east" ? -distance : facing === "west" ? distance : 0;
    centerY = facing === "north" ? distance : facing === "south" ? -distance : 0;
    // Logisim's global rectangular-gate style shifts this anchor by six units.
    centerPadding = 6;
  }
  let labelBounds: Rect;
  if (location === "south") {
    labelBounds = { left: centerX - width / 2, top: geometry.bounds.bottom + gap, right: centerX + width / 2, bottom: geometry.bounds.bottom + gap + height };
  } else if (location === "east") {
    labelBounds = { left: geometry.bounds.right + gap, top: centerY - height / 2, right: geometry.bounds.right + gap + width, bottom: centerY + height / 2 };
  } else if (location === "west") {
    labelBounds = { left: geometry.bounds.left - gap - width, top: centerY - height / 2, right: geometry.bounds.left - gap, bottom: centerY + height / 2 };
  } else if (location === "center") {
    labelBounds = { left: centerX - width / 2 - centerPadding, top: centerY - height / 2 - centerPadding, right: centerX + width / 2 + centerPadding, bottom: centerY + height / 2 + centerPadding };
  } else {
    labelBounds = { left: centerX - width / 2, top: geometry.bounds.top - gap - height, right: centerX + width / 2, bottom: geometry.bounds.top - gap };
  }
  geometry.labelBounds = labelBounds;
  geometry.footprint = unionRects([geometry.bounds, labelBounds]);
}

function orientGeometry(geometry: ComponentGeometry, facing: Facing): ComponentGeometry {
  return {
    bounds: rotateRect(geometry.bounds, facing),
    ports: geometry.ports.map((port) => ({
      ...port,
      offset: rotatePoint(port.offset, facing),
      escape: rotateFacing(port.escape, facing),
    })),
    attributes: { ...geometry.attributes, facing },
  };
}

function gateInputOffset(inputs: number, size: number, index: number): number {
  let skipStart: number;
  let skipDistance: number;
  let skipLowerEven: number;
  if (inputs <= 3) {
    if (size < 40) [skipStart, skipDistance, skipLowerEven] = [-5, 10, 10];
    else if (size < 60 || inputs <= 2) [skipStart, skipDistance, skipLowerEven] = [-10, 20, 20];
    else [skipStart, skipDistance, skipLowerEven] = [-15, 30, 30];
  } else if (inputs === 4 && size >= 60) {
    [skipStart, skipDistance, skipLowerEven] = [-5, 20, 0];
  } else {
    [skipStart, skipDistance, skipLowerEven] = [-5, 10, 10];
  }
  if (inputs % 2 === 1) return skipStart * (inputs - 1) + skipDistance * index;
  let offset = skipStart * inputs + skipDistance * index;
  if (index >= inputs / 2) offset += skipLowerEven;
  if (inputs === 4 && size >= 60) offset -= 10;
  return offset;
}

function resolveComponent(input: LayoutComponentInput): ResolvedComponent {
  const attributes = { ...(input.attributes ?? {}) };
  if (input.library === "0" && input.name === "Pin") canonicalizeLegacyPinAttributes(attributes);
  validateCatalogAttributes(input, attributes);
  const width = parseInteger(attributes, "width", ["Adder", "Register", "Counter"].includes(input.name) ? 8 : 1, 1, 64);
  let facing = parseFacing(attributes, input.library === "5" && input.name === "LED" ? "west" : "east");
  let geometry: ComponentGeometry;
  let supportsFacing = true;
  let gateInputOffsets: Point[] | null = null;
  let classicPinDimensions: { width: number; height: number } | null = null;

  if (input.library === "0" && input.name === "Pin") {
    if (attributes.radix !== undefined && attributes.radix !== "2") {
      throw new LayoutError("UNSUPPORTED_COMPONENT", "The layout catalog currently supports binary Pin radix only");
    }
    if (attributes.type !== undefined && attributes.type !== "input" && attributes.type !== "output") {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Pin type must be input or output, got '${attributes.type}'`);
    }
    if (attributes.output !== undefined && attributes.output !== "true" && attributes.output !== "false") {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Legacy Pin output must be true or false, got '${attributes.output}'`);
    }
    if (attributes.type === "input" && attributes.output === "true") {
      throw new LayoutError("UNSUPPORTED_COMPONENT", "Pin type='input' conflicts with legacy output='true'");
    }
    const isOutput = attributes.type === "output" || attributes.output === "true";
    const role: PortRole = isOutput ? "sink" : "driver";
    if (isOutput && attributes.facing === undefined) facing = "west";
    delete attributes.output;
    if (isOutput) attributes.type = "output";
    const rows = Math.ceil(width / 8);
    let bodyWidth = width < 2 ? 20 : width >= 8 ? 80 : width * 10;
    const bodyHeight = rows < 2 ? 20 : Math.min(rows, 8) * 20;
    const appearance = attributes.appearance ?? "NewPins";
    if (appearance !== "NewPins" && appearance !== "classic") {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Unsupported Pin appearance '${appearance}'`);
    }
    if (appearance === "NewPins") bodyWidth += width === 1 ? 20 : 25;
    bodyWidth = Math.ceil(bodyWidth / 10) * 10;
    if (appearance === "classic") classicPinDimensions = { width: bodyWidth, height: bodyHeight };
    attributes.appearance ??= "NewPins";
    if (width === 1) delete attributes.width;
    if (attributes.type === "input") delete attributes.type;
    if (attributes.radix === "2") delete attributes.radix;
    delete attributes.labelloc;
    geometry = {
      bounds: { left: -bodyWidth, top: -bodyHeight / 2, right: 0, bottom: bodyHeight / 2 },
      ports: [{ id: "port", offset: { x: 0, y: 0 }, escape: "east", role, width, required: true }],
      attributes,
    };
  } else if (input.library === "0" && input.name === "Clock") {
    const appearance = attributes.appearance ?? "NewPins";
    if (appearance !== "NewPins" && appearance !== "classic") {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Unsupported Clock appearance '${appearance}'`);
    }
    for (const [name, fallback, minimum] of [["highDuration", 1, 1], ["lowDuration", 1, 1], ["phaseOffset", 0, 0]] as const) {
      parseInteger(attributes, name, fallback, minimum, 2_147_483_647);
    }
    attributes.appearance = appearance;
    if ((attributes.label ?? "").length > 0 && attributes.labelloc === undefined) attributes.labelloc = "north";
    let bodyWidth = 20;
    if (appearance === "NewPins") bodyWidth += 20;
    geometry = {
      bounds: { left: -bodyWidth, top: -10, right: 0, bottom: 10 },
      ports: [{ id: "out", offset: { x: 0, y: 0 }, escape: "east", role: "driver", width: 1, required: true }],
      attributes,
    };
  } else if (input.library === "0" && input.name === "Splitter") {
    const fanout = parseInteger(attributes, "fanout", 2, 2, 8);
    const incoming = parseInteger(attributes, "incoming", 2, 1, 64);
    const spacing = parseInteger(attributes, "spacing", 1, 1, 9);
    const appear = attributes.appear ?? "left";
    if (appear !== "legacy") {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Automatic layout supports Splitter appear='legacy' only; got '${appear}'`);
    }
    const mappings: number[] = [];
    for (const name of Object.keys(attributes)) {
      const match = /^bit(\d+)$/.exec(name);
      if (match && Number(match[1]) >= incoming) throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' refers to a bit outside incoming=${incoming}`);
    }
    for (let bit = 0; bit < incoming; bit += 1) {
      const value = attributes[`bit${bit}`];
      if (value === undefined) throw new LayoutError("INVALID_ATTRIBUTE", `Splitter requires an explicit assignment for bit${bit}`);
      if (value === "none") throw new LayoutError("UNSUPPORTED_COMPONENT", `Splitter bit${bit}='none' is not supported by decode-only automatic layout`);
      if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) >= fanout) {
        throw new LayoutError("INVALID_ATTRIBUTE", `Splitter bit${bit} must be a branch from 0 to ${fanout - 1}; got '${value}'`);
      }
      mappings.push(Number(value));
    }
    const widths = Array.from({ length: fanout }, () => 0);
    mappings.forEach((branch) => { widths[branch]! += 1; });
    const empty = widths.findIndex((width) => width === 0);
    if (empty >= 0) throw new LayoutError("UNSUPPORTED_COMPONENT", `Splitter branch ${empty} has no assigned bits; every decode branch must be nonempty`);
    const gap = 10 * spacing;
    const first = Math.floor(fanout / 2);
    const offsets = facing === "east" ? Array.from({ length: fanout }, (_, index) => ({ x: 20, y: -gap * first + gap * index }))
      : facing === "west" ? Array.from({ length: fanout }, (_, index) => ({ x: -20, y: -gap * first + gap * index }))
        : facing === "north" ? Array.from({ length: fanout }, (_, index) => ({ x: gap * (Math.floor((fanout + 1) / 2) - 1) - gap * index, y: -20 }))
          : Array.from({ length: fanout }, (_, index) => ({ x: gap * (Math.floor((fanout + 1) / 2) - 1) - gap * index, y: 20 }));
    const allPoints = [{ x: 0, y: 0 }, ...offsets];
    geometry = {
      bounds: { left: Math.min(...allPoints.map((point) => point.x)), top: Math.min(...allPoints.map((point) => point.y)), right: Math.max(...allPoints.map((point) => point.x)), bottom: Math.max(...allPoints.map((point) => point.y)) },
      ports: [
        { id: "bus", offset: { x: 0, y: 0 }, escape: rotateFacing("west", facing), role: "sink", width: incoming, required: true },
        ...offsets.map((offset, index): PortGeometry => ({ id: `out${index}`, offset, escape: facing, role: "driver", width: widths[index]!, required: true })),
      ],
      attributes,
    };
    supportsFacing = false;
  } else if (input.library === "5" && input.name === "LED") {
    for (const name of ["color", "offcolor", "labelcolor"] as const) if (attributes[name] !== undefined) validateColor(attributes[name]!, name);
    for (const name of ["active", "labelvisible"] as const) {
      if (attributes[name] !== undefined && attributes[name] !== "true" && attributes[name] !== "false") {
        throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${name}' on LED must be true or false; got '${attributes[name]}'`);
      }
    }
    geometry = {
      bounds: { left: -20, top: -10, right: 0, bottom: 10 },
      ports: [{ id: "in", offset: { x: 0, y: 0 }, escape: "east", role: "sink", width: 1, required: true }],
      attributes,
    };
  } else if (input.library === "1" && GATE_NAMES.has(input.name)) {
    const inputs = parseInteger(attributes, "inputs", 2, 2, 64);
    const size = parseInteger(attributes, "size", 50, 30, 70);
    if (![30, 50, 70].includes(size)) throw new LayoutError("UNSUPPORTED_COMPONENT", "Gate size must be 30, 50, or 70");
    const outputNegated = input.name === "NAND Gate" || input.name === "NOR Gate" || input.name === "XNOR Gate";
    const xorBonus = input.name === "XOR Gate" || input.name === "XNOR Gate" ? 10 : 0;
    const inputNegated = Array.from({ length: inputs }, (_, index) => attributes[`negate${index}`] === "true");
    for (let index = 0; index < inputs; index += 1) {
      const value = attributes[`negate${index}`];
      if (value !== undefined && value !== "true" && value !== "false") {
        throw new LayoutError("UNSUPPORTED_COMPONENT", `Attribute 'negate${index}' must be true or false`);
      }
    }
    for (const attributeName of Object.keys(attributes)) {
      const match = /^negate(\d+)$/.exec(attributeName);
      if (match && Number(match[1]) >= inputs) {
        throw new LayoutError("INVALID_ATTRIBUTE", `Attribute '${attributeName}' refers to an input outside the configured inputs=${inputs}`);
      }
    }
    const axisLength = size + xorBonus + (outputNegated ? 10 : 0);
    const bodyWidth = axisLength + (inputNegated.some(Boolean) ? 10 : 0);
    const oddInputs = inputs % 2 === 0 ? inputs + 1 : inputs;
    const bodyHeight = Math.max(10 * oddInputs, size);
    if (width === 1) delete attributes.width;
    if (inputs === 2) delete attributes.inputs;
    if (size === 50) delete attributes.size;
    gateInputOffsets = Array.from({ length: inputs }, (_, index) => ({
      x: -(axisLength + (inputNegated[index] ? 10 : 0)),
      y: gateInputOffset(inputs, size, index),
    }));
    geometry = {
      bounds: { left: -bodyWidth, top: -bodyHeight / 2, right: 0, bottom: bodyHeight / 2 },
      ports: [
        { id: "out", offset: { x: 0, y: 0 }, escape: "east", role: "driver", width, required: true },
        ...gateInputOffsets.map((offset, index): PortGeometry => ({
          id: `in${index}`,
          offset,
          escape: "west",
          role: "sink",
          width,
          required: true,
        })),
      ],
      attributes,
    };
  } else if (input.library === "1" && (input.name === "NOT Gate" || input.name === "Buffer")) {
    const size = input.name === "Buffer" ? 20 : parseInteger(attributes, "size", 30, 20, 30);
    if (input.name === "NOT Gate" && size !== 20 && size !== 30) {
      throw new LayoutError("UNSUPPORTED_COMPONENT", "NOT Gate size must be 20 or 30");
    }
    if (width === 1) delete attributes.width;
    if (input.name === "NOT Gate" && size === 30) delete attributes.size;
    geometry = {
      bounds: { left: -size, top: -9, right: 0, bottom: 9 },
      ports: [
        { id: "out", offset: { x: 0, y: 0 }, escape: "east", role: "driver", width, required: true },
        { id: "in", offset: { x: -size, y: 0 }, escape: "west", role: "sink", width, required: true },
      ],
      attributes,
    };
  } else if (input.library === "3" && input.name === "Adder") {
    if (attributes.facing !== undefined) throw new LayoutError("UNSUPPORTED_COMPONENT", "Logisim's Adder does not expose a facing attribute");
    supportsFacing = false;
    if (width === 8) delete attributes.width;
    geometry = {
      bounds: { left: -40, top: -20, right: 0, bottom: 20 },
      ports: [
        { id: "a", offset: { x: -40, y: -10 }, escape: "west", role: "sink", width, required: true },
        { id: "b", offset: { x: -40, y: 10 }, escape: "west", role: "sink", width, required: true },
        { id: "sum", offset: { x: 0, y: 0 }, escape: "east", role: "driver", width, required: true },
        { id: "cin", offset: { x: -20, y: -20 }, escape: "north", role: "sink", width: 1, required: false },
        { id: "cout", offset: { x: -20, y: 20 }, escape: "south", role: "driver", width: 1, required: false },
      ],
      attributes,
    };
  } else if (input.library === "4" && input.name === "D Flip-Flop") {
    if (attributes.facing !== undefined) throw new LayoutError("UNSUPPORTED_COMPONENT", "D Flip-Flop does not expose a facing attribute");
    supportsFacing = false;
    const appearance = attributes.appearance ?? "classic";
    if (!new Set(["classic", "evolution", "logisim_evolution"]).has(appearance)) {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Unsupported D Flip-Flop appearance '${appearance}'`);
    }
    attributes.appearance = appearance;
    const classic = appearance === "classic";
    geometry = classic ? {
      bounds: { left: -40, top: -10, right: 0, bottom: 30 },
      ports: [
        { id: "d", offset: { x: -40, y: 20 }, escape: "west", role: "sink", width: 1, required: true },
        { id: "clock", offset: { x: -40, y: 0 }, escape: "west", role: "sink", width: 1, required: true },
        { id: "q", offset: { x: 0, y: 0 }, escape: "east", role: "driver", width: 1, required: true },
        { id: "notq", offset: { x: 0, y: 20 }, escape: "east", role: "driver", width: 1, required: false },
        { id: "reset", offset: { x: -10, y: 30 }, escape: "south", role: "sink", width: 1, required: false },
        { id: "preset", offset: { x: -30, y: 30 }, escape: "south", role: "sink", width: 1, required: false },
      ],
      attributes,
    } : {
      bounds: { left: -10, top: 0, right: 50, bottom: 60 },
      ports: [
        { id: "d", offset: { x: -10, y: 10 }, escape: "west", role: "sink", width: 1, required: true },
        { id: "clock", offset: { x: -10, y: 50 }, escape: "west", role: "sink", width: 1, required: true },
        { id: "q", offset: { x: 50, y: 10 }, escape: "east", role: "driver", width: 1, required: true },
        { id: "notq", offset: { x: 50, y: 50 }, escape: "east", role: "driver", width: 1, required: false },
        { id: "reset", offset: { x: 20, y: 60 }, escape: "south", role: "sink", width: 1, required: false },
        { id: "preset", offset: { x: 20, y: 0 }, escape: "north", role: "sink", width: 1, required: false },
      ],
      attributes,
    };
  } else if (input.library === "4" && input.name === "Register") {
    if (attributes.facing !== undefined) throw new LayoutError("UNSUPPORTED_COMPONENT", "Register does not expose a facing attribute");
    supportsFacing = false;
    const appearance = attributes.appearance ?? "classic";
    if (!new Set(["classic", "evolution", "logisim_evolution"]).has(appearance)) {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Unsupported Register appearance '${appearance}'`);
    }
    attributes.appearance = appearance;
    if (width === 8) delete attributes.width;
    const classic = appearance === "classic";
    geometry = classic ? {
      bounds: { left: -30, top: -20, right: 0, bottom: 20 },
      ports: [
        { id: "q", offset: { x: 0, y: 0 }, escape: "east", role: "driver", width, required: true },
        { id: "d", offset: { x: -30, y: 0 }, escape: "west", role: "sink", width, required: true },
        { id: "clock", offset: { x: -20, y: 20 }, escape: "south", role: "sink", width: 1, required: true },
        { id: "clear", offset: { x: -10, y: 20 }, escape: "south", role: "sink", width: 1, required: false },
        { id: "enable", offset: { x: -30, y: 10 }, escape: "west", role: "sink", width: 1, required: false },
      ],
      attributes,
    } : {
      bounds: { left: 0, top: 0, right: 60, bottom: 90 },
      ports: [
        { id: "q", offset: { x: 60, y: 30 }, escape: "east", role: "driver", width, required: true },
        { id: "d", offset: { x: 0, y: 30 }, escape: "west", role: "sink", width, required: true },
        { id: "clock", offset: { x: 0, y: 70 }, escape: "west", role: "sink", width: 1, required: true },
        { id: "clear", offset: { x: 30, y: 90 }, escape: "south", role: "sink", width: 1, required: false },
        { id: "enable", offset: { x: 0, y: 50 }, escape: "west", role: "sink", width: 1, required: false },
      ],
      attributes,
    };
  } else if (input.library === "4" && input.name === "Counter") {
    if (attributes.facing !== undefined) throw new LayoutError("UNSUPPORTED_COMPONENT", "Counter does not expose a facing attribute");
    supportsFacing = false;
    const appearance = attributes.appearance ?? "classic";
    if (!new Set(["classic", "evolution", "logisim_evolution"]).has(appearance)) {
      throw new LayoutError("UNSUPPORTED_COMPONENT", `Unsupported Counter appearance '${appearance}'`);
    }
    attributes.appearance = appearance;
    if (attributes.max === undefined && width !== 8) attributes.max = `0x${((1n << BigInt(width)) - 1n).toString(16)}`;
    if (width === 8) delete attributes.width;
    const classic = appearance === "classic";
    if (classic) {
      geometry = {
        bounds: { left: -30, top: -20, right: 0, bottom: 20 },
        ports: [
          { id: "q", offset: { x: 0, y: 0 }, escape: "east", role: "driver", width, required: true },
          { id: "data", offset: { x: -30, y: 0 }, escape: "west", role: "sink", width, required: false },
          { id: "clock", offset: { x: -20, y: 20 }, escape: "south", role: "sink", width: 1, required: true },
          { id: "clear", offset: { x: -10, y: 20 }, escape: "south", role: "sink", width: 1, required: false },
          { id: "load", offset: { x: -30, y: -10 }, escape: "west", role: "sink", width: 1, required: false },
          { id: "updown", offset: { x: -20, y: -20 }, escape: "north", role: "sink", width: 1, required: false },
          { id: "enable", offset: { x: -30, y: 10 }, escape: "west", role: "sink", width: 1, required: false },
          { id: "carry", offset: { x: 0, y: 10 }, escape: "east", role: "driver", width: 1, required: false },
        ],
        attributes,
      };
    } else {
      const symbolWidth = 150 + Math.trunc((width - 8) / 5) * 10;
      const right = symbolWidth + 40;
      const dataY = width === 1 ? 120 : 110;
      geometry = {
        bounds: { left: 0, top: 0, right, bottom: 110 + 20 * width },
        ports: [
          { id: "q", offset: { x: right, y: dataY }, escape: "east", role: "driver", width, required: true },
          { id: "data", offset: { x: 0, y: dataY }, escape: "west", role: "sink", width, required: false },
          { id: "clock", offset: { x: 0, y: 80 }, escape: "west", role: "sink", width: 1, required: true },
          { id: "clear", offset: { x: 0, y: 20 }, escape: "west", role: "sink", width: 1, required: false },
          { id: "load", offset: { x: 0, y: 30 }, escape: "west", role: "sink", width: 1, required: false },
          { id: "updown", offset: { x: 0, y: 50 }, escape: "west", role: "sink", width: 1, required: false },
          { id: "enable", offset: { x: 0, y: 70 }, escape: "west", role: "sink", width: 1, required: false },
          { id: "carry", offset: { x: right, y: 50 }, escape: "east", role: "driver", width: 1, required: false },
        ],
        attributes,
      };
    }
  } else {
    throw new LayoutError("UNSUPPORTED_COMPONENT", `No verified geometry for library ${input.library} component '${input.name}'`);
  }

  if (supportsFacing && facing !== "east") geometry = orientGeometry(geometry, facing);
  else if (supportsFacing) delete geometry.attributes.facing;
  if (classicPinDimensions && (facing === "south" || facing === "north")) {
    geometry.bounds = {
      left: -classicPinDimensions.width / 2,
      top: facing === "south" ? -classicPinDimensions.height : 0,
      right: classicPinDimensions.width / 2,
      bottom: facing === "south" ? 0 : classicPinDimensions.height,
    };
  }
  if (gateInputOffsets && facing !== "east") {
    gateInputOffsets.forEach((offset, index) => {
      const distance = -offset.x;
      const corrected = facing === "south" ? { x: offset.y, y: -distance }
        : facing === "west" ? { x: distance, y: offset.y }
          : { x: offset.y, y: distance };
      geometry.ports.find((port) => port.id === `in${index}`)!.offset = corrected;
    });
  }
  const catalogDescription = COMPONENT_CATALOG.find((component) => component.library === input.library && component.name === input.name);
  if (input.library === "0" && input.name === "Splitter") {
    const fanout = Number(attributes.fanout ?? "2");
    const incoming = Number(attributes.incoming ?? "2");
    defaultSplitterDistribution(fanout, incoming).forEach((branch, bit) => {
      if (geometry.attributes[`bit${bit}`] === String(branch)) delete geometry.attributes[`bit${bit}`];
    });
  }
  for (const attribute of catalogDescription?.attributes ?? []) {
    if (attribute.name === "appearance" || attribute.name === "negateN" || attribute.default === undefined) continue;
    if (geometry.attributes[attribute.name] === attribute.default) delete geometry.attributes[attribute.name];
  }
  addVisibleFootprint(geometry, input);
  return { ...input, attributes: geometry.attributes, geometry };
}

export function listLayoutComponents(): ComponentCatalogDescription[] {
  return COMPONENT_CATALOG.map((component) => ({
    ...component,
    attributes: component.attributes.map((attribute) => ({ ...attribute, values: attribute.values ? [...attribute.values] : undefined })),
  }));
}

export function describeLayoutComponent(library: string, name: string, attributes: Record<string, string> = {}): Record<string, unknown> {
  const description = COMPONENT_CATALOG.find((component) => component.library === library && component.name === name);
  if (!description) {
    return {
      supported: false,
      library,
      name,
      message: `No source-verified layout geometry is available for library ${library} component '${name}'`,
      supportedComponents: COMPONENT_CATALOG.map((component) => ({ library: component.library, name: component.name })),
    };
  }
  const resolved = resolveComponent({ id: "component", library, name, attributes });
  return {
    supported: true,
    sourceVersion: "Logisim-evolution 4.0.0",
    library,
    name,
    summary: description.summary,
    attributes: description.attributes,
    requestedAttributes: attributes,
    effectiveAttributes: resolved.geometry.attributes,
    boundsRelativeToAnchor: resolved.geometry.bounds,
    footprintRelativeToAnchor: resolved.geometry.footprint,
    labelBoundsRelativeToAnchor: resolved.geometry.labelBounds ?? null,
    ports: resolved.geometry.ports.map((port) => ({
      id: port.id,
      role: port.role,
      width: port.width,
      required: port.required,
      offsetFromAnchor: port.offset,
      escape: port.escape,
    })),
    notes: [
      "Component loc is the anchor, not necessarily the center.",
      "Input Pins drive the circuit; Pins with type='output' are circuit sinks.",
      "Automatic layout includes a conservative label box in placement and routing clearance checks.",
    ],
  };
}

export function canonicalizeLayoutComponentAttributes(library: string, name: string, attributes: Record<string, string> = {}): Record<string, string> | null {
  if (!COMPONENT_CATALOG.some((component) => component.library === library && component.name === name)) return null;
  return { ...resolveComponent({ id: "component", library, name, attributes }).geometry.attributes };
}

export function canonicalizeComponentAttributesForWrite(library: string, name: string, attributes: Record<string, string> = {}): Record<string, string> {
  if ((library === "5" && name === "LED") || (library === "0" && name === "Splitter")) {
    return { ...resolveComponent({ id: "component", library, name, attributes }).geometry.attributes };
  }
  const result = { ...attributes };
  if (library === "0" && name === "Pin") {
    canonicalizeLegacyPinAttributes(result);
    if (result.type === undefined && result.output === "true") result.type = "output";
    delete result.output;
    result.appearance ??= "NewPins";
    if (result.type === "output" && result.facing === undefined) result.facing = "west";
  } else if (library === "0" && name === "Clock") {
    result.appearance ??= "NewPins";
  } else if (library === "4" && ["D Flip-Flop", "Register", "Counter"].includes(name)) {
    result.appearance ??= "classic";
    if (name === "Counter" && result.max === undefined && result.width !== undefined && /^\d+$/.test(result.width)) {
      const width = Number(result.width);
      if (width >= 1 && width <= 64 && width !== 8) result.max = `0x${((1n << BigInt(width)) - 1n).toString(16)}`;
    }
  }
  return result;
}

function normalizedOptions(input: LayoutOptionsInput = {}): LayoutOptions {
  const integer = (value: number | undefined, fallback: number, name: string, minimum: number, maximum: number): number => {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < minimum || result > maximum) {
      throw new LayoutError("INVALID_OPTIONS", `${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return result;
  };
  const weights = { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) };
  for (const [name, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
      throw new LayoutError("INVALID_OPTIONS", `Weight '${name}' must be between 0 and 1000000`);
    }
  }
  const grid = integer(input.grid, 10, "grid", 5, 100);
  const options: LayoutOptions = {
    grid,
    componentClearance: integer(input.componentClearance, 30, "componentClearance", 0, 500),
    wireClearance: integer(input.wireClearance, 10, "wireClearance", 0, 200),
    wireSpacing: integer(input.wireSpacing, grid, "wireSpacing", 0, 200),
    layerSpacing: integer(input.layerSpacing, 80, "layerSpacing", 10, 1000),
    rowSpacing: integer(input.rowSpacing, 40, "rowSpacing", 10, 1000),
    minimumDistance: integer(input.minimumDistance, 80, "minimumDistance", 0, 2000),
    maximumDistance: integer(input.maximumDistance, 260, "maximumDistance", 1, 4000),
    congestionRegionSize: integer(input.congestionRegionSize, 60, "congestionRegionSize", 10, 500),
    congestionLimit: integer(input.congestionLimit, 4, "congestionLimit", 1, 100),
    maxCandidates: integer(input.maxCandidates, 6, "maxCandidates", 1, 12),
    maxAStarStates: integer(input.maxAStarStates, 500_000, "maxAStarStates", 1000, 1_000_000),
    weights,
  };
  if (options.maximumDistance < options.minimumDistance) {
    throw new LayoutError("INVALID_OPTIONS", "maximumDistance must be at least minimumDistance");
  }
  for (const name of ["componentClearance", "wireClearance", "wireSpacing", "layerSpacing", "rowSpacing"] as const) {
    if (options[name] % options.grid !== 0) throw new LayoutError("INVALID_OPTIONS", `${name} must be a multiple of grid`);
  }
  return options;
}

function validateRegion(region: Rect, grid: number): Rect {
  for (const [name, value] of Object.entries(region)) {
    if (!Number.isInteger(value) || Math.abs(value) > 1_000_000) {
      throw new LayoutError("INVALID_REGION", `Region '${name}' must be an integer coordinate`);
    }
  }
  if (region.right <= region.left || region.bottom <= region.top) throw new LayoutError("INVALID_REGION", "Region must have positive width and height");
  const columns = Math.floor((region.right - region.left) / grid) + 1;
  const rows = Math.floor((region.bottom - region.top) / grid) + 1;
  if (columns * rows > 150_000) throw new LayoutError("INVALID_REGION", "Routing region contains more than 150000 grid points");
  return { ...region };
}

function terminalKey(endpoint: LayoutEndpointInput): string {
  return `${endpoint.component}.${endpoint.port}`;
}

function validateGraph(components: ResolvedComponent[], connections: LayoutConnectionInput[]): { nets: Net[]; adjacency: Map<string, Set<string>> } {
  const componentMap = new Map<string, ResolvedComponent>();
  for (const component of components) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(component.id)) throw new LayoutError("INVALID_GRAPH", `Invalid component id '${component.id}'`);
    if (componentMap.has(component.id)) throw new LayoutError("INVALID_GRAPH", `Duplicate component id '${component.id}'`);
    componentMap.set(component.id, component);
  }
  const portMap = new Map<string, Terminal>();
  for (const component of components) {
    for (const port of component.geometry.ports) {
      const terminal: Terminal = { key: `${component.id}.${port.id}`, component: component.id, port };
      portMap.set(terminal.key, terminal);
    }
  }
  const netParts = new Map<string, { drivers: Map<string, Terminal>; sinks: Map<string, Terminal> }>();
  const portOwners = new Map<string, string>();
  const edgeIds = new Set<string>();
  const adjacency = new Map(components.map((component) => [component.id, new Set<string>()]));
  for (const connection of connections) {
    const fromKey = terminalKey(connection.from);
    const toKey = terminalKey(connection.to);
    const from = portMap.get(fromKey);
    const to = portMap.get(toKey);
    if (!from) throw new LayoutError("INVALID_GRAPH", `Unknown source port '${fromKey}'`);
    if (!to) throw new LayoutError("INVALID_GRAPH", `Unknown destination port '${toKey}'`);
    if (from.port.role !== "driver") throw new LayoutError("INVALID_GRAPH", `Source '${fromKey}' is not a driver port`);
    if (to.port.role !== "sink") throw new LayoutError("INVALID_GRAPH", `Destination '${toKey}' is not a sink port`);
    if (from.port.width !== to.port.width) throw new LayoutError("INVALID_GRAPH", `Width mismatch from '${fromKey}' (${from.port.width}) to '${toKey}' (${to.port.width})`);
    if (from.component === to.component && from.port.id === to.port.id) throw new LayoutError("INVALID_GRAPH", `Connection '${fromKey}' cannot target itself`);
    const netId = connection.net ?? fromKey;
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]{0,99}$/.test(netId)) throw new LayoutError("INVALID_GRAPH", `Invalid net id '${netId}'`);
    const edgeId = `${netId}|${fromKey}|${toKey}`;
    if (edgeIds.has(edgeId)) throw new LayoutError("INVALID_GRAPH", `Duplicate connection '${fromKey}' to '${toKey}'`);
    edgeIds.add(edgeId);
    const group = netParts.get(netId) ?? { drivers: new Map(), sinks: new Map() };
    group.drivers.set(fromKey, from);
    group.sinks.set(toKey, to);
    netParts.set(netId, group);
    for (const terminal of [from, to]) {
      const owner = portOwners.get(terminal.key);
      if (owner && owner !== netId) throw new LayoutError("INVALID_GRAPH", `Port '${terminal.key}' belongs to both '${owner}' and '${netId}'`);
      portOwners.set(terminal.key, netId);
    }
    adjacency.get(from.component)!.add(to.component);
    adjacency.get(to.component)!.add(from.component);
  }
  for (const terminal of portMap.values()) {
    if (terminal.port.required && !portOwners.has(terminal.key)) throw new LayoutError("INVALID_GRAPH", `Required port '${terminal.key}' is not connected`);
  }
  const nets = [...netParts.entries()].sort(([left], [right]) => lexical(left, right)).map(([id, group]): Net => {
    if (group.drivers.size !== 1) throw new LayoutError("INVALID_GRAPH", `Net '${id}' must have exactly one driver, found ${group.drivers.size}`);
    if (group.sinks.size < 1) throw new LayoutError("INVALID_GRAPH", `Net '${id}' must have at least one sink`);
    return {
      id,
      driver: [...group.drivers.values()][0]!,
      sinks: [...group.sinks.values()].sort((left, right) => lexical(left.key, right.key)),
    };
  });
  if (components.length > 0) {
    const reached = new Set<string>();
    const queue = [components[0]!.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reached.has(current)) continue;
      reached.add(current);
      for (const neighbor of adjacency.get(current) ?? []) if (!reached.has(neighbor)) queue.push(neighbor);
    }
    if (reached.size !== components.length) {
      const missing = components.map((component) => component.id).filter((id) => !reached.has(id));
      throw new LayoutError("INVALID_GRAPH", `Circuit graph is disconnected; unreachable components: ${missing.join(", ")}`);
    }
  }
  return { nets, adjacency };
}

function directedAdjacency(components: ResolvedComponent[], nets: Net[]): { outgoing: Map<string, Set<string>>; incoming: Map<string, Set<string>> } {
  const outgoing = new Map(components.map((component) => [component.id, new Set<string>()]));
  const incoming = new Map(components.map((component) => [component.id, new Set<string>()]));
  for (const net of nets) {
    for (const sink of net.sinks) {
      if (net.driver.component === sink.component) continue;
      outgoing.get(net.driver.component)!.add(sink.component);
      incoming.get(sink.component)!.add(net.driver.component);
    }
  }
  return { outgoing, incoming };
}

function stronglyConnectedComponents(ids: string[], outgoing: Map<string, Set<string>>): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lows = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  const visit = (id: string): void => {
    indexes.set(id, nextIndex);
    lows.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const neighbor of [...(outgoing.get(id) ?? [])].sort(lexical)) {
      if (!indexes.has(neighbor)) {
        visit(neighbor);
        lows.set(id, Math.min(lows.get(id)!, lows.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lows.set(id, Math.min(lows.get(id)!, indexes.get(neighbor)!));
      }
    }
    if (lows.get(id) === indexes.get(id)) {
      const component: string[] = [];
      while (stack.length > 0) {
        const member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
        if (member === id) break;
      }
      result.push(component.sort(lexical));
    }
  };
  for (const id of [...ids].sort(lexical)) if (!indexes.has(id)) visit(id);
  return result;
}

function isCyclicScc(members: string[], outgoing: Map<string, Set<string>>): boolean {
  return members.length > 1 || (members.length === 1 && outgoing.get(members[0]!)?.has(members[0]!) === true);
}

function computeLayers(components: ResolvedComponent[], nets: Net[], variant: number): string[][] {
  const ids = components.map((component) => component.id).sort(lexical);
  const { outgoing, incoming } = directedAdjacency(components, nets);
  const outgoingOrder = new Map(ids.map((id) => [id, [] as Array<{ neighbor: string; offset: number }>]));
  const incomingOrder = new Map(ids.map((id) => [id, [] as Array<{ neighbor: string; offset: number }>]));
  for (const net of nets) {
    for (const sink of net.sinks) {
      outgoingOrder.get(net.driver.component)!.push({ neighbor: sink.component, offset: sink.port.offset.y });
      incomingOrder.get(sink.component)!.push({ neighbor: net.driver.component, offset: net.driver.port.offset.y });
    }
  }
  const groups = stronglyConnectedComponents(ids, outgoing);
  const groupOf = new Map<string, number>();
  groups.forEach((group, index) => group.forEach((id) => groupOf.set(id, index)));
  const groupOutgoing = new Map(groups.map((_, index) => [index, new Set<number>()]));
  const indegree = new Map(groups.map((_, index) => [index, 0]));
  for (const [from, neighbors] of outgoing) {
    for (const to of neighbors) {
      const fromGroup = groupOf.get(from)!;
      const toGroup = groupOf.get(to)!;
      if (fromGroup === toGroup || groupOutgoing.get(fromGroup)!.has(toGroup)) continue;
      groupOutgoing.get(fromGroup)!.add(toGroup);
      indegree.set(toGroup, indegree.get(toGroup)! + 1);
    }
  }
  const groupRank = new Map(groups.map((_, index) => [index, 0]));
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([index]) => index).sort((a, b) => lexical(groups[a]![0]!, groups[b]![0]!));
  while (queue.length > 0) {
    const group = queue.shift()!;
    for (const neighbor of [...groupOutgoing.get(group)!].sort((a, b) => a - b)) {
      groupRank.set(neighbor, Math.max(groupRank.get(neighbor)!, groupRank.get(group)! + 1));
      indegree.set(neighbor, indegree.get(neighbor)! - 1);
      if (indegree.get(neighbor) === 0) queue.push(neighbor);
    }
  }
  const layers: string[][] = [];
  for (const id of ids) {
    const rank = groupRank.get(groupOf.get(id)!)!;
    (layers[rank] ??= []).push(id);
  }
  for (const layer of layers) {
    if (variant % 3 === 1) layer.reverse();
    else if (variant % 3 === 2) {
      layer.sort((left, right) => {
        const degreeDifference = (outgoing.get(right)!.size + incoming.get(right)!.size) - (outgoing.get(left)!.size + incoming.get(left)!.size);
        return degreeDifference || lexical(left, right);
      });
    }
  }
  for (let sweep = 0; sweep < 4; sweep += 1) {
    const forward = sweep % 2 === 0;
    const indexes = new Map<string, number>();
    layers.forEach((layer) => layer.forEach((id, index) => indexes.set(id, index)));
    const sequence = forward ? layers.map((_, index) => index).slice(1) : layers.map((_, index) => index).slice(0, -1).reverse();
    for (const layerIndex of sequence) {
      const neighbors = forward ? incomingOrder : outgoingOrder;
      layers[layerIndex]!.sort((left, right) => {
        const barycenter = (id: string): number => {
          const values = neighbors.get(id)!.map(({ neighbor, offset }) => (indexes.get(neighbor) ?? 0) * 1000 + offset);
          return values.length === 0 ? indexes.get(id) ?? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
        };
        return barycenter(left) - barycenter(right) || lexical(left, right);
      });
    }
  }
  return layers;
}

function absoluteRect(anchor: Point, bounds: Rect): Rect {
  return { left: anchor.x + bounds.left, top: anchor.y + bounds.top, right: anchor.x + bounds.right, bottom: anchor.y + bounds.bottom };
}

function rectsOverlap(left: Rect, right: Rect, clearance = 0): boolean {
  return left.left < right.right + clearance && left.right + clearance > right.left
    && left.top < right.bottom + clearance && left.bottom + clearance > right.top;
}

function automaticRegion(components: ResolvedComponent[], nets: Net[], options: LayoutOptions): Rect {
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const layers = computeLayers(components, nets, 0);
  const horizontalGap = Math.max(options.layerSpacing, options.componentClearance);
  const verticalGap = Math.max(options.rowSpacing, options.componentClearance);
  const layerWidths = layers.map((layer) => Math.max(...layer.map((id) => {
    const geometry = componentMap.get(id)!.geometry;
    const footprint = geometry.footprint ?? geometry.bounds;
    return footprint.right - footprint.left;
  })));
  const layerHeights = layers.map((layer) => layer.reduce((sum, id, index) => {
    const geometry = componentMap.get(id)!.geometry;
    const footprint = geometry.footprint ?? geometry.bounds;
    return sum + footprint.bottom - footprint.top + (index === 0 ? 0 : verticalGap);
  }, 0));
  const sccOutgoing = directedAdjacency(components, nets).outgoing;
  const hasCyclicScc = stronglyConnectedComponents(components.map((component) => component.id), sccOutgoing).some((members) => isCyclicScc(members, sccOutgoing));
  // A cyclic frame reserves two exterior sides for the feedback channel.  This
  // matters when the implicit region, rather than the generous default, is the
  // limiting dimension for a large supported component variant.
  const perimeterMargin = hasCyclicScc ? 2 * (options.componentClearance + options.wireClearance + 2 * options.grid) : 0;
  const requiredWidth = 2 * options.componentClearance + layerWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, layers.length - 1) * horizontalGap + 2 * options.grid + perimeterMargin;
  const requiredHeight = 2 * options.componentClearance + Math.max(...layerHeights, 0) + 2 * options.grid + perimeterMargin;
  return {
    left: DEFAULT_REGION.left,
    top: DEFAULT_REGION.top,
    right: DEFAULT_REGION.left + snapUp(Math.max(DEFAULT_REGION.right - DEFAULT_REGION.left + perimeterMargin, requiredWidth), options.grid),
    bottom: DEFAULT_REGION.top + snapUp(Math.max(DEFAULT_REGION.bottom - DEFAULT_REGION.top + perimeterMargin, requiredHeight), options.grid),
  };
}

function placeComponents(components: ResolvedComponent[], nets: Net[], region: Rect, options: LayoutOptions, variant: number, scale: number): LayoutComponentPlan[] {
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const layers = computeLayers(components, nets, variant);
  const { outgoing } = directedAdjacency(components, nets);
  const sccs = stronglyConnectedComponents(components.map((component) => component.id), outgoing);
  const sccByMember = new Map<string, string[]>();
  for (const scc of sccs) if (isCyclicScc(scc, outgoing)) for (const member of scc) sccByMember.set(member, scc);
  // Cyclic logic must not be treated as an ordinary vertical layer.  A bounded,
  // canonical frame gives feedback an exterior channel and keeps the layer to
  // either side from being placed through the cycle.
  if (sccByMember.size > 0) return placeSccFrames(components, nets, region, options, layers, sccByMember, scale);
  const horizontalGap = snapUp(Math.max(options.layerSpacing * scale, options.componentClearance), options.grid);
  const verticalGap = snapUp(Math.max(options.rowSpacing * scale, options.componentClearance), options.grid);
  const layerHeights = layers.map((layer) => layer.reduce((sum, id, index) => {
    const geometry = componentMap.get(id)!.geometry;
    const bounds = geometry.footprint ?? geometry.bounds;
    return sum + (bounds.bottom - bounds.top) + (index === 0 ? 0 : verticalGap);
  }, 0));
  const maximumLayerHeight = Math.max(...layerHeights, 0);
  const anchors = new Map<string, Point>();
  let cursorX = region.left + options.componentClearance;
  layers.forEach((layer, layerIndex) => {
    const minLeft = Math.min(...layer.map((id) => {
      const geometry = componentMap.get(id)!.geometry;
      return (geometry.footprint ?? geometry.bounds).left;
    }));
    const maxRight = Math.max(...layer.map((id) => {
      const geometry = componentMap.get(id)!.geometry;
      return (geometry.footprint ?? geometry.bounds).right;
    }));
    const anchorX = snapUp(cursorX - minLeft, options.grid);
    let cursorY = region.top + options.componentClearance + (maximumLayerHeight - layerHeights[layerIndex]!) / 2;
    for (const id of layer) {
      const geometry = componentMap.get(id)!.geometry;
      const footprint = geometry.footprint ?? geometry.bounds;
      const anchorY = snapUp(cursorY - footprint.top, options.grid);
      anchors.set(id, { x: anchorX, y: anchorY });
      cursorY = anchorY + footprint.bottom + verticalGap;
    }
    cursorX = anchorX + maxRight + horizontalGap;
  });
  const plans = components.map((component): LayoutComponentPlan => {
    const anchor = anchors.get(component.id)!;
    const bounds = absoluteRect(anchor, component.geometry.bounds);
    const footprint = absoluteRect(anchor, component.geometry.footprint ?? component.geometry.bounds);
    const labelBounds = component.geometry.labelBounds ? absoluteRect(anchor, component.geometry.labelBounds) : undefined;
    const ports = component.geometry.ports.map((port): LayoutPortPlan => ({
      id: port.id,
      role: port.role,
      width: port.width,
      required: port.required,
      point: { x: anchor.x + port.offset.x, y: anchor.y + port.offset.y },
      escape: port.escape,
    }));
    return { id: component.id, library: component.library, name: component.name, attributes: { ...component.geometry.attributes }, anchor, bounds, footprint, labelBounds, ports };
  }).sort((left, right) => lexical(left.id, right.id));
  for (const component of plans) {
    if (!onGrid(component.anchor.x, options.grid) || !onGrid(component.anchor.y, options.grid)) throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Anchor for '${component.id}' is off grid`);
    if (component.footprint.left < region.left + options.componentClearance
      || component.footprint.top < region.top + options.componentClearance
      || component.footprint.right > region.right - options.componentClearance
      || component.footprint.bottom > region.bottom - options.componentClearance) {
      throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Component '${component.id}' does not fit inside the layout region`);
    }
    for (const port of component.ports) {
      if (!onGrid(port.point.x, options.grid) || !onGrid(port.point.y, options.grid)) {
        throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Port '${component.id}.${port.id}' is off the ${options.grid}-unit routing grid`);
      }
    }
  }
  for (let left = 0; left < plans.length; left += 1) {
    for (let right = left + 1; right < plans.length; right += 1) {
      if (rectsOverlap(plans[left]!.footprint, plans[right]!.footprint, options.componentClearance)) {
        throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Components '${plans[left]!.id}' and '${plans[right]!.id}' overlap or violate clearance`);
      }
    }
  }
  return plans;
}

function canonicalSccOrder(members: string[], nets: Net[]): string[] {
  const memberSet = new Set(members);
  const next = new Map<string, string[]>();
  for (const member of members) next.set(member, []);
  for (const net of nets) {
    if (!memberSet.has(net.driver.component)) continue;
    for (const sink of net.sinks) if (memberSet.has(sink.component)) next.get(net.driver.component)!.push(sink.component);
  }
  for (const neighbors of next.values()) neighbors.sort(lexical);
  const start = [...members].sort(lexical)[0]!;
  const order: string[] = [];
  const seen = new Set<string>();
  let current = start;
  while (!seen.has(current)) {
    order.push(current);
    seen.add(current);
    current = next.get(current)?.find((candidate) => !seen.has(candidate)) ?? "";
    if (!current) break;
  }
  return [...order, ...members.filter((member) => !seen.has(member)).sort(lexical)];
}

function placeSccFrames(components: ResolvedComponent[], nets: Net[], region: Rect, options: LayoutOptions, layers: string[][], sccByMember: Map<string, string[]>, scale: number): LayoutComponentPlan[] {
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const horizontalGap = snapUp(Math.max(options.layerSpacing * scale, options.componentClearance), options.grid);
  const verticalGap = snapUp(Math.max(options.rowSpacing * scale, options.componentClearance), options.grid);
  const frameGap = snapUp(Math.max(horizontalGap * 2, 2 * options.componentClearance + 340), options.grid);
  const anchors = new Map<string, Point>();
  let cursorX = region.left + options.componentClearance;
  for (const layer of layers) {
    const units: string[][] = [];
    const included = new Set<string>();
    for (const id of layer) {
      if (included.has(id)) continue;
      const frame = sccByMember.get(id);
      const unit = frame ? canonicalSccOrder(frame, nets) : [id];
      unit.forEach((member) => included.add(member));
      units.push(unit);
    }
    const unitWidth = (unit: string[]): number => unit.reduce((sum, id, index) => {
      const footprint = componentMap.get(id)!.geometry.footprint ?? componentMap.get(id)!.geometry.bounds;
      return sum + footprint.right - footprint.left + (index === 0 ? 0 : frameGap);
    }, 0);
    const unitHeight = (unit: string[]): number => Math.max(...unit.map((id) => {
      const footprint = componentMap.get(id)!.geometry.footprint ?? componentMap.get(id)!.geometry.bounds;
      return footprint.bottom - footprint.top;
    }));
    const width = Math.max(...units.map(unitWidth));
    let cursorY = region.top + options.componentClearance;
    for (const unit of units) {
      let unitX = cursorX;
      const height = unitHeight(unit);
      for (const id of unit) {
        const footprint = componentMap.get(id)!.geometry.footprint ?? componentMap.get(id)!.geometry.bounds;
        const anchor = { x: snapUp(unitX - footprint.left, options.grid), y: snapUp(cursorY + (height - (footprint.bottom - footprint.top)) / 2 - footprint.top, options.grid) };
        anchors.set(id, anchor);
        unitX = anchor.x + footprint.right + frameGap;
      }
      cursorY += height + verticalGap;
    }
    cursorX += width + horizontalGap;
  }
  const frames = [...new Set(sccByMember.values())];
  // A single cyclic island is common for state machines.  Put its canonical
  // perimeter in the middle of the available canvas and place direct control
  // sources above/below it.  This is still topology-driven (not component-id
  // driven), and leaves two deterministic exterior routing channels.
  if (frames.length === 1) {
    const frame = canonicalSccOrder(frames[0]!, nets);
    const frameX = snapUp(region.left + Math.max(280, options.componentClearance * 4), options.grid);
    const frameY = snapUp(region.top + Math.max(480, options.componentClearance * 8), options.grid);
    const frameIndex = new Map(frame.map((id, index) => [id, index]));
    const anchorAt = (id: string, x: number, y: number): Point => {
      const footprint = componentMap.get(id)!.geometry.footprint ?? componentMap.get(id)!.geometry.bounds;
      return { x: snapUp(x - footprint.left, options.grid), y: snapUp(y - footprint.top, options.grid) };
    };
    frame.forEach((id, index) => anchors.set(id, anchorAt(id, frameX + index * frameGap, frameY)));
    const sourceRows = new Map<string, number>();
    const sinkRows = new Map<string, number>();
    for (const net of nets) {
      const driverInFrame = frameIndex.has(net.driver.component);
      const sinksInFrame = net.sinks.filter((sink) => frameIndex.has(sink.component));
      if (!driverInFrame && sinksInFrame.length > 0) {
        const below = sinksInFrame.some((sink) => sink.port.escape === "south");
        const row = sourceRows.get(net.driver.component) ?? sourceRows.size;
        sourceRows.set(net.driver.component, row);
        // South-control sources belong inside the feedback frame's left
        // exterior wall; otherwise a perimeter feedback path would isolate
        // them from the sequential reset/preset stubs.
        anchors.set(net.driver.component, anchorAt(net.driver.component, below ? frameX + 80 : region.left + 90, frameY + (below ? 200 : -300) + row * 60));
      }
      if (driverInFrame) {
        for (const sink of net.sinks) {
          if (frameIndex.has(sink.component)) continue;
          const row = sinkRows.get(sink.component) ?? sinkRows.size;
          sinkRows.set(sink.component, row);
          const sourceIndex = frameIndex.get(net.driver.component)!;
          anchors.set(sink.component, anchorAt(sink.component, frameX + sourceIndex * frameGap + 120, frameY + 400 + row * 60));
        }
      }
    }
  }
  const plans = components.map((component): LayoutComponentPlan => {
    const anchor = anchors.get(component.id)!;
    const bounds = absoluteRect(anchor, component.geometry.bounds);
    const footprint = absoluteRect(anchor, component.geometry.footprint ?? component.geometry.bounds);
    const labelBounds = component.geometry.labelBounds ? absoluteRect(anchor, component.geometry.labelBounds) : undefined;
    return { id: component.id, library: component.library, name: component.name, attributes: { ...component.geometry.attributes }, anchor, bounds, footprint, labelBounds, ports: component.geometry.ports.map((port) => ({ id: port.id, role: port.role, width: port.width, required: port.required, point: { x: anchor.x + port.offset.x, y: anchor.y + port.offset.y }, escape: port.escape })) };
  }).sort((left, right) => lexical(left.id, right.id));
  for (const component of plans) {
    if (!onGrid(component.anchor.x, options.grid) || !onGrid(component.anchor.y, options.grid)) throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Anchor for '${component.id}' is off grid`);
    if (component.footprint.left < region.left + options.componentClearance || component.footprint.top < region.top + options.componentClearance || component.footprint.right > region.right - options.componentClearance || component.footprint.bottom > region.bottom - options.componentClearance) throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Component '${component.id}' does not fit inside the layout region`);
    if (component.ports.some((port) => !onGrid(port.point.x, options.grid) || !onGrid(port.point.y, options.grid))) throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Port on '${component.id}' is off the ${options.grid}-unit routing grid`);
  }
  for (let left = 0; left < plans.length; left += 1) for (let right = left + 1; right < plans.length; right += 1) if (rectsOverlap(plans[left]!.footprint, plans[right]!.footprint, options.componentClearance)) throw new LayoutError("NO_PLACEMENT_CANDIDATE", `Components '${plans[left]!.id}' and '${plans[right]!.id}' overlap or violate clearance`);
  return plans;
}

function addPoint(point: Point, direction: Facing, distance: number): Point {
  const delta = DIRECTIONS.find((item) => item.facing === direction)!;
  return { x: point.x + delta.dx * distance, y: point.y + delta.dy * distance };
}

function expanded(rect: Rect, amount: number): Rect {
  return { left: rect.left - amount, top: rect.top - amount, right: rect.right + amount, bottom: rect.bottom + amount };
}

function componentObstacles(component: LayoutComponentPlan): Rect[] {
  return component.labelBounds ? [component.bounds, component.labelBounds] : [component.bounds];
}

function pointInside(rect: Rect, point: Point): boolean {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

function segmentIntersectsRectInterior(a: Point, b: Point, rect: Rect): boolean {
  if (a.y === b.y) {
    if (a.y <= rect.top || a.y >= rect.bottom) return false;
    return Math.max(Math.min(a.x, b.x), rect.left) < Math.min(Math.max(a.x, b.x), rect.right);
  }
  if (a.x === b.x) {
    if (a.x <= rect.left || a.x >= rect.right) return false;
    return Math.max(Math.min(a.y, b.y), rect.top) < Math.min(Math.max(a.y, b.y), rect.bottom);
  }
  return true;
}

function escapeStub(component: LayoutComponentPlan, port: LayoutPortPlan, options: LayoutOptions, region: Rect): Point[] {
  const obstacle = expanded(component.bounds, options.wireClearance);
  const points = [{ ...port.point }];
  let current = port.point;
  do {
    current = addPoint(current, port.escape, options.grid);
    if (current.x < region.left || current.x > region.right || current.y < region.top || current.y > region.bottom) {
      throw new LayoutError("UNROUTABLE_NET", `Escape for '${component.id}.${port.id}' leaves the routing region`);
    }
    points.push(current);
  } while (pointInside(obstacle, current));
  return points;
}

class MinHeap<T> {
  private readonly values: Array<{ priority: number; tie: string; value: T }> = [];

  get size(): number { return this.values.length; }

  push(value: T, priority: number, tie: string): void {
    this.values.push({ value, priority, tie });
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(parent, index) <= 0) break;
      [this.values[parent], this.values[index]] = [this.values[index]!, this.values[parent]!];
      index = parent;
    }
  }

  pop(): T | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first) return undefined;
    if (this.values.length > 0 && last) {
      this.values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.values.length && this.compare(left, smallest) < 0) smallest = left;
        if (right < this.values.length && this.compare(right, smallest) < 0) smallest = right;
        if (smallest === index) break;
        [this.values[index], this.values[smallest]] = [this.values[smallest]!, this.values[index]!];
        index = smallest;
      }
    }
    return first.value;
  }

  private compare(left: number, right: number): number {
    const a = this.values[left]!;
    const b = this.values[right]!;
    return a.priority - b.priority || lexical(a.tie, b.tie);
  }
}

interface SearchState {
  point: Point;
  direction: number;
  stateKey: string;
  cost: number;
}

function routePath(
  start: Point,
  startDirection: Facing,
  goals: Set<string>,
  net: string,
  placements: LayoutComponentPlan[],
  allowed: Set<string>,
  allowedEdges: Set<string>,
  nodeOwners: Map<string, string>,
  keepoutOwners: Map<string, string>,
  edgeOwners: Map<string, string>,
  region: Rect,
  options: LayoutOptions,
  budget: SearchBudget,
): { path: Point[]; cost: number } {
  if (goals.has(key(start))) return { path: [start], cost: 0 };
  const goalPoints = [...goals].map(parsePoint);
  const queue = new MinHeap<SearchState>();
  const initialDirection = DIRECTIONS.findIndex((item) => item.facing === startDirection);
  const initialKey = `${key(start)}|${initialDirection}`;
  const best = new Map<string, number>([[initialKey, 0]]);
  const previous = new Map<string, string>();
  queue.push({ point: start, direction: initialDirection, stateKey: initialKey, cost: 0 }, 0, initialKey);
  const lengthCost = Math.max(0.001, options.weights.length * options.grid);
  const bendCost = options.weights.bends;
  const congestionCost = options.weights.congestion;
  const goalBounds = {
    left: Math.min(...goalPoints.map((goal) => goal.x)),
    right: Math.max(...goalPoints.map((goal) => goal.x)),
    top: Math.min(...goalPoints.map((goal) => goal.y)),
    bottom: Math.max(...goalPoints.map((goal) => goal.y)),
  };
  const heuristic = (point: Point): number => {
    const dx = point.x < goalBounds.left ? goalBounds.left - point.x : point.x > goalBounds.right ? point.x - goalBounds.right : 0;
    const dy = point.y < goalBounds.top ? goalBounds.top - point.y : point.y > goalBounds.bottom ? point.y - goalBounds.bottom : 0;
    return ((dx + dy) / options.grid) * Math.min(lengthCost, lengthCost * 0.05);
  };
  const blockedByBody = (point: Point): boolean => {
    if (allowed.has(key(point))) return false;
    return placements.some((component) => componentObstacles(component).some((obstacle) => pointInside(expanded(obstacle, options.wireClearance), point)));
  };
  while (queue.size > 0) {
    const current = queue.pop()!;
    const currentCost = best.get(current.stateKey);
    if (currentCost === undefined || current.cost !== currentCost) continue;
    budget.used += 1;
    if (budget.used > budget.limit) throw new LayoutError("SEARCH_LIMIT", `Layout exceeded its aggregate budget of ${budget.limit} A* states while routing '${net}'`);
    if (goals.has(key(current.point))) {
      const path = [current.point];
      let cursor = current.stateKey;
      while (previous.has(cursor)) {
        cursor = previous.get(cursor)!;
        path.push(parsePoint(cursor.split("|")[0]!));
      }
      path.reverse();
      return { path, cost: currentCost };
    }
    DIRECTIONS.forEach((direction, directionIndex) => {
      const next = { x: current.point.x + direction.dx * options.grid, y: current.point.y + direction.dy * options.grid };
      if (next.x < region.left || next.x > region.right || next.y < region.top || next.y > region.bottom) return;
      const nextKey = key(next);
      const owner = nodeOwners.get(nextKey);
      if (owner && owner !== net) return;
      const keepoutOwner = keepoutOwners.get(nextKey);
      if (keepoutOwner && keepoutOwner !== net) return;
      if (blockedByBody(next)) return;
      const connectionKey = edgeKey(current.point, next);
      if (!allowedEdges.has(connectionKey)
        && placements.some((component) => componentObstacles(component).some((obstacle) => segmentIntersectsRectInterior(current.point, next, expanded(obstacle, options.wireClearance))))) return;
      const edgeOwner = edgeOwners.get(connectionKey);
      if (edgeOwner && edgeOwner !== net) return;
      let pressure = 0;
      for (const nearby of DIRECTIONS) {
        const nearbyOwner = nodeOwners.get(key({ x: next.x + nearby.dx * options.grid, y: next.y + nearby.dy * options.grid }));
        if (nearbyOwner && nearbyOwner !== net) pressure += 1;
      }
      const bend = current.direction === directionIndex ? 0 : 1;
      const stepCost = edgeOwner === net ? lengthCost * 0.05 : lengthCost;
      const nextCost = currentCost + stepCost + bend * bendCost + pressure * congestionCost;
      const stateKey = `${nextKey}|${directionIndex}`;
      if (nextCost >= (best.get(stateKey) ?? Number.POSITIVE_INFINITY)) return;
      best.set(stateKey, nextCost);
      previous.set(stateKey, current.stateKey);
      queue.push({ point: next, direction: directionIndex, stateKey, cost: nextCost }, nextCost + heuristic(next), stateKey);
    });
  }
  throw new LayoutError("UNROUTABLE_NET", `No orthogonal route exists for net '${net}'`);
}

function compressEdges(edges: UnitEdge[]): LayoutWirePlan[] {
  const result: LayoutWirePlan[] = [];
  const byNet = new Map<string, UnitEdge[]>();
  for (const edge of edges) (byNet.get(edge.net) ?? byNet.set(edge.net, []).get(edge.net)!).push(edge);
  for (const [net, netEdges] of [...byNet.entries()].sort(([left], [right]) => lexical(left, right))) {
    const adjacency = new Map<string, Set<string>>();
    const edgeMap = new Map<string, UnitEdge>();
    for (const edge of netEdges) {
      const a = key(edge.a);
      const b = key(edge.b);
      (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
      (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
      edgeMap.set(edgeKey(edge.a, edge.b), edge);
    }
    const special = (vertex: string): boolean => {
      const neighbors = [...adjacency.get(vertex)!];
      if (neighbors.length !== 2) return true;
      const center = parsePoint(vertex);
      const first = parsePoint(neighbors[0]!);
      const second = parsePoint(neighbors[1]!);
      return (first.x === center.x) !== (second.x === center.x);
    };
    const visited = new Set<string>();
    const starts = [...adjacency.keys()].sort(lexical).filter(special);
    for (const start of starts) {
      for (const neighbor of [...adjacency.get(start)!].sort(lexical)) {
        const firstEdge = edgeKey(parsePoint(start), parsePoint(neighbor));
        if (visited.has(firstEdge)) continue;
        let previousVertex = start;
        let currentVertex = neighbor;
        visited.add(firstEdge);
        while (!special(currentVertex)) {
          const next = [...adjacency.get(currentVertex)!].find((candidate) => candidate !== previousVertex)!;
          visited.add(edgeKey(parsePoint(currentVertex), parsePoint(next)));
          previousVertex = currentVertex;
          currentVertex = next;
        }
        result.push({ net, from: parsePoint(start), to: parsePoint(currentVertex) });
      }
    }
    for (const [remainingKey, edge] of edgeMap) {
      if (!visited.has(remainingKey)) result.push({ net, from: edge.a, to: edge.b });
    }
  }
  return result.sort((left, right) => lexical(`${left.net}|${key(left.from)}|${key(left.to)}`, `${right.net}|${key(right.from)}|${key(right.to)}`));
}

function normalizeNetTrees(edges: UnitEdge[], nets: Net[], placements: LayoutComponentPlan[]): UnitEdge[] {
  const componentMap = new Map(placements.map((component) => [component.id, component]));
  const result: UnitEdge[] = [];
  for (const net of nets) {
    const netEdges = edges.filter((edge) => edge.net === net.id);
    const edgeMap = new Map(netEdges.map((edge) => [edgeKey(edge.a, edge.b), edge]));
    const adjacency = new Map<string, Set<string>>();
    for (const edge of netEdges) {
      const a = key(edge.a);
      const b = key(edge.b);
      (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
      (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
    }
    const terminalPoint = (terminal: Terminal): string => {
      const component = componentMap.get(terminal.component)!;
      return key(component.ports.find((port) => port.id === terminal.port.id)!.point);
    };
    const root = terminalPoint(net.driver);
    const terminals = [root, ...net.sinks.map(terminalPoint)];
    const parent = new Map<string, string>();
    const reached = new Set<string>([root]);
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort(lexical)) {
        if (reached.has(neighbor)) continue;
        reached.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
    const missing = terminals.filter((terminal) => !reached.has(terminal));
    if (missing.length > 0) throw new LayoutError("INTERNAL", `Routed net '${net.id}' is disconnected before tree normalization`);
    const selected = new Set<string>();
    for (const terminal of terminals.slice(1)) {
      let current = terminal;
      while (current !== root) {
        const predecessor = parent.get(current);
        if (!predecessor) throw new LayoutError("INTERNAL", `Routed net '${net.id}' has no path to its driver`);
        selected.add(edgeKey(parsePoint(current), parsePoint(predecessor)));
        current = predecessor;
      }
    }
    for (const selectedEdge of [...selected].sort(lexical)) result.push(edgeMap.get(selectedEdge)!);
  }
  return result;
}

interface FeedbackRoute {
  net: Net;
  sink: Terminal;
  members: string[];
}

/** Returns the canonical back-edges of every non-trivial directed SCC. */
function sccFeedbackRoutes(placements: LayoutComponentPlan[], nets: Net[]): FeedbackRoute[] {
  const ids = placements.map((component) => component.id);
  const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const net of nets) {
    for (const sink of net.sinks) {
      if (net.driver.component !== sink.component) outgoing.get(net.driver.component)!.add(sink.component);
    }
  }
  const result: FeedbackRoute[] = [];
  for (const members of stronglyConnectedComponents(ids, outgoing)) {
    if (!isCyclicScc(members, outgoing)) continue;
    const order = canonicalSccOrder(members, nets);
    const index = new Map(order.map((id, position) => [id, position]));
    for (const net of nets) {
      const driverIndex = index.get(net.driver.component);
      if (driverIndex === undefined) continue;
      for (const sink of net.sinks) {
        const sinkIndex = index.get(sink.component);
        if (sinkIndex !== undefined && (sinkIndex < driverIndex || (order.length === 1 && sinkIndex === driverIndex))) result.push({ net, sink, members: order });
      }
    }
  }
  return result.sort((left, right) => lexical(`${left.net.id}|${left.sink.key}`, `${right.net.id}|${right.sink.key}`));
}

function routePlacement(placements: LayoutComponentPlan[], nets: Net[], region: Rect, options: LayoutOptions, routingVariant: number | boolean, budget: SearchBudget): RoutedLayout {
  const componentMap = new Map(placements.map((component) => [component.id, component]));
  const portMap = new Map<string, { component: LayoutComponentPlan; port: LayoutPortPlan }>();
  for (const component of placements) for (const port of component.ports) portMap.set(`${component.id}.${port.id}`, { component, port });
  const nodeOwners = new Map<string, string>();
  const keepoutOwners = new Map<string, string>();
  const edgeOwners = new Map<string, string>();
  const unitEdges = new Map<string, UnitEdge>();
  const allowedByNet = new Map<string, Set<string>>();
  const allowedEdgesByNet = new Map<string, Set<string>>();
  const stubByTerminal = new Map<string, Point[]>();
  const reserve = (point: Point, net: string): void => {
    const existing = nodeOwners.get(key(point));
    if (existing && existing !== net) throw new LayoutError("UNROUTABLE_NET", `Nets '${existing}' and '${net}' conflict near a component port`);
    const keepoutOwner = keepoutOwners.get(key(point));
    if (keepoutOwner && keepoutOwner !== net) throw new LayoutError("UNROUTABLE_NET", `Nets '${keepoutOwner}' and '${net}' violate ${options.wireSpacing}-unit wire spacing`);
    nodeOwners.set(key(point), net);
    if (options.wireSpacing > 0) {
      const radius = Math.ceil(options.wireSpacing / options.grid) - 1;
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) * options.grid >= options.wireSpacing) continue;
          const nearbyKey = key({ x: point.x + dx * options.grid, y: point.y + dy * options.grid });
          const owner = keepoutOwners.get(nearbyKey);
          if (!owner) keepoutOwners.set(nearbyKey, net);
          else if (owner !== net) keepoutOwners.set(nearbyKey, "*");
        }
      }
    }
  };
  const addUnit = (a: Point, b: Point, net: string): void => {
    reserve(a, net);
    reserve(b, net);
    const id = edgeKey(a, b);
    const existing = edgeOwners.get(id);
    if (existing && existing !== net) throw new LayoutError("UNROUTABLE_NET", `Nets '${existing}' and '${net}' share a wire segment`);
    edgeOwners.set(id, net);
    unitEdges.set(`${net}|${id}`, { a: { ...a }, b: { ...b }, net });
  };
  for (const net of nets) {
    const allowed = allowedByNet.get(net.id) ?? new Set<string>();
    allowedByNet.set(net.id, allowed);
    const allowedEdges = allowedEdgesByNet.get(net.id) ?? new Set<string>();
    allowedEdgesByNet.set(net.id, allowedEdges);
    for (const terminal of [net.driver, ...net.sinks]) {
      const resolved = portMap.get(terminal.key)!;
      const points = escapeStub(resolved.component, resolved.port, options, region);
      for (let index = 1; index < points.length; index += 1) {
        for (const obstacle of placements) {
          for (const obstacleRect of componentObstacles(obstacle)) {
            const ownBody = obstacle.id === resolved.component.id && obstacleRect === obstacle.bounds;
            if (!ownBody && segmentIntersectsRectInterior(points[index - 1]!, points[index]!, expanded(obstacleRect, options.wireClearance))) {
              throw new LayoutError("UNROUTABLE_NET", `Escape for '${terminal.key}' intersects the visible footprint of component '${obstacle.id}'`);
            }
          }
        }
      }
      stubByTerminal.set(`${net.id}|${terminal.key}`, points);
      points.forEach((point) => allowed.add(key(point)));
      for (let index = 1; index < points.length; index += 1) {
        allowedEdges.add(edgeKey(points[index - 1]!, points[index]!));
        addUnit(points[index - 1]!, points[index]!, net.id);
      }
    }
  }
  const routePending = (net: Net, tree: Set<string>, pending: Map<string, Terminal>): void => {
    while (pending.size > 0) {
      const treePoints = [...tree].map(parsePoint);
      const orderedTerminals = [...pending.values()].sort((left, right) => {
        const distance = (terminal: Terminal): number => {
          const stub = stubByTerminal.get(`${net.id}|${terminal.key}`)!;
          const start = stub[stub.length - 1]!;
          return Math.min(...treePoints.map((point) => Math.abs(start.x - point.x) + Math.abs(start.y - point.y)));
        };
        return distance(left) - distance(right) || lexical(left.key, right.key);
      });
      let selected: { terminal: Terminal; route: { path: Point[]; cost: number } } | null = null;
      for (const terminal of orderedTerminals) {
        const stub = stubByTerminal.get(`${net.id}|${terminal.key}`)!;
        const resolved = portMap.get(terminal.key)!;
        try {
          const route = routePath(stub[stub.length - 1]!, resolved.port.escape, tree, net.id, placements, allowedByNet.get(net.id)!, allowedEdgesByNet.get(net.id)!, nodeOwners, keepoutOwners, edgeOwners, region, options, budget);
          selected = { terminal, route };
          break;
        } catch (error) {
          if (!(error instanceof LayoutError) || (error.code !== "UNROUTABLE_NET" && error.code !== "SEARCH_LIMIT")) throw error;
          if (error.code === "SEARCH_LIMIT") throw error;
        }
      }
      if (!selected) throw new LayoutError("UNROUTABLE_NET", `No remaining terminal of net '${net.id}' can reach its routed tree`);
      for (let index = 1; index < selected.route.path.length; index += 1) addUnit(selected.route.path[index - 1]!, selected.route.path[index]!, net.id);
      for (const point of selected.route.path) tree.add(key(point));
      for (const point of stubByTerminal.get(`${net.id}|${selected.terminal.key}`)!) tree.add(key(point));
      pending.delete(selected.terminal.key);
    }
  };
  const completedFeedback = new Set<string>();
  for (const feedback of sccFeedbackRoutes(placements, nets)) {
    if (completedFeedback.has(feedback.net.id)) continue;
    const driverStub = stubByTerminal.get(`${feedback.net.id}|${feedback.net.driver.key}`)!;
    const sinkStub = stubByTerminal.get(`${feedback.net.id}|${feedback.sink.key}`)!;
    const frame = unionRects(feedback.members.map((id) => componentMap.get(id)!.footprint));
    const envelope = unionRects(placements.map((component) => component.footprint));
    const left = snapDown(frame.left - options.wireClearance - options.grid, options.grid);
    const right = snapUp(envelope.right + options.wireClearance + options.grid, options.grid);
    const lower = snapUp(envelope.bottom + options.wireClearance + options.grid, options.grid);
    const upper = snapDown(envelope.top - options.wireClearance - options.grid, options.grid);
    // Prefer the lower envelope channel: sequential control pins commonly
    // escape south, so the upper channel stays available for clocks.  The
    // opposite exterior side is the only bounded fallback.
    const sides = [lower, upper].filter((side) => side >= region.top && side <= region.bottom).slice(0, 2);
    let feedbackPath: Point[] | null = null;
    for (const side of sides) {
      if (left < region.left || right > region.right) continue;
      try {
        const waypoints = [
          { x: left, y: sinkStub[sinkStub.length - 1]!.y },
          { x: left, y: side },
          { x: right, y: side },
          { x: right, y: driverStub[driverStub.length - 1]!.y },
        ];
        let current = sinkStub[sinkStub.length - 1]!;
        let direction = portMap.get(feedback.sink.key)!.port.escape;
        const path = [current];
        for (const waypoint of waypoints) {
          const leg = routePath(current, direction, new Set([key(waypoint)]), feedback.net.id, placements, allowedByNet.get(feedback.net.id)!, allowedEdgesByNet.get(feedback.net.id)!, nodeOwners, keepoutOwners, edgeOwners, region, options, budget);
          path.push(...leg.path.slice(1));
          current = waypoint;
          const previous = path[path.length - 2]!;
          direction = current.x > previous.x ? "east" : current.x < previous.x ? "west" : current.y > previous.y ? "south" : "north";
        }
        const finalLeg = routePath(current, direction, new Set(driverStub.map(key)), feedback.net.id, placements, allowedByNet.get(feedback.net.id)!, allowedEdgesByNet.get(feedback.net.id)!, nodeOwners, keepoutOwners, edgeOwners, region, options, budget);
        feedbackPath = [...path, ...finalLeg.path.slice(1)];
        break;
      } catch (error) {
        if (!(error instanceof LayoutError) || (error.code !== "UNROUTABLE_NET" && error.code !== "SEARCH_LIMIT")) throw error;
        if (error.code === "SEARCH_LIMIT") throw error;
      }
    }
    if (!feedbackPath) throw new LayoutError("UNROUTABLE_NET", `No exterior perimeter channel exists for feedback net '${feedback.net.id}'`);
    const tree = new Set(driverStub.map(key));
    for (let index = 1; index < feedbackPath.length; index += 1) addUnit(feedbackPath[index - 1]!, feedbackPath[index]!, feedback.net.id);
    feedbackPath.forEach((point) => tree.add(key(point)));
    sinkStub.forEach((point) => tree.add(key(point)));
    const pending = new Map(feedback.net.sinks.filter((sink) => sink.key !== feedback.sink.key).map((sink) => [sink.key, sink]));
    routePending(feedback.net, tree, pending);
    completedFeedback.add(feedback.net.id);
  }
  const orderedNets = [...nets].sort((left, right) => {
    const category = (net: Net): number => net.sinks.some((sink) => sink.port.escape === "south") ? 2 : net.sinks.length > 1 ? 0 : 1;
    const variant = typeof routingVariant === "boolean" ? (routingVariant ? 3 : 0) : routingVariant;
    const orders = [[0, 1, 2], [2, 1, 0], [0, 2, 1], [2, 0, 1]];
    const rank = (net: Net): number => orders[variant % orders.length]!.indexOf(category(net));
    const rankDifference = rank(left) - rank(right);
    if (rankDifference) return rankDifference;
    const leftSpan = left.sinks.length * 100 + left.sinks.reduce((sum, sink) => sum + (sink.component === left.driver.component ? 0 : 1), 0);
    const rightSpan = right.sinks.length * 100 + right.sinks.reduce((sum, sink) => sum + (sink.component === right.driver.component ? 0 : 1), 0);
    return rightSpan - leftSpan || lexical(left.id, right.id);
  });
  for (const net of orderedNets) {
    if (completedFeedback.has(net.id)) continue;
    const driverStub = stubByTerminal.get(`${net.id}|${net.driver.key}`)!;
    const tree = new Set(driverStub.map(key));
    const pending = new Map(net.sinks.map((sink) => [sink.key, sink]));
    routePending(net, tree, pending);
  }
  const edges = normalizeNetTrees([...unitEdges.values()], nets, placements);
  return { unitEdges: edges, wires: compressEdges(edges) };
}

function center(rect: Rect): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function segmentsConflict(left: LayoutWirePlan, right: LayoutWirePlan): boolean {
  if (left.net === right.net) return false;
  const leftHorizontal = left.from.y === left.to.y;
  const rightHorizontal = right.from.y === right.to.y;
  const range = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
  if (leftHorizontal && rightHorizontal) {
    if (left.from.y !== right.from.y) return false;
    const [a1, a2] = range(left.from.x, left.to.x);
    const [b1, b2] = range(right.from.x, right.to.x);
    return Math.max(a1, b1) <= Math.min(a2, b2);
  }
  if (!leftHorizontal && !rightHorizontal) {
    if (left.from.x !== right.from.x) return false;
    const [a1, a2] = range(left.from.y, left.to.y);
    const [b1, b2] = range(right.from.y, right.to.y);
    return Math.max(a1, b1) <= Math.min(a2, b2);
  }
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  const [minX, maxX] = range(horizontal.from.x, horizontal.to.x);
  const [minY, maxY] = range(vertical.from.y, vertical.to.y);
  return vertical.from.x >= minX && vertical.from.x <= maxX && horizontal.from.y >= minY && horizontal.from.y <= maxY;
}

function rectGap(left: Rect, right: Rect): number {
  const dx = Math.max(left.left - right.right, right.left - left.right, 0);
  const dy = Math.max(left.top - right.bottom, right.top - left.bottom, 0);
  return Math.max(dx, dy);
}

function segmentBounds(from: Point, to: Point): Rect {
  return { left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), right: Math.max(from.x, to.x), bottom: Math.max(from.y, to.y) };
}

function segmentGap(left: LayoutWirePlan, right: LayoutWirePlan): number {
  return rectGap(segmentBounds(left.from, left.to), segmentBounds(right.from, right.to));
}

function objective(placements: LayoutComponentPlan[], routing: RoutedLayout, connections: LayoutConnectionInput[], region: Rect, options: LayoutOptions): LayoutObjective {
  const length = routing.unitEdges.length * options.grid;
  const adjacency = new Map<string, Set<string>>();
  for (const edge of routing.unitEdges) {
    const a = `${edge.net}|${key(edge.a)}`;
    const b = `${edge.net}|${key(edge.b)}`;
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  }
  let bends = 0;
  for (const [vertex, neighbors] of adjacency) {
    const point = parsePoint(vertex.slice(vertex.indexOf("|") + 1));
    let horizontal = false;
    let vertical = false;
    for (const neighbor of neighbors) {
      const neighborPoint = parsePoint(neighbor.slice(neighbor.indexOf("|") + 1));
      if (neighborPoint.x === point.x) vertical = true;
      if (neighborPoint.y === point.y) horizontal = true;
    }
    if (horizontal && vertical) bends += 1;
  }
  let crossings = 0;
  for (let left = 0; left < routing.wires.length; left += 1) {
    for (let right = left + 1; right < routing.wires.length; right += 1) if (segmentsConflict(routing.wires[left]!, routing.wires[right]!)) crossings += 1;
  }
  let overlap = 0;
  for (let left = 0; left < placements.length; left += 1) {
    for (let right = left + 1; right < placements.length; right += 1) {
      const a = placements[left]!.footprint;
      const b = placements[right]!.footprint;
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      overlap += width * height;
    }
  }
  const componentMap = new Map(placements.map((component) => [component.id, component]));
  const pairs = new Set<string>();
  let spacing = 0;
  for (const connection of connections) {
    const pair = [connection.from.component, connection.to.component].sort(lexical);
    const pairKey = pair.join("|");
    if (pairs.has(pairKey)) continue;
    pairs.add(pairKey);
    const from = center(componentMap.get(connection.from.component)!.bounds);
    const to = center(componentMap.get(connection.to.component)!.bounds);
    const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    if (distance < options.minimumDistance) spacing += (options.minimumDistance - distance) ** 2;
    else if (distance > options.maximumDistance) spacing += (distance - options.maximumDistance) ** 2;
  }
  const alignment = placements.reduce((sum, component) => {
    const dx = component.anchor.x - options.grid * Math.round(component.anchor.x / options.grid);
    const dy = component.anchor.y - options.grid * Math.round(component.anchor.y / options.grid);
    return sum + dx * dx + dy * dy;
  }, 0);
  const regionNets = new Map<string, Set<string>>();
  for (const edge of routing.unitEdges) {
    const midpoint = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    const column = Math.floor((midpoint.x - region.left) / options.congestionRegionSize);
    const row = Math.floor((midpoint.y - region.top) / options.congestionRegionSize);
    const regionKey = `${column},${row}`;
    (regionNets.get(regionKey) ?? regionNets.set(regionKey, new Set()).get(regionKey)!).add(edge.net);
  }
  const congestion = [...regionNets.values()].reduce((sum, nets) => sum + Math.max(0, nets.size - options.congestionLimit) ** 2, 0);
  const values = { length, bends, crossings, overlap, spacing, alignment, congestion };
  const score = Object.entries(values).reduce((sum, [name, value]) => sum + options.weights[name as keyof LayoutWeights] * value, 0);
  if (!Number.isFinite(score) || score > Number.MAX_SAFE_INTEGER) throw new LayoutError("SEARCH_LIMIT", "Layout objective exceeded the finite safe-number range");
  return { score, ...values, weights: { ...options.weights } };
}

function validateFinalPlan(plan: Omit<LayoutPlan, "certificate">, nets: Net[], options: LayoutOptions): LayoutCertificate {
  if (plan.objective.crossings !== 0) throw new LayoutError("INTERNAL", "Final routing contains a crossing between different nets");
  if (plan.objective.overlap !== 0) throw new LayoutError("INTERNAL", "Final placement contains overlapping visible footprints");
  let componentPairsChecked = 0;
  let minimumComponentGap = Number.POSITIVE_INFINITY;
  for (const component of plan.components) {
    if (component.footprint.left < plan.region.left + options.componentClearance
      || component.footprint.top < plan.region.top + options.componentClearance
      || component.footprint.right > plan.region.right - options.componentClearance
      || component.footprint.bottom > plan.region.bottom - options.componentClearance) {
      throw new LayoutError("INTERNAL", `Visible footprint of '${component.id}' violates the region boundary clearance`);
    }
  }
  for (let left = 0; left < plan.components.length; left += 1) {
    for (let right = left + 1; right < plan.components.length; right += 1) {
      componentPairsChecked += 1;
      const gap = rectGap(plan.components[left]!.footprint, plan.components[right]!.footprint);
      minimumComponentGap = Math.min(minimumComponentGap, gap);
      if (gap < options.componentClearance) {
        throw new LayoutError("INTERNAL", `Components '${plan.components[left]!.id}' and '${plan.components[right]!.id}' violate ${options.componentClearance}-unit visible-footprint clearance`);
      }
    }
  }
  const knownNets = new Set(nets.map((net) => net.id));
  for (const wire of plan.wires) {
    if (!knownNets.has(wire.net)) throw new LayoutError("INTERNAL", `Final routing contains unknown net '${wire.net}'`);
    if (wire.from.x !== wire.to.x && wire.from.y !== wire.to.y) throw new LayoutError("INTERNAL", `Net '${wire.net}' contains a diagonal segment`);
    for (const point of [wire.from, wire.to]) {
      if (!onGrid(point.x, plan.grid) || !onGrid(point.y, plan.grid)) throw new LayoutError("INTERNAL", `Net '${wire.net}' has an off-grid endpoint`);
      if (point.x < plan.region.left || point.x > plan.region.right || point.y < plan.region.top || point.y > plan.region.bottom) {
        throw new LayoutError("INTERNAL", `Net '${wire.net}' leaves the layout region`);
      }
    }
    const distance = Math.abs(wire.to.x - wire.from.x) + Math.abs(wire.to.y - wire.from.y);
    if (distance === 0 || distance % plan.grid !== 0) throw new LayoutError("INTERNAL", `Net '${wire.net}' contains an invalid segment length`);
  }
  let wirePairsChecked = 0;
  let minimumWireSpacing = Number.POSITIVE_INFINITY;
  for (let left = 0; left < plan.wires.length; left += 1) {
    for (let right = left + 1; right < plan.wires.length; right += 1) {
      const a = plan.wires[left]!;
      const b = plan.wires[right]!;
      if (a.net === b.net) continue;
      wirePairsChecked += 1;
      const gap = segmentGap(a, b);
      minimumWireSpacing = Math.min(minimumWireSpacing, gap);
      if (segmentsConflict(a, b) || gap < options.wireSpacing) {
        throw new LayoutError("INTERNAL", `Nets '${a.net}' and '${b.net}' cross, overlap, or violate ${options.wireSpacing}-unit wire spacing`);
      }
    }
  }
  const edgesByNet = new Map<string, UnitEdge[]>();
  const expandedEdges: UnitEdge[] = [];
  for (const wire of plan.wires) {
    const dx = Math.sign(wire.to.x - wire.from.x) * plan.grid;
    const dy = Math.sign(wire.to.y - wire.from.y) * plan.grid;
    let current = { ...wire.from };
    while (current.x !== wire.to.x || current.y !== wire.to.y) {
      const next = { x: current.x + dx, y: current.y + dy };
      expandedEdges.push({ a: current, b: next, net: wire.net });
      current = next;
    }
  }
  const componentMap = new Map(plan.components.map((component) => [component.id, component]));
  const permittedPortEdges = new Set<string>();
  for (const net of nets) {
    for (const terminal of [net.driver, ...net.sinks]) {
      const component = componentMap.get(terminal.component)!;
      const port = component.ports.find((candidate) => candidate.id === terminal.port.id)!;
      let current = port.point;
      do {
        const next = addPoint(current, port.escape, plan.grid);
        permittedPortEdges.add(`${net.id}|${component.id}|${edgeKey(current, next)}`);
        current = next;
      } while (pointInside(expanded(component.bounds, options.wireClearance), current));
    }
  }
  let wireComponentPairsChecked = 0;
  let minimumWireComponentGap = Number.POSITIVE_INFINITY;
  for (const edge of expandedEdges) {
    const wire: LayoutWirePlan = { net: edge.net, from: edge.a, to: edge.b };
    for (const component of plan.components) {
      for (const obstacle of componentObstacles(component)) {
        const permitted = obstacle === component.bounds && permittedPortEdges.has(`${edge.net}|${component.id}|${edgeKey(edge.a, edge.b)}`);
        if (permitted) continue;
        wireComponentPairsChecked += 1;
        const gap = rectGap(segmentBounds(wire.from, wire.to), obstacle);
        minimumWireComponentGap = Math.min(minimumWireComponentGap, gap);
        if (gap < options.wireClearance || segmentIntersectsRectInterior(edge.a, edge.b, obstacle)) {
          throw new LayoutError("INTERNAL", `Net '${edge.net}' violates the visible-footprint clearance of component '${component.id}'`);
        }
      }
    }
    (edgesByNet.get(edge.net) ?? edgesByNet.set(edge.net, []).get(edge.net)!).push(edge);
  }
  let netsConnected = 0;
  let netsAcyclic = 0;
  for (const net of nets) {
    const adjacency = new Map<string, Set<string>>();
    const uniqueEdges = new Set<string>();
    const netEdges = edgesByNet.get(net.id) ?? [];
    for (const edge of netEdges) {
      const a = key(edge.a);
      const b = key(edge.b);
      uniqueEdges.add(edgeKey(edge.a, edge.b));
      (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
      (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
    }
    if (uniqueEdges.size !== netEdges.length) throw new LayoutError("INTERNAL", `Final routing for net '${net.id}' contains duplicate unit edges`);
    const terminals = [net.driver, ...net.sinks].map((terminal) => {
      const component = componentMap.get(terminal.component)!;
      const port = component.ports.find((candidate) => candidate.id === terminal.port.id)!;
      const terminalPoint = key(port.point);
      const neighbors = adjacency.get(terminalPoint) ?? new Set<string>();
      const expected = key(addPoint(port.point, port.escape, plan.grid));
      if (neighbors.size !== 1 || !neighbors.has(expected)) throw new LayoutError("INTERNAL", `Terminal '${terminal.key}' does not use its required escape direction`);
      return terminalPoint;
    });
    const terminalSet = new Set(terminals);
    const reached = new Set<string>();
    const queue = [terminals[0]!];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reached.has(current)) continue;
      reached.add(current);
      for (const neighbor of adjacency.get(current) ?? []) if (!reached.has(neighbor)) queue.push(neighbor);
    }
    const missing = terminals.filter((terminal) => !reached.has(terminal));
    if (missing.length > 0) throw new LayoutError("INTERNAL", `Final routing does not connect every terminal of net '${net.id}'`);
    if (reached.size !== adjacency.size) throw new LayoutError("INTERNAL", `Final routing for net '${net.id}' contains disconnected nonterminal geometry`);
    netsConnected += 1;
    if (uniqueEdges.size !== adjacency.size - 1) throw new LayoutError("INTERNAL", `Final routing for net '${net.id}' is not an acyclic tree`);
    for (const [vertex, neighbors] of adjacency) {
      if (neighbors.size === 1 && !terminalSet.has(vertex)) throw new LayoutError("INTERNAL", `Final routing for net '${net.id}' has a dangling nonterminal branch`);
    }
    netsAcyclic += 1;
  }
  return {
    componentClearance: options.componentClearance,
    wireClearance: options.wireClearance,
    wireSpacing: options.wireSpacing,
    minimumComponentGap: Number.isFinite(minimumComponentGap) ? minimumComponentGap : null,
    minimumWireComponentGap: Number.isFinite(minimumWireComponentGap) ? minimumWireComponentGap : null,
    minimumWireSpacing: Number.isFinite(minimumWireSpacing) ? minimumWireSpacing : null,
    componentPairsChecked,
    wireComponentPairsChecked,
    wirePairsChecked,
    netsConnected,
    netsAcyclic,
  };
}

export function layoutGraph(input: LayoutGraphInput): LayoutPlan {
  if (input.components.length < 2 || input.components.length > 64) throw new LayoutError("INVALID_GRAPH", "Layout requires between 2 and 64 components");
  if (input.connections.length < 1 || input.connections.length > 128) throw new LayoutError("INVALID_GRAPH", "Layout requires between 1 and 128 connections");
  const options = normalizedOptions(input.options);
  const components = input.components.map(resolveComponent).sort((left, right) => lexical(left.id, right.id));
  const normalizedConnections = [...input.connections].sort((left, right) => lexical(
    `${left.net ?? ""}|${terminalKey(left.from)}|${terminalKey(left.to)}`,
    `${right.net ?? ""}|${terminalKey(right.from)}|${terminalKey(right.to)}`,
  ));
  const { nets } = validateGraph(components, normalizedConnections);
  const sccOutgoing = directedAdjacency(components, nets).outgoing;
  const hasCyclicScc = stronglyConnectedComponents(components.map((component) => component.id), sccOutgoing).some((members) => isCyclicScc(members, sccOutgoing));
  const region = validateRegion(input.region ?? automaticRegion(components, nets, options), options.grid);
  let best: LayoutPlan | null = null;
  let candidatesEvaluated = 0;
  let routingAttempts = 0;
  const failures: string[] = [];
  const placementSignatures = new Set<string>();
  const routeSignatures = new Set<string>();
  const scales = [1, 1.25, 1.5, 1.75];
  for (let candidate = 0; candidate < options.maxCandidates; candidate += 1) {
    try {
      const placements = placeComponents(components, nets, region, options, candidate, scales[Math.floor(candidate / 3) % scales.length]!);
      const placementSignature = JSON.stringify(placements.map((component) => [component.id, component.anchor]));
      if (placementSignatures.has(placementSignature)) continue;
      placementSignatures.add(placementSignature);
      for (const routingVariant of nets.length > 1 ? (hasCyclicScc ? [0, 1, 2, 3] : [0, 3]) : [0]) {
        routingAttempts += 1;
        try {
          const routing = routePlacement(placements, nets, region, options, routingVariant, { used: 0, limit: options.maxAStarStates });
          const routeSignature = JSON.stringify({ components: placements.map((component) => [component.id, component.anchor]), wires: routing.wires });
          if (routeSignatures.has(routeSignature)) continue;
          routeSignatures.add(routeSignature);
          const candidateBase: Omit<LayoutPlan, "certificate"> = {
            components: placements,
            wires: routing.wires,
            objective: objective(placements, routing, normalizedConnections, region, options),
            candidatesEvaluated: 0,
            routingAttempts: 0,
            region,
            grid: options.grid,
          };
          const candidatePlan: LayoutPlan = { ...candidateBase, certificate: validateFinalPlan(candidateBase, nets, options) };
          candidatesEvaluated += 1;
          const tie = routeSignature;
          const bestTie = best ? JSON.stringify({ components: best.components.map((component) => [component.id, component.anchor]), wires: best.wires }) : "";
          if (!best || candidatePlan.objective.score < best.objective.score || (candidatePlan.objective.score === best.objective.score && lexical(tie, bestTie) < 0)) best = candidatePlan;
        } catch (error) {
          if (!(error instanceof LayoutError) || (error.code !== "UNROUTABLE_NET" && error.code !== "SEARCH_LIMIT" && error.code !== "INTERNAL")) throw error;
          failures.push(error.message);
        }
      }
    } catch (error) {
      if (!(error instanceof LayoutError) || error.code !== "NO_PLACEMENT_CANDIDATE") throw error;
      failures.push(error.message);
    }
  }
  if (!best) throw new LayoutError("NO_FEASIBLE_LAYOUT", failures[0] ?? "No placement and routing candidate satisfied the constraints");
  best.candidatesEvaluated = candidatesEvaluated;
  best.routingAttempts = routingAttempts;
  const { certificate: _certificate, ...bestBase } = best;
  best.certificate = validateFinalPlan(bestBase, nets, options);
  return best;
}

export const layoutInternals = {
  resolveComponent,
  rotatePoint,
  rotateRect,
  segmentsConflict,
  segmentIntersectsRectInterior,
  validateGraph,
  computeLayers,
  placeComponents,
  routePlacement,
  normalizedOptions,
  validateRegion,
};
