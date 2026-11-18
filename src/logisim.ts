import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document, Element } from "@xmldom/xmldom";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { canonicalizeComponentAttributesForWrite, describeLayoutComponent, layoutGraph as optimizeLayoutGraph, listLayoutComponents } from "./layout.js";
import type { LayoutGraphInput, LayoutPlan } from "./layout.js";
import { IS_LINUX, compareVersions, launcherExists, listLogisimProcesses, parseLogisimVersion, preserveMetadata as preserveFileMetadata, resolveLauncher } from "./platform.js";
import type { Launcher } from "./platform.js";
import { NATIVE_CATALOG, EDIT_OPERATION_EXAMPLES, checkStructure, assertSafeXmlText } from "./structure.js";
import type { StructureReport } from "./structure.js";
import { EXAMPLES, synthesizeCircuit } from "./synthesis.js";
import type { SynthesisStyle } from "./synthesis.js";

const MAX_PROCESS_OUTPUT = 1_000_000;
const MAX_PROJECT_BYTES = 20_000_000;
const LOCATION_PATTERN = /^\((-?\d+),(-?\d+)\)$/;
const DEFAULT_TEMPLATE_VERSION = "4.0.0";

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface LogisimConfig {
  executable?: string;
  jar?: string;
  java?: string;
  workspaceRoot?: string;
  validateWrites?: boolean;
}

/** One operation of the anchor-addressed logisim_edit_project batch. */
export type EditOperation =
  | { action: "add_circuit"; name: string; set_main?: boolean }
  | { action: "set_main"; name: string }
  | { action: "add_component"; circuit?: string; library?: string; name: string; at: [number, number]; attributes?: Record<string, string | number | boolean> }
  | { action: "set_attributes"; circuit?: string; at: [number, number]; name?: string; attributes: Record<string, string | number | boolean | null> }
  | { action: "move_component"; circuit?: string; at: [number, number]; name?: string; to: [number, number] }
  | { action: "remove_component"; circuit?: string; at: [number, number]; name?: string; remove_wires?: boolean }
  | { action: "add_wire"; circuit?: string; points: Array<[number, number]> }
  | { action: "remove_wire"; circuit?: string; from: [number, number]; to: [number, number] };

export interface ProcessResult {
  command: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
}

export interface ComponentInput {
  library?: string;
  name: string;
  x: number;
  y: number;
  attributes?: Record<string, string>;
}

export interface BatchComponentInput extends ComponentInput {
  id?: string;
}

export interface WireInput {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface ComponentUpdate {
  x?: number;
  y?: number;
  attributes?: Record<string, string | null>;
}

interface MutationResult {
  path: string;
  backupPath: string;
  validation: ProcessResult | null;
  sha256: string;
  structure: StructureReport;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}

function directChildren(parent: Element, tagName?: string): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index);
    if (node?.nodeType === 1 && (!tagName || node.nodeName === tagName)) {
      children.push(node as Element);
    }
  }
  return children;
}

function attributesOf(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) attributes[attribute.name] = attribute.value;
  }
  return attributes;
}

function childAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const child of directChildren(element, "a")) {
    const name = child.getAttribute("name");
    if (!name) continue;
    attributes[name] = child.hasAttribute("val") ? child.getAttribute("val") ?? "" : child.textContent ?? "";
  }
  return attributes;
}

function normalizedComponentAttributes(library: string | undefined, name: string, attributes: Record<string, string> = {}): Record<string, string> {
  if (library === undefined) return { ...attributes };
  return canonicalizeComponentAttributesForWrite(library, name, attributes);
}

function parseLocation(value: string): { x: number; y: number } | null {
  const match = LOCATION_PATTERN.exec(value);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

function formatLocation(x: number, y: number): string {
  return `(${x},${y})`;
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function emptyProjectXml(circuitName: string, version = DEFAULT_TEMPLATE_VERSION): string {
  const name = escapeXmlAttribute(circuitName);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<project source="${version}" version="1.0">
  This file is intended to be loaded by Logisim-evolution v${version}(https://github.com/logisim-evolution/).

  <lib desc="#Wiring" name="0"><tool name="Pin"><a name="appearance" val="classic"/></tool></lib>
  <lib desc="#Gates" name="1"/>
  <lib desc="#Plexers" name="2"/>
  <lib desc="#Arithmetic" name="3"/>
  <lib desc="#Memory" name="4"/>
  <lib desc="#I/O" name="5"/>
  <lib desc="#TTL" name="6"/>
  <lib desc="#TCL" name="7"/>
  <lib desc="#Base" name="8"/>
  <lib desc="#BFH-Praktika" name="9"/>
  <lib desc="#Input/Output-Extra" name="10"/>
  <lib desc="#Soc" name="11"/>
  <main name="${name}"/>
  <options><a name="gateUndefined" val="ignore"/><a name="simlimit" val="1000"/><a name="simrand" val="0"/></options>
  <mappings><tool lib="8" map="Button2" name="Poke Tool"/><tool lib="8" map="Button3" name="Menu Tool"/><tool lib="8" map="Ctrl Button1" name="Menu Tool"/></mappings>
  <toolbar><tool lib="8" name="Poke Tool"/><tool lib="8" name="Edit Tool"/><tool lib="8" name="Wiring Tool"/><tool lib="8" name="Text Tool"/><sep/><tool lib="0" name="Pin"/><tool lib="0" name="Pin"><a name="facing" val="west"/><a name="type" val="output"/></tool><sep/><tool lib="1" name="NOT Gate"/><tool lib="1" name="AND Gate"/><tool lib="1" name="OR Gate"/><tool lib="1" name="XOR Gate"/><tool lib="1" name="NAND Gate"/><tool lib="1" name="NOR Gate"/><sep/><tool lib="4" name="D Flip-Flop"/><tool lib="4" name="Register"/></toolbar>
  <circuit name="${name}"><a name="appearance" val="logisim_evolution"/><a name="circuit" val="${name}"/><a name="circuitnamedboxfixedsize" val="true"/><a name="simulationFrequency" val="1.0"/></circuit>
</project>
`;
}

interface SemanticComponentInventory {
  library: string;
  name: string;
  location: string;
  attributes: Record<string, string>;
}

interface SemanticCircuitInventory {
  name: string;
  components: SemanticComponentInventory[];
  wires: string[];
}

interface SemanticInventory {
  main: string | null;
  libraries: string[];
  circuits: SemanticCircuitInventory[];
}

function geometryAttributes(component: Element): Record<string, string> {
  const attributes = childAttributes(component);
  for (const originalName of Object.keys(attributes)) {
    const name = originalName.toLowerCase();
    if (!["output", "type", "behavior", "tristate", "pull"].includes(name)) continue;
    if (attributes[name] === undefined) attributes[name] = attributes[originalName]!.toLowerCase();
    if (originalName !== name) delete attributes[originalName];
  }
  if (attributes.type === undefined && attributes.output === "true") attributes.type = "output";
  if (attributes.behavior === undefined) {
    if (attributes.pull === "up") attributes.behavior = "pullup";
    else if (attributes.pull === "down") attributes.behavior = "pulldown";
    else if (attributes.tristate === "true") attributes.behavior = "tristate";
  }
  delete attributes.output;
  delete attributes.pull;
  delete attributes.tristate;
  const name = component.getAttribute("name") ?? "";
  const defaults: Record<string, string> = {
    behavior: "simple",
    facing: "east",
    highDuration: "1",
    inputs: "2",
    label: "",
    lowDuration: "1",
    ongoal: "wrap",
    out: "01",
    phaseOffset: "0",
    radix: "2",
    showInTab: "false",
    trigger: "rising",
    type: "input",
    width: ["Adder", "Register", "Counter"].includes(name) ? "8" : "1",
    xor: "1",
  };
  if (["AND Gate", "OR Gate", "XOR Gate", "NAND Gate", "NOR Gate", "XNOR Gate"].includes(name)) defaults.size = "50";
  if (name === "NOT Gate") defaults.size = "30";
  if (["Pin", "Clock"].includes(name)) defaults.appearance = "NewPins";
  const result: Record<string, string> = {};
  for (const [attributeName, value] of Object.entries(attributes)) {
    if (defaults[attributeName] === value || (/^negate\d+$/.test(attributeName) && value === "false")) continue;
    result[attributeName] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function semanticInventory(document: Document): SemanticInventory {
  const root = document.documentElement;
  if (!root) throw new Error("Project has no XML root");
  const main = directChildren(root, "main")[0]?.getAttribute("name") ?? null;
  const libraryMap = new Map(directChildren(root, "lib").map((library) => [library.getAttribute("name") ?? "", library.getAttribute("desc") ?? ""]));
  const libraries = [...libraryMap.values()].sort();
  const circuits = directChildren(root, "circuit").map((circuit) => {
    const components = directChildren(circuit, "comp")
      .map((component): SemanticComponentInventory => ({
        library: component.hasAttribute("lib") ? libraryMap.get(component.getAttribute("lib") ?? "") ?? `unknown:${component.getAttribute("lib") ?? ""}` : "subcircuit",
        name: component.getAttribute("name") ?? "",
        location: component.getAttribute("loc") ?? "",
        attributes: geometryAttributes(component),
      }))
      .sort((left, right) => `${left.library}|${left.name}|${left.location}`.localeCompare(`${right.library}|${right.name}|${right.location}`));
    const wires = directChildren(circuit, "wire")
      .map((wire) => [wire.getAttribute("from") ?? "", wire.getAttribute("to") ?? ""].sort().join("|"))
      .sort();
    return { name: circuit.getAttribute("name") ?? "", components, wires };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return { main, libraries, circuits };
}

function inventoryDifference(source: SemanticInventory, normalized: SemanticInventory): string[] {
  const differences: string[] = [];
  if (source.main !== normalized.main) differences.push(`Main circuit changed from '${source.main}' to '${normalized.main}'`);
  if (JSON.stringify(source.libraries) !== JSON.stringify(normalized.libraries)) {
    differences.push(`Library descriptors changed from ${JSON.stringify(source.libraries)} to ${JSON.stringify(normalized.libraries)}`);
  }
  const sourceCircuits = new Map(source.circuits.map((circuit) => [circuit.name, circuit]));
  const normalizedCircuits = new Map(normalized.circuits.map((circuit) => [circuit.name, circuit]));
  for (const name of [...new Set([...sourceCircuits.keys(), ...normalizedCircuits.keys()])].sort()) {
    const before = sourceCircuits.get(name);
    const after = normalizedCircuits.get(name);
    if (!before) {
      differences.push(`Circuit '${name}' was added during normalization`);
      continue;
    }
    if (!after) {
      differences.push(`Circuit '${name}' was removed during normalization`);
      continue;
    }
    const identity = (component: SemanticComponentInventory): string => `${component.library}|${component.name}|${component.location}`;
    const groupComponents = (components: SemanticComponentInventory[]): Map<string, SemanticComponentInventory[]> => {
      const groups = new Map<string, SemanticComponentInventory[]>();
      for (const component of components) (groups.get(identity(component)) ?? groups.set(identity(component), []).get(identity(component))!).push(component);
      for (const group of groups.values()) group.sort((left, right) => JSON.stringify(left.attributes).localeCompare(JSON.stringify(right.attributes)));
      return groups;
    };
    const beforeComponents = groupComponents(before.components);
    const afterComponents = groupComponents(after.components);
    for (const componentIdentity of [...new Set([...beforeComponents.keys(), ...afterComponents.keys()])].sort()) {
      const oldComponents = beforeComponents.get(componentIdentity) ?? [];
      const newComponents = afterComponents.get(componentIdentity) ?? [];
      if (oldComponents.length !== newComponents.length) {
        differences.push(`Circuit '${name}': component multiplicity changed for ${componentIdentity} from ${oldComponents.length} to ${newComponents.length}`);
      }
      for (let index = 0; index < Math.min(oldComponents.length, newComponents.length); index += 1) {
        const oldComponent = oldComponents[index]!;
        const newComponent = newComponents[index]!;
        if (JSON.stringify(oldComponent.attributes) !== JSON.stringify(newComponent.attributes)) {
          differences.push(`Circuit '${name}': ${oldComponent.name} at ${oldComponent.location} changed attributes from ${JSON.stringify(oldComponent.attributes)} to ${JSON.stringify(newComponent.attributes)}`);
        }
      }
    }
    const count = (values: string[]): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    };
    const beforeWires = count(before.wires);
    const afterWires = count(after.wires);
    for (const wire of [...new Set([...beforeWires.keys(), ...afterWires.keys()])].sort()) {
      const oldCount = beforeWires.get(wire) ?? 0;
      const newCount = afterWires.get(wire) ?? 0;
      if (oldCount > newCount) differences.push(`Circuit '${name}': wire removed or repaired by Logisim (${oldCount} -> ${newCount}): ${wire.replace("|", " <-> ")}`);
      if (newCount > oldCount) differences.push(`Circuit '${name}': wire added or repaired by Logisim (${oldCount} -> ${newCount}): ${wire.replace("|", " <-> ")}`);
    }
  }
  return differences;
}

export class LogisimService {
  readonly launcher: Launcher;
  workspaceRoot: string;
  readonly validateWrites: boolean;
  logisimVersion: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(config: LogisimConfig = {}) {
    this.launcher = resolveLauncher({ executable: config.executable, jar: config.jar, java: config.java });
    this.workspaceRoot = resolve(config.workspaceRoot ?? process.env.LOGISIM_WORKSPACE ?? homedir() ?? process.cwd());
    this.validateWrites = config.validateWrites ?? process.env.LOGISIM_VALIDATE_WRITES !== "false";
  }

  /** Back-compat alias: the launcher or JAR path. */
  get executable(): string {
    return this.launcher.target;
  }

  /** Version string written into new projects; matches the installed Logisim when known. */
  get templateVersion(): string {
    return this.logisimVersion ?? DEFAULT_TEMPLATE_VERSION;
  }

  async initialize(): Promise<void> {
    if (!launcherExists(this.launcher)) {
      const hint = this.launcher.kind === "jar"
        ? `LOGISIM_JAR does not point to a file: ${this.launcher.target}`
        : `Logisim launcher not found: ${this.launcher.target}. Set LOGISIM_EXECUTABLE (native launcher) or LOGISIM_JAR (+ optional LOGISIM_JAVA).`;
      if (this.validateWrites) throw new Error(hint);
      console.error(`Warning: ${hint} Simulation tools will fail until it is configured.`);
    }
    await mkdir(this.workspaceRoot, { recursive: true });
    // Adopt the canonical spelling (resolves symlinks and, on Windows, drive-letter/case differences).
    this.workspaceRoot = await realpath(this.workspaceRoot);
    await this.detectVersion();
  }

  private async detectVersion(): Promise<void> {
    if (this.logisimVersion || !launcherExists(this.launcher)) return;
    try {
      const result = await this.run(["--version"], 30_000);
      this.logisimVersion = parseLogisimVersion(`${result.stdout}\n${result.stderr}`);
    } catch {
      this.logisimVersion = null;
    }
  }

  private async projectPath(input: string, mustExist = true): Promise<string> {
    const candidate = resolve(this.workspaceRoot, input);
    if (!isInside(this.workspaceRoot, candidate)) {
      throw new Error(`Path is outside LOGISIM_WORKSPACE (${this.workspaceRoot})`);
    }
    if (extname(candidate).toLowerCase() !== ".circ") {
      throw new Error("Logisim project paths must end in .circ");
    }

    if (mustExist) {
      const canonical = await realpath(candidate);
      if (!isInside(this.workspaceRoot, canonical)) throw new Error("Resolved project path escapes LOGISIM_WORKSPACE");
      const info = await stat(canonical);
      if (!info.isFile()) throw new Error("Project path is not a file");
      return canonical;
    }

    try {
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) throw new Error("Writable project destinations cannot be symbolic links");
      if (!info.isFile()) throw new Error("Project path is not a file");
      const canonical = await realpath(candidate);
      if (!isInside(this.workspaceRoot, canonical)) throw new Error("Resolved project path escapes LOGISIM_WORKSPACE");
      return canonical;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }

    const canonicalParent = await realpath(dirname(candidate));
    if (!isInside(this.workspaceRoot, canonicalParent)) throw new Error("Project parent escapes LOGISIM_WORKSPACE");
    return join(canonicalParent, basename(candidate));
  }

  private async workspaceFile(input: string): Promise<string> {
    const candidate = resolve(this.workspaceRoot, input);
    if (!isInside(this.workspaceRoot, candidate)) throw new Error("File is outside LOGISIM_WORKSPACE");
    const canonical = await realpath(candidate);
    if (!isInside(this.workspaceRoot, canonical)) throw new Error("Resolved file escapes LOGISIM_WORKSPACE");
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error("Path is not a file");
    return canonical;
  }

  private async openSecureFile(path: string): Promise<FileHandle> {
    const noFollow = (fsConstants as Record<string, number | undefined>).O_NOFOLLOW ?? 0;
    const handle = await open(path, fsConstants.O_RDONLY | noFollow);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error(`Path is not a regular file: ${path}`);
      if (IS_LINUX) {
        const openedPath = await realpath(`/proc/${process.pid}/fd/${handle.fd}`);
        if (!isInside(this.workspaceRoot, openedPath)) throw new Error(`Opened file escapes LOGISIM_WORKSPACE: ${openedPath}`);
      } else {
        // No /proc on Windows/macOS: re-resolve the path and confirm it is the same file we opened.
        const canonical = await realpath(path);
        if (!isInside(this.workspaceRoot, canonical)) throw new Error(`Opened file escapes LOGISIM_WORKSPACE: ${canonical}`);
        const pathInfo = await lstat(canonical);
        if (pathInfo.isSymbolicLink()) throw new Error(`Refusing to follow symbolic link: ${path}`);
        if (pathInfo.ino !== 0 && info.ino !== 0 && (pathInfo.ino !== info.ino || pathInfo.dev !== info.dev)) {
          throw new Error(`File changed while it was being opened: ${path}`);
        }
      }
      if (info.size > MAX_PROJECT_BYTES) throw new Error(`File exceeds the ${MAX_PROJECT_BYTES / 1_000_000} MB limit: ${path}`);
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async readSecureFile(path: string): Promise<string> {
    const handle = await this.openSecureFile(path);
    try {
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  }

  private assertNoExternalResources(document: Document, sourcePath: string): void {
    for (const library of directChildren(this.root(document), "lib")) {
      const descriptor = library.getAttribute("desc") ?? "";
      if (descriptor.startsWith("jar#")) {
        throw new Error(`External JAR libraries are disabled because loading them executes Java code: ${descriptor} in ${sourcePath}`);
      }
      if (descriptor.startsWith("file#")) {
        throw new Error(`External project libraries are disabled for sandboxed execution: ${descriptor} in ${sourcePath}`);
      }
    }
    const attributes = document.getElementsByTagName("a");
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes.item(index);
      if (attribute?.getAttribute("name") === "filePath") {
        throw new Error(`External filePath attributes are disabled for sandboxed execution: '${attribute.getAttribute("val") ?? attribute.textContent ?? ""}' in ${sourcePath}`);
      }
    }
  }

  private async withSecureSnapshot<T>(path: string, prefix: string, operation: (snapshotPath: string) => Promise<T>): Promise<T> {
    const temporaryDirectory = await mkdtemp(join(dirname(path), prefix));
    const snapshotPath = join(temporaryDirectory, basename(path));
    try {
      await writeFile(snapshotPath, await this.readSecureFile(path), { encoding: "utf8", flag: "wx", mode: 0o600 });
      return await operation(snapshotPath);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async withSecureProjectSnapshot<T>(path: string, prefix: string, operation: (snapshotPath: string) => Promise<T>): Promise<T> {
    const temporaryDirectory = await mkdtemp(join(dirname(path), prefix));
    const snapshotPath = join(temporaryDirectory, basename(path));
    try {
      const xml = await this.readSecureFile(path);
      const document = this.parseProject(xml, path);
      this.assertNoExternalResources(document, path);
      await writeFile(snapshotPath, xml, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return await operation(snapshotPath);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async exclusiveWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release: () => void = () => undefined;
    this.writeQueue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async withFileLocks<T>(paths: string[], operation: () => Promise<T>): Promise<T> {
    const lockPaths = [...new Set(paths.map((path) => join(dirname(path), `.${basename(path)}.mcp.lock`)))].sort();
    const acquire = async (index: number): Promise<T> => {
      const lockPath = lockPaths[index];
      if (!lockPath) return await operation();
      const deadline = Date.now() + 30_000;
      const token = randomUUID();
      let handle;
      while (!handle) {
        try {
          handle = await open(lockPath, "wx", 0o600);
          await handle.writeFile(JSON.stringify({ pid: process.pid, token, created: new Date().toISOString() }));
        } catch (error) {
          if (errorCode(error) !== "EEXIST") throw error;
          try {
            const lockInfo = await lstat(lockPath);
            if (lockInfo.isSymbolicLink() || !lockInfo.isFile()) throw new Error(`Project lock path is not a regular file: ${lockPath}`);
          } catch (lockError) {
            if (errorCode(lockError) === "ENOENT") continue;
            throw lockError;
          }
          if (Date.now() >= deadline) {
            let owner = "unknown";
            try {
              const lockInfo = await lstat(lockPath);
              if (lockInfo.isSymbolicLink() || !lockInfo.isFile()) throw new Error(`Project lock path is not a regular file: ${lockPath}`);
              owner = (await this.readSecureFile(lockPath)).slice(0, 4096);
            } catch (lockError) {
              if (errorCode(lockError) === "ENOENT") continue;
              throw lockError;
            }
            throw new Error(`Timed out waiting for project lock: ${lockPath}. Owner: ${owner}. Remove the lock only after confirming its process is no longer running.`);
          }
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        }
      }
      try {
        return await acquire(index + 1);
      } finally {
        await handle.close();
        try {
          const lockInfo = await lstat(lockPath);
          if (lockInfo.isSymbolicLink() || !lockInfo.isFile()) throw new Error(`Project lock path changed type while held: ${lockPath}`);
          const owner = JSON.parse(await this.readSecureFile(lockPath)) as { token?: string };
          if (owner.token === token) await rm(lockPath, { force: true });
        } catch (error) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
      }
    };
    return await acquire(0);
  }

  private parseProject(xml: string, sourcePath: string): Document {
    const errors: string[] = [];
    const document = new DOMParser({
      onError: (level, message) => {
        errors.push(`${level}: ${message}`);
      },
    }).parseFromString(xml, "application/xml");
    if (!document || document.documentElement?.nodeName !== "project" || errors.length > 0) {
      throw new Error(`Invalid Logisim XML in ${sourcePath}: ${errors.join("; ") || "missing <project> root"}`);
    }
    return document;
  }

  private root(document: Document): Element {
    const root = document.documentElement;
    if (!root || root.nodeName !== "project") throw new Error("Logisim project is missing its <project> root");
    return root;
  }

  private async loadProject(input: string): Promise<{ path: string; document: Document }> {
    const path = await this.projectPath(input);
    const xml = await this.readSecureFile(path);
    return { path, document: this.parseProject(xml, path) };
  }

  private circuit(document: Document, name: string): Element {
    const circuit = directChildren(this.root(document), "circuit").find((item) => item.getAttribute("name") === name);
    if (!circuit) throw new Error(`Circuit '${name}' was not found`);
    return circuit;
  }

  private async run(args: string[], timeoutMs = 30_000): Promise<ProcessResult> {
    const fullArgs = [...this.launcher.prefixArgs, ...args];
    return await new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
      const child = spawn(this.launcher.command, fullArgs, {
        env: { ...process.env, LANG: "C", LC_ALL: "C" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let outputTruncated = false;
      let settled = false;

      const append = (current: string, chunk: Buffer): string => {
        if (current.length >= MAX_PROCESS_OUTPUT) {
          outputTruncated = true;
          return current;
        }
        const next = current + chunk.toString("utf8");
        if (next.length > MAX_PROCESS_OUTPUT) {
          outputTruncated = true;
          return next.slice(0, MAX_PROCESS_OUTPUT);
        }
        return next;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectPromise(error);
      });
      child.once("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          command: [this.launcher.command, ...fullArgs],
          exitCode,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut,
          outputTruncated,
        });
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    });
  }

  private async preserveMetadata(sourcePath: string, targetPath: string): Promise<void> {
    await preserveFileMetadata(sourcePath, targetPath);
  }

  private async validatePath(path: string, timeoutMs = 30_000): Promise<ProcessResult> {
    const temporaryDirectory = await mkdtemp(join(dirname(path), ".logisim-mcp-validate-"));
    const snapshotPath = join(temporaryDirectory, "source.circ");
    const normalizedPath = join(temporaryDirectory, "normalized.circ");
    try {
      const sourceXml = await this.readSecureFile(path);
      const sourceDocument = this.parseProject(sourceXml, path);
      this.assertNoExternalResources(sourceDocument, path);
      await writeFile(snapshotPath, sourceXml, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const result = await this.run(["--locale", "en", "--new-file-format", snapshotPath, normalizedPath], timeoutMs);
      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(`Logisim could not load and normalize the project (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }
      const normalizedXml = await readFile(normalizedPath, "utf8");
      const sourceInventory = semanticInventory(sourceDocument);
      const normalizedInventory = semanticInventory(this.parseProject(normalizedXml, normalizedPath));
      if (JSON.stringify(sourceInventory) !== JSON.stringify(normalizedInventory)) {
        const differences = inventoryDifference(sourceInventory, normalizedInventory);
        const shown = differences.slice(0, 12);
        const remaining = differences.length - shown.length;
        throw new Error([
          "Logisim changed circuit geometry while normalizing the project:",
          ...shown.map((difference) => `- ${difference}`),
          ...(remaining > 0 ? [`- ...and ${remaining} more change(s)`] : []),
          "Use logisim_describe_component for verified attributes and semantic port coordinates. Wire repairs usually mean an endpoint missed the real component port.",
        ].join("\n"));
      }
      return result;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async backup(path: string): Promise<string> {
    const metadataDirectory = join(dirname(path), ".logisim-mcp");
    for (const directory of [metadataDirectory, join(metadataDirectory, "backups")]) {
      try {
        await mkdir(directory);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Backup path is not a real directory: ${directory}`);
    }
    const backupDirectory = await realpath(join(metadataDirectory, "backups"));
    if (!isInside(this.workspaceRoot, backupDirectory)) throw new Error("Backup directory escapes LOGISIM_WORKSPACE");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDirectory, `${basename(path)}.${stamp}.${randomUUID()}.bak`);
    await copyFile(path, backupPath, fsConstants.COPYFILE_EXCL);
    return backupPath;
  }

  /** Serialize and run the Java-free structural checks; throws on structural errors. */
  private serializeChecked(document: Document, path: string): { text: string; structure: StructureReport } {
    const structure = checkStructure(document);
    if (!structure.valid) {
      throw new Error(`Structural validation failed for ${path}:\n${structure.errors.slice(0, 20).map((error) => `- ${error}`).join("\n")}`);
    }
    const serialized = new XMLSerializer().serializeToString(document);
    return { text: serialized.endsWith("\n") ? serialized : `${serialized}\n`, structure };
  }

  private async saveMutation(path: string, document: Document): Promise<MutationResult> {
    const { text, structure } = this.serializeChecked(document, path);
    const temporaryDirectory = await mkdtemp(join(dirname(path), ".logisim-mcp-write-"));
    const temporaryPath = join(temporaryDirectory, basename(path));
    await writeFile(temporaryPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    let validation: ProcessResult | null = null;
    try {
      if (this.validateWrites) validation = await this.validatePath(temporaryPath);
      const backupPath = await this.backup(path);
      await this.preserveMetadata(path, temporaryPath);
      await rename(temporaryPath, path);
      return { path, backupPath, validation, sha256: sha256(text), structure };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async saveDestination(path: string, document: Document, overwrite: boolean): Promise<{ path: string; backupPath: string | null; validation: ProcessResult | null; sha256: string; structure: StructureReport }> {
    let exists = true;
    try {
      await access(path);
    } catch {
      exists = false;
    }
    if (exists && !overwrite) throw new Error(`Destination project already exists: ${path}`);
    const { text, structure } = this.serializeChecked(document, path);
    const temporaryDirectory = await mkdtemp(join(dirname(path), ".logisim-mcp-copy-"));
    const temporaryPath = join(temporaryDirectory, basename(path));
    await writeFile(temporaryPath, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      const validation = this.validateWrites ? await this.validatePath(temporaryPath) : null;
      const backupPath = exists ? await this.backup(path) : null;
      if (exists) await this.preserveMetadata(path, temporaryPath);
      if (overwrite) {
        await rename(temporaryPath, path);
      } else {
        try {
          await link(temporaryPath, path);
        } catch (error) {
          if (errorCode(error) === "EEXIST") throw new Error(`Destination project was created concurrently and was not overwritten: ${path}`);
          throw error;
        }
        await rm(temporaryPath, { force: true });
      }
      return { path, backupPath, validation, sha256: sha256(text), structure };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async mutate(input: string, callback: (document: Document) => void, expectedSha256?: string): Promise<MutationResult> {
    const path = await this.projectPath(input);
    return await this.exclusiveWrite(async () => await this.withFileLocks([path], async () => {
      const xml = await this.readSecureFile(path);
      if (expectedSha256 && sha256(xml).toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(`Project changed since it was inspected (expected sha256 ${expectedSha256}, found ${sha256(xml)}). Inspect it again before editing.`);
      }
      const document = this.parseProject(xml, path);
      callback(document);
      return await this.saveMutation(path, document);
    }));
  }

  async status(): Promise<Record<string, unknown>> {
    let version = "";
    let versionError: string | null = null;
    try {
      const result = await this.run(["--version"], 30_000);
      version = result.stdout || result.stderr;
      this.logisimVersion ??= parseLogisimVersion(version);
    } catch (error) {
      versionError = error instanceof Error ? error.message : String(error);
    }
    return {
      platform: process.platform,
      launcher: this.launcher,
      launcherFound: launcherExists(this.launcher),
      workspaceRoot: this.workspaceRoot,
      validateWrites: this.validateWrites,
      logisimVersion: this.logisimVersion,
      newProjectFormat: this.templateVersion,
      version,
      versionError,
      runningProcesses: await listLogisimProcesses(this.launcher),
    };
  }

  async describeComponent(library?: string, name?: string, attributes: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (library === undefined && name === undefined) {
      return {
        sourceVersion: "Logisim-evolution 4.0.0 (geometry also matches 3.8 for these components)",
        installedVersion: this.logisimVersion,
        components: listLayoutComponents(),
        nativeCatalog: NATIVE_CATALOG,
        nativeCatalogNote: "nativeCatalog lists native component names per library number for logisim_add_component / logisim_edit_project. Only the 'components' entries have source-verified port geometry; for others, verify placement with logisim_validate_project or a test vector.",
        editProjectOperations: EDIT_OPERATION_EXAMPLES,
      };
    }
    if (library === undefined || name === undefined) throw new Error("Provide both library and name, or omit both to list the component catalog");
    return describeLayoutComponent(library, name, attributes);
  }

  async listProjects(directory = ".", maxDepth = 3, limit = 100): Promise<Record<string, unknown>> {
    const start = resolve(this.workspaceRoot, directory);
    if (!isInside(this.workspaceRoot, start)) throw new Error("Directory is outside LOGISIM_WORKSPACE");
    const canonical = await realpath(start);
    if (!isInside(this.workspaceRoot, canonical)) throw new Error("Resolved directory escapes LOGISIM_WORKSPACE");
    const projects: Array<{ path: string; size: number; modified: string }> = [];
    const skipped = new Set([".git", "node_modules", ".cache", ".local", ".config", ".logisim-mcp"]);

    const walk = async (current: string, depth: number): Promise<void> => {
      if (projects.length >= limit) return;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (projects.length >= limit) return;
        const path = join(current, entry.name);
        if (entry.isDirectory() && depth < maxDepth && !skipped.has(entry.name)) {
          await walk(path, depth + 1);
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".circ") {
          const info = await stat(path);
          projects.push({ path: relative(this.workspaceRoot, path), size: info.size, modified: info.mtime.toISOString() });
        }
      }
    };
    await walk(canonical, 0);
    return { root: relative(this.workspaceRoot, canonical) || ".", count: projects.length, limit, projects };
  }

  async inspectProject(input: string, circuitName?: string, offset = 0, limit = 200): Promise<Record<string, unknown>> {
    const path = await this.projectPath(input);
    const xml = await this.readSecureFile(path);
    const document = this.parseProject(xml, path);
    const revision = sha256(xml);
    const root = this.root(document);
    const libraries = directChildren(root, "lib").map((library) => attributesOf(library));
    const circuits = directChildren(root, "circuit");
    if (circuitName && !circuits.some((circuit) => circuit.getAttribute("name") === circuitName)) {
      throw new Error(`Circuit '${circuitName}' was not found`);
    }
    const items: Array<Record<string, unknown>> = [];
    const summaries: Array<Record<string, unknown>> = [];
    for (const circuit of circuits) {
      const name = circuit.getAttribute("name") ?? "";
      const components = directChildren(circuit, "comp");
      const wires = directChildren(circuit, "wire");
      summaries.push({ name, attributes: childAttributes(circuit), componentCount: components.length, wireCount: wires.length });
      if (circuitName && name !== circuitName) continue;
      components.forEach((component, componentIndex) => {
        items.push({
          kind: "component",
          circuit: name,
          componentIndex,
          library: component.getAttribute("lib"),
          name: component.getAttribute("name"),
          location: parseLocation(component.getAttribute("loc") ?? ""),
          attributes: childAttributes(component),
        });
      });
      wires.forEach((wire, wireIndex) => {
        items.push({
          kind: "wire",
          circuit: name,
          wireIndex,
          from: parseLocation(wire.getAttribute("from") ?? ""),
          to: parseLocation(wire.getAttribute("to") ?? ""),
        });
      });
    }
    const page = items.slice(offset, offset + limit);
    return {
      path,
      sha256: revision,
      sourceVersion: root.getAttribute("source"),
      formatVersion: root.getAttribute("version"),
      mainCircuit: directChildren(root, "main")[0]?.getAttribute("name") ?? null,
      libraries,
      circuits: summaries,
      totalItems: items.length,
      offset,
      count: page.length,
      hasMore: offset + page.length < items.length,
      nextOffset: offset + page.length < items.length ? offset + page.length : null,
      items: page,
    };
  }

  async createProject(input: string, circuitName = "main", overwrite = false): Promise<Record<string, unknown>> {
    if (!/^[A-Za-z_][A-Za-z0-9_ -]{0,99}$/.test(circuitName)) {
      throw new Error("Circuit name must start with a letter or underscore and contain only letters, digits, spaces, '_' or '-'");
    }
    const initialPath = await this.projectPath(input, false);
    return await this.exclusiveWrite(async () => await this.withFileLocks([initialPath], async () => {
      const path = await this.projectPath(input, false);
      let exists = true;
      try {
        await access(path);
      } catch {
        exists = false;
      }
      if (exists && !overwrite) throw new Error(`Project already exists: ${path}`);

      const temporaryDirectory = await mkdtemp(join(dirname(path), ".logisim-mcp-create-"));
      const temporaryPath = join(temporaryDirectory, basename(path));
      const initialXml = emptyProjectXml(circuitName, this.templateVersion);
      await writeFile(temporaryPath, initialXml, { encoding: "utf8", flag: "wx", mode: 0o600 });
      try {
        const validation = this.validateWrites ? await this.validatePath(temporaryPath) : null;
        const backupPath = exists ? await this.backup(path) : null;
        if (exists) await this.preserveMetadata(path, temporaryPath);
        if (overwrite) {
          await rename(temporaryPath, path);
        } else {
          try {
            await link(temporaryPath, path);
          } catch (error) {
            if (errorCode(error) === "EEXIST") throw new Error(`Project was created concurrently and was not overwritten: ${path}`);
            throw error;
          }
          await rm(temporaryPath, { force: true });
        }
        return { path, circuitName, backupPath, validation, sha256: sha256(initialXml) };
      } catch (error) {
        throw error;
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }));
  }

  async copyCircuit(sourceInput: string, circuitName: string, destinationInput: string, overwrite = false): Promise<Record<string, unknown>> {
    const sourcePath = await this.projectPath(sourceInput);
    const initialDestinationPath = await this.projectPath(destinationInput, false);
    if (sourcePath === initialDestinationPath) throw new Error("Source and destination project paths must differ");
    return await this.exclusiveWrite(async () => await this.withFileLocks([sourcePath, initialDestinationPath], async () => {
      const source = await this.loadProject(sourcePath);
      this.assertNoExternalResources(source.document, source.path);
      const destinationPath = await this.projectPath(destinationInput, false);
      if (source.path === destinationPath) throw new Error("Source and destination project paths must differ");
      const root = this.root(source.document);
      const circuits = new Map(directChildren(root, "circuit").map((circuit) => [circuit.getAttribute("name") ?? "", circuit]));
      if (!circuits.has(circuitName)) throw new Error(`Circuit '${circuitName}' was not found in ${source.path}`);

      const closure = new Set<string>();
      const visit = (name: string): void => {
        if (closure.has(name)) return;
        const circuit = circuits.get(name);
        if (!circuit) throw new Error(`Subcircuit dependency '${name}' was not found in ${source.path}`);
        closure.add(name);
        for (const component of directChildren(circuit, "comp")) {
          if (component.hasAttribute("lib")) continue;
          const dependency = component.getAttribute("name");
          if (dependency && circuits.has(dependency)) visit(dependency);
        }
      };
      visit(circuitName);
      for (const [name, circuit] of circuits) if (!closure.has(name)) root.removeChild(circuit);
      const main = directChildren(root, "main")[0] ?? source.document.createElement("main");
      main.setAttribute("name", circuitName);
      if (!main.parentNode) root.insertBefore(main, directChildren(root, "circuit")[0] ?? null);
      for (const containerName of ["toolbar", "mappings"]) {
        const container = directChildren(root, containerName)[0];
        if (!container) continue;
        for (const tool of directChildren(container, "tool")) {
          const referencedName = tool.getAttribute("name");
          if (!tool.hasAttribute("lib") && referencedName && circuits.has(referencedName) && !closure.has(referencedName)) container.removeChild(tool);
        }
      }
      const saved = await this.saveDestination(destinationPath, source.document, overwrite);
      return {
        ...saved,
        sourcePath: source.path,
        sourceCircuit: circuitName,
        mainCircuit: circuitName,
        copiedCircuits: [...closure].sort(),
      };
    }));
  }

  async addCircuit(input: string, circuitName: string, setMain = false): Promise<MutationResult> {
    return await this.mutate(input, (document) => {
      const root = this.root(document);
      if (directChildren(root, "circuit").some((item) => item.getAttribute("name") === circuitName)) {
        throw new Error(`Circuit '${circuitName}' already exists`);
      }
      const circuit = document.createElement("circuit");
      circuit.setAttribute("name", circuitName);
      for (const [name, value] of Object.entries({
        appearance: "logisim_evolution",
        circuit: circuitName,
        circuitnamedboxfixedsize: "true",
        simulationFrequency: "1.0",
      })) {
        const attribute = document.createElement("a");
        attribute.setAttribute("name", name);
        attribute.setAttribute("val", value);
        circuit.appendChild(attribute);
      }
      root.appendChild(circuit);
      if (setMain) {
        const main = directChildren(root, "main")[0] ?? document.createElement("main");
        main.setAttribute("name", circuitName);
        if (!main.parentNode) root.insertBefore(main, circuit);
      }
    });
  }

  async setMainCircuit(input: string, circuitName: string): Promise<MutationResult> {
    return await this.mutate(input, (document) => {
      this.circuit(document, circuitName);
      const root = this.root(document);
      const main = directChildren(root, "main")[0] ?? document.createElement("main");
      main.setAttribute("name", circuitName);
      if (!main.parentNode) root.insertBefore(main, directChildren(root, "circuit")[0] ?? null);
    });
  }

  async addComponent(input: string, circuitName: string, componentInput: ComponentInput): Promise<MutationResult & { componentIndex: number }> {
    let componentIndex = -1;
    const result = await this.mutate(input, (document) => {
      const circuit = this.circuit(document, circuitName);
      const components = directChildren(circuit, "comp");
      const location = formatLocation(componentInput.x, componentInput.y);
      if (components.some((item) => item.getAttribute("name") === componentInput.name && item.getAttribute("loc") === location)) {
        throw new Error(`A ${componentInput.name} already exists at ${location}`);
      }
      const component = document.createElement("comp");
      if (componentInput.library !== undefined) component.setAttribute("lib", componentInput.library);
      component.setAttribute("name", componentInput.name);
      component.setAttribute("loc", location);
      for (const [name, value] of Object.entries(normalizedComponentAttributes(componentInput.library, componentInput.name, componentInput.attributes))) {
        const attribute = document.createElement("a");
        attribute.setAttribute("name", name);
        attribute.setAttribute("val", value);
        component.appendChild(attribute);
      }
      circuit.appendChild(component);
      componentIndex = components.length;
    });
    return { ...result, componentIndex };
  }

  async updateComponent(input: string, circuitName: string, componentIndex: number, update: ComponentUpdate): Promise<MutationResult> {
    return await this.mutate(input, (document) => {
      const circuit = this.circuit(document, circuitName);
      const component = directChildren(circuit, "comp")[componentIndex];
      if (!component) throw new Error(`Component index ${componentIndex} was not found in '${circuitName}'`);
      const oldLocation = parseLocation(component.getAttribute("loc") ?? "");
      if (update.x !== undefined || update.y !== undefined) {
        if (!oldLocation) throw new Error("Component has an invalid existing location");
        component.setAttribute("loc", formatLocation(update.x ?? oldLocation.x, update.y ?? oldLocation.y));
      }
      for (const [name, value] of Object.entries(update.attributes ?? {})) {
        const existing = directChildren(component, "a").find((item) => item.getAttribute("name") === name);
        if (value === null) {
          if (existing) component.removeChild(existing);
          continue;
        }
        const attribute = existing ?? document.createElement("a");
        attribute.setAttribute("name", name);
        attribute.setAttribute("val", value);
        if (!existing) component.appendChild(attribute);
      }
    });
  }

  async removeComponent(input: string, circuitName: string, componentIndex: number): Promise<MutationResult & { warning: string }> {
    const result = await this.mutate(input, (document) => {
      const circuit = this.circuit(document, circuitName);
      const component = directChildren(circuit, "comp")[componentIndex];
      if (!component) throw new Error(`Component index ${componentIndex} was not found in '${circuitName}'`);
      circuit.removeChild(component);
    });
    return { ...result, warning: "Connected wires are not removed automatically; inspect the circuit for dangling wires." };
  }

  async addWire(input: string, circuitName: string, fromX: number, fromY: number, toX: number, toY: number): Promise<MutationResult & { wireIndex: number }> {
    let wireIndex = -1;
    const result = await this.mutate(input, (document) => {
      if (fromX !== toX && fromY !== toY) throw new Error("Logisim wire segments must be horizontal or vertical");
      if (fromX === toX && fromY === toY) throw new Error("Wire endpoints must differ");
      const circuit = this.circuit(document, circuitName);
      const wires = directChildren(circuit, "wire");
      const from = formatLocation(fromX, fromY);
      const to = formatLocation(toX, toY);
      if (wires.some((item) => {
        const oldFrom = item.getAttribute("from");
        const oldTo = item.getAttribute("to");
        return (oldFrom === from && oldTo === to) || (oldFrom === to && oldTo === from);
      })) throw new Error(`Wire ${from} to ${to} already exists`);
      const wire = document.createElement("wire");
      wire.setAttribute("from", from);
      wire.setAttribute("to", to);
      circuit.appendChild(wire);
      wireIndex = wires.length;
    });
    return { ...result, wireIndex };
  }

  async applyBatch(
    input: string,
    circuitName: string,
    components: BatchComponentInput[],
    wires: WireInput[],
    replace = false,
  ): Promise<MutationResult & { componentIndexes: Array<{ id: string | null; index: number }>; wireIndexes: number[] }> {
    let componentIndexes: Array<{ id: string | null; index: number }> = [];
    let wireIndexes: number[] = [];
    const ids = new Set<string>();
    for (const component of components) {
      if (component.id !== undefined) {
        if (ids.has(component.id)) throw new Error(`Duplicate batch component id '${component.id}'`);
        ids.add(component.id);
      }
    }
    const result = await this.mutate(input, (document) => {
      const circuit = this.circuit(document, circuitName);
      if (replace) {
        for (const component of directChildren(circuit, "comp")) circuit.removeChild(component);
        for (const wire of directChildren(circuit, "wire")) circuit.removeChild(wire);
        for (const appearance of directChildren(circuit, "appear")) circuit.removeChild(appearance);
      }
      const existingComponents = directChildren(circuit, "comp");
      const occupiedComponents = new Set(existingComponents.map((component) => `${component.getAttribute("name") ?? ""}|${component.getAttribute("loc") ?? ""}`));
      componentIndexes = [];
      for (const componentInput of components) {
        const location = formatLocation(componentInput.x, componentInput.y);
        const identity = `${componentInput.name}|${location}`;
        if (occupiedComponents.has(identity)) throw new Error(`A ${componentInput.name} already exists at ${location}`);
        occupiedComponents.add(identity);
        const component = document.createElement("comp");
        if (componentInput.library !== undefined) component.setAttribute("lib", componentInput.library);
        component.setAttribute("name", componentInput.name);
        component.setAttribute("loc", location);
        for (const [name, value] of Object.entries(normalizedComponentAttributes(componentInput.library, componentInput.name, componentInput.attributes))) {
          const attribute = document.createElement("a");
          attribute.setAttribute("name", name);
          attribute.setAttribute("val", value);
          component.appendChild(attribute);
        }
        const index = directChildren(circuit, "comp").length;
        circuit.appendChild(component);
        componentIndexes.push({ id: componentInput.id ?? null, index });
      }

      const existingWires = directChildren(circuit, "wire");
      const occupiedWires = new Set(existingWires.map((wire) => {
        const endpoints = [wire.getAttribute("from") ?? "", wire.getAttribute("to") ?? ""].sort();
        return endpoints.join("|");
      }));
      wireIndexes = [];
      for (const wireInput of wires) {
        if (wireInput.fromX !== wireInput.toX && wireInput.fromY !== wireInput.toY) throw new Error("Logisim wire segments must be horizontal or vertical");
        if (wireInput.fromX === wireInput.toX && wireInput.fromY === wireInput.toY) throw new Error("Wire endpoints must differ");
        const from = formatLocation(wireInput.fromX, wireInput.fromY);
        const to = formatLocation(wireInput.toX, wireInput.toY);
        const identity = [from, to].sort().join("|");
        if (occupiedWires.has(identity)) throw new Error(`Wire ${from} to ${to} already exists`);
        occupiedWires.add(identity);
        const wire = document.createElement("wire");
        wire.setAttribute("from", from);
        wire.setAttribute("to", to);
        const index = directChildren(circuit, "wire").length;
        circuit.appendChild(wire);
        wireIndexes.push(index);
      }
    });
    return { ...result, componentIndexes, wireIndexes };
  }

  async layoutGraph(input: string, circuitName: string, request: LayoutGraphInput): Promise<MutationResult & { layout: LayoutPlan; componentIndexes: Record<string, number> }> {
    let layout: LayoutPlan | null = null;
    let componentIndexes: Record<string, number> = {};
    const result = await this.mutate(input, (document) => {
      const circuit = this.circuit(document, circuitName);
      const existingComponents = directChildren(circuit, "comp");
      const existingWires = directChildren(circuit, "wire");
      if (existingComponents.length > 0 || existingWires.length > 0) {
        throw new Error(`Circuit '${circuitName}' must be empty before logisim_layout_graph is used`);
      }
      layout = optimizeLayoutGraph(request);
      componentIndexes = {};
      for (const componentPlan of layout.components) {
        const component = document.createElement("comp");
        component.setAttribute("lib", componentPlan.library);
        component.setAttribute("name", componentPlan.name);
        component.setAttribute("loc", formatLocation(componentPlan.anchor.x, componentPlan.anchor.y));
        for (const [name, value] of Object.entries(componentPlan.attributes).sort(([left], [right]) => left.localeCompare(right))) {
          const attribute = document.createElement("a");
          attribute.setAttribute("name", name);
          attribute.setAttribute("val", value);
          component.appendChild(attribute);
        }
        componentIndexes[componentPlan.id] = directChildren(circuit, "comp").length;
        circuit.appendChild(component);
      }
      for (const wirePlan of layout.wires) {
        const wire = document.createElement("wire");
        wire.setAttribute("from", formatLocation(wirePlan.from.x, wirePlan.from.y));
        wire.setAttribute("to", formatLocation(wirePlan.to.x, wirePlan.to.y));
        circuit.appendChild(wire);
      }
    });
    if (!layout) throw new Error("Layout engine did not produce a plan");
    return { ...result, layout, componentIndexes };
  }

  async removeWire(input: string, circuitName: string, wireIndex: number): Promise<MutationResult> {
    return await this.mutate(input, (document) => {
      const circuit = this.circuit(document, circuitName);
      const wire = directChildren(circuit, "wire")[wireIndex];
      if (!wire) throw new Error(`Wire index ${wireIndex} was not found in '${circuitName}'`);
      circuit.removeChild(wire);
    });
  }

  async validateProject(input: string, timeoutMs = 30_000): Promise<ProcessResult & { path: string; valid: boolean }> {
    const path = await this.projectPath(input);
    return await this.exclusiveWrite(async () => await this.withFileLocks([path], async () => {
      const result = await this.validatePath(path, timeoutMs);
      return { ...result, path, valid: result.exitCode === 0 && !result.timedOut };
    }));
  }

  async truthTable(input: string, circuitName?: string, timeoutMs = 30_000): Promise<ProcessResult & { path: string }> {
    const path = await this.projectPath(input);
    return await this.withSecureProjectSnapshot(path, ".logisim-mcp-table-", async (snapshotPath) => {
      const args = ["--tty", "table"];
      if (circuitName) args.push("--toplevel-circuit", circuitName);
      args.push(snapshotPath);
      const result = await this.run(args, timeoutMs);
      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(`Truth-table analysis failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }
      return { ...result, path };
    });
  }

  async testVector(input: string, circuitName: string, vectorInput: string, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const path = await this.projectPath(input);
    const vectorPath = await this.workspaceFile(vectorInput);
    return await this.withSecureProjectSnapshot(path, ".logisim-mcp-vector-project-", async (projectSnapshot) => await this.withSecureSnapshot(vectorPath, ".logisim-mcp-vector-data-", async (vectorSnapshot) => {
      const result = await this.run(["--locale", "en", "--test-vector", circuitName, vectorSnapshot, projectSnapshot], timeoutMs);
      if (result.timedOut) {
        throw new Error(`Test-vector execution timed out after ${timeoutMs}ms`);
      }
      const match = /Passed:\s*(\d+),\s*Failed:\s*(\d+)/i.exec(`${result.stdout}\n${result.stderr}`);
      if (!match) {
        throw new Error(`Test-vector execution failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }
      const passed = Number(match[1]);
      const failed = Number(match[2]);
      return { ...result, path, vectorPath, passed, failed, success: failed === 0 && result.exitCode === 0 };
    }));
  }

  async testBench(input: string, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const path = await this.projectPath(input);
    return await this.withSecureProjectSnapshot(path, ".logisim-mcp-bench-", async (snapshotPath) => {
      const result = await this.run(["--locale", "en", "--test-circuit", snapshotPath], timeoutMs);
      if (result.exitCode !== 0 || result.timedOut) {
        throw new Error(`Test-bench execution failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
      }
      const output = `${result.stdout}\n${result.stderr}`;
      const passed = /Test bench pass/i.test(output);
      const failed = /Test bench fail/i.test(output);
      if (!passed && !failed) throw new Error(`Logisim did not report a test-bench result: ${result.stderr || result.stdout}`);
      return { ...result, path, passed, failed };
    });
  }

  async launchGui(input?: string, circuitName?: string): Promise<Record<string, unknown>> {
    const args = [...this.launcher.prefixArgs, "--no-splash"];
    let path: string | null = null;
    let projectHandle: FileHandle | null = null;
    if (circuitName) args.push("--toplevel-circuit", circuitName);
    if (input) {
      path = await this.projectPath(input);
      projectHandle = await this.openSecureFile(path);
      try {
        const xml = await projectHandle.readFile("utf8");
        this.assertNoExternalResources(this.parseProject(xml, path), path);
        // Linux can hand Logisim the already-validated descriptor; elsewhere pass the canonical path.
        args.push(IS_LINUX ? "/proc/self/fd/3" : path);
      } catch (error) {
        await projectHandle.close();
        throw error;
      }
    }
    const secureDescriptor = projectHandle !== null && IS_LINUX;
    const heldHandle = IS_LINUX ? projectHandle : null;
    if (!IS_LINUX && projectHandle) await projectHandle.close();
    let child: ReturnType<typeof spawn> | null = null;
    try {
      child = spawn(this.launcher.command, args, {
        detached: true,
        stdio: heldHandle ? ["ignore", "ignore", "ignore", heldHandle.fd] : "ignore",
      });
      await new Promise<void>((resolveSpawn, rejectSpawn) => {
        child!.once("spawn", resolveSpawn);
        child!.once("error", rejectSpawn);
      });
    } catch (error) {
      throw error;
    } finally {
      if (heldHandle) await heldHandle.close();
    }
    child.unref();
    return { launched: true, pid: child.pid, path, circuitName: circuitName ?? null, secureDescriptor };
  }

  async convertProject(input: string, outputInput: string, overwrite = false, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const sourcePath = await this.projectPath(input);
    const initialOutputPath = await this.projectPath(outputInput, false);
    return await this.exclusiveWrite(async () => await this.withFileLocks([sourcePath, initialOutputPath], async () => {
      const path = await this.projectPath(input);
      const outputPath = await this.projectPath(outputInput, false);
      let outputExists = true;
      try {
        await access(outputPath);
      } catch {
        outputExists = false;
      }
      if (outputExists && !overwrite) throw new Error(`Output project already exists: ${outputPath}`);
      const temporaryDirectory = await mkdtemp(join(dirname(outputPath), ".logisim-mcp-convert-"));
      const snapshotPath = join(temporaryDirectory, "source.circ");
      const temporaryPath = join(temporaryDirectory, basename(outputPath));
      try {
        const sourceXml = await this.readSecureFile(path);
        const sourceDocument = this.parseProject(sourceXml, path);
        this.assertNoExternalResources(sourceDocument, path);
        await writeFile(snapshotPath, sourceXml, { encoding: "utf8", flag: "wx", mode: 0o600 });
        const result = await this.run(["--locale", "en", "--new-file-format", snapshotPath, temporaryPath], timeoutMs);
        if (result.exitCode !== 0 || result.timedOut) {
          throw new Error(`Conversion failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
        }
        if (outputExists) await this.preserveMetadata(outputPath, temporaryPath);
        const convertedXml = await readFile(temporaryPath, "utf8");
        const sourceInventory = semanticInventory(sourceDocument);
        const convertedInventory = semanticInventory(this.parseProject(convertedXml, temporaryPath));
        if (JSON.stringify(sourceInventory) !== JSON.stringify(convertedInventory)) {
          throw new Error(`Conversion changed circuit geometry; output was not committed:\n${inventoryDifference(sourceInventory, convertedInventory).slice(0, 12).map((difference) => `- ${difference}`).join("\n")}`);
        }
        const backupPath = outputExists ? await this.backup(outputPath) : null;
        if (overwrite) {
          await rename(temporaryPath, outputPath);
        } else {
          try {
            await link(temporaryPath, outputPath);
          } catch (error) {
            if (errorCode(error) === "EEXIST") throw new Error(`Output was created concurrently and was not overwritten: ${outputPath}`);
            throw error;
          }
          await rm(temporaryPath, { force: true });
        }
        return { ...result, path, outputPath, backupPath };
      } catch (error) {
        throw error;
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }));
  }

  async readXml(input: string): Promise<{ path: string; sha256: string; xml: string }> {
    const path = await this.projectPath(input);
    const xml = await this.readSecureFile(path);
    this.parseProject(xml, path);
    return { path, sha256: sha256(xml), xml };
  }

  async importXml(input: string, xml: string, overwrite = false): Promise<{ path: string; backupPath: string | null; validation: ProcessResult | null; sha256: string; structure: StructureReport }> {
    assertSafeXmlText(xml);
    const initialPath = await this.projectPath(input, false);
    return await this.exclusiveWrite(async () => await this.withFileLocks([initialPath], async () => {
      const path = await this.projectPath(input, false);
      const document = this.parseProject(xml, path);
      this.assertNoExternalResources(document, path);
      return await this.saveDestination(path, document, overwrite);
    }));
  }

  async checkStructure(input: string): Promise<{ path: string; sha256: string } & StructureReport> {
    const path = await this.projectPath(input);
    const xml = await this.readSecureFile(path);
    const document = this.parseProject(xml, path);
    return { path, sha256: sha256(xml), ...checkStructure(document) };
  }

  private resolveLibraryNumber(document: Document, name: string, requestedLibrary?: string): string | undefined {
    const libs = directChildren(this.root(document), "lib");
    if (requestedLibrary !== undefined) {
      const match = libs.find((lib) => lib.getAttribute("name") === requestedLibrary || lib.getAttribute("desc") === requestedLibrary || lib.getAttribute("desc") === `#${requestedLibrary}`);
      if (!match) throw new Error(`Unknown library '${requestedLibrary}'`);
      return match.getAttribute("name") ?? requestedLibrary;
    }
    const catalogEntry = NATIVE_CATALOG.find((entry) => entry.components.includes(name));
    if (catalogEntry) {
      const match = libs.find((lib) => lib.getAttribute("desc") === catalogEntry.library || lib.getAttribute("name") === catalogEntry.defaultNumber);
      if (!match) throw new Error(`Project does not declare library ${catalogEntry.library}`);
      return match.getAttribute("name") ?? catalogEntry.defaultNumber;
    }
    if (directChildren(this.root(document), "circuit").some((c) => c.getAttribute("name") === name)) {
      return undefined;
    }
    throw new Error(`Unknown component '${name}'; specify its library number explicitly`);
  }

  async editProject(input: string, operations: EditOperation[], expectedSha256?: string): Promise<MutationResult & { applied: number }> {
    if (operations.length < 1 || operations.length > 5000) {
      throw new Error("Provide 1 to 5000 operations");
    }
    const result = await this.mutate(input, (document) => {
      const root = this.root(document);
      const findByAnchor = (circuitEl: Element, at: [number, number], name?: string): Element => {
        const loc = formatLocation(at[0], at[1]);
        const matches = directChildren(circuitEl, "comp").filter((comp) => comp.getAttribute("loc") === loc && (!name || comp.getAttribute("name") === name));
        if (matches.length === 0) throw new Error(`No component found at ${loc}${name ? ` named '${name}'` : ""}`);
        if (matches.length > 1) throw new Error(`Multiple components occupy ${loc}; specify 'name' to disambiguate`);
        return matches[0]!;
      };

      for (const op of operations) {
        if (op.action === "add_circuit") {
          if (!op.name || directChildren(root, "circuit").some((c) => c.getAttribute("name") === op.name)) {
            throw new Error(`Circuit '${op.name}' must be non-empty and unique`);
          }
          const circuitEl = document.createElement("circuit");
          circuitEl.setAttribute("name", op.name);
          for (const [k, v] of Object.entries({ appearance: "logisim_evolution", circuit: op.name, circuitnamedboxfixedsize: "true", simulationFrequency: "1.0" })) {
            const attr = document.createElement("a");
            attr.setAttribute("name", k);
            attr.setAttribute("val", v);
            circuitEl.appendChild(attr);
          }
          root.appendChild(circuitEl);
          if (op.set_main) {
            const main = directChildren(root, "main")[0] ?? document.createElement("main");
            main.setAttribute("name", op.name);
            if (!main.parentNode) root.insertBefore(main, circuitEl);
          }
          continue;
        }
        if (op.action === "set_main") {
          this.circuit(document, op.name);
          const main = directChildren(root, "main")[0] ?? document.createElement("main");
          main.setAttribute("name", op.name);
          if (!main.parentNode) root.insertBefore(main, directChildren(root, "circuit")[0] ?? null);
          continue;
        }
        const circuitName = op.circuit ?? directChildren(root, "main")[0]?.getAttribute("name") ?? "main";
        const circuitEl = this.circuit(document, circuitName);
        if (op.action === "add_component") {
          const loc = formatLocation(op.at[0], op.at[1]);
          if (directChildren(circuitEl, "comp").some((comp) => comp.getAttribute("loc") === loc)) {
            throw new Error(`A component already occupies ${loc}`);
          }
          const lib = this.resolveLibraryNumber(document, op.name, op.library);
          const comp = document.createElement("comp");
          if (lib !== undefined) comp.setAttribute("lib", lib);
          comp.setAttribute("name", op.name);
          comp.setAttribute("loc", loc);
          const stringAttrs: Record<string, string> = {};
          for (const [k, v] of Object.entries(op.attributes ?? {})) {
            stringAttrs[k] = typeof v === "boolean" ? String(v).toLowerCase() : String(v);
          }
          for (const [k, v] of Object.entries(normalizedComponentAttributes(lib, op.name, stringAttrs))) {
            const attr = document.createElement("a");
            attr.setAttribute("name", k);
            attr.setAttribute("val", v);
            comp.appendChild(attr);
          }
          circuitEl.appendChild(comp);
        } else if (op.action === "set_attributes") {
          const comp = findByAnchor(circuitEl, op.at, op.name);
          for (const [k, v] of Object.entries(op.attributes)) {
            const existing = directChildren(comp, "a").find((a) => a.getAttribute("name") === k);
            if (v === null) {
              if (existing) comp.removeChild(existing);
              continue;
            }
            const valStr = typeof v === "boolean" ? String(v).toLowerCase() : String(v);
            const attr = existing ?? document.createElement("a");
            attr.setAttribute("name", k);
            attr.setAttribute("val", valStr);
            if (!existing) comp.appendChild(attr);
          }
        } else if (op.action === "move_component") {
          const comp = findByAnchor(circuitEl, op.at, op.name);
          const destLoc = formatLocation(op.to[0], op.to[1]);
          if (directChildren(circuitEl, "comp").some((other) => other !== comp && other.getAttribute("loc") === destLoc)) {
            throw new Error(`Destination anchor ${destLoc} is already occupied`);
          }
          comp.setAttribute("loc", destLoc);
        } else if (op.action === "remove_component") {
          const comp = findByAnchor(circuitEl, op.at, op.name);
          const loc = comp.getAttribute("loc") ?? "";
          circuitEl.removeChild(comp);
          if (op.remove_wires) {
            for (const wire of directChildren(circuitEl, "wire")) {
              if (wire.getAttribute("from") === loc || wire.getAttribute("to") === loc) {
                circuitEl.removeChild(wire);
              }
            }
          }
        } else if (op.action === "add_wire") {
          if (op.points.length < 2) throw new Error("add_wire requires at least 2 points");
          for (let i = 0; i < op.points.length - 1; i += 1) {
            const a = op.points[i]!;
            const b = op.points[i + 1]!;
            if (a[0] !== b[0] && a[1] !== b[1]) throw new Error("Wire segments must be horizontal or vertical");
            if (a[0] === b[0] && a[1] === b[1]) throw new Error("Wire segment endpoints must differ");
            const from = formatLocation(a[0], a[1]);
            const to = formatLocation(b[0], b[1]);
            const dup = directChildren(circuitEl, "wire").some((w) => {
              const wf = w.getAttribute("from");
              const wt = w.getAttribute("to");
              return (wf === from && wt === to) || (wf === to && wt === from);
            });
            if (!dup) {
              const wire = document.createElement("wire");
              wire.setAttribute("from", from);
              wire.setAttribute("to", to);
              circuitEl.appendChild(wire);
            }
          }
        } else if (op.action === "remove_wire") {
          const from = formatLocation(op.from[0], op.from[1]);
          const to = formatLocation(op.to[0], op.to[1]);
          const matches = directChildren(circuitEl, "wire").filter((w) => {
            const wf = w.getAttribute("from");
            const wt = w.getAttribute("to");
            return (wf === from && wt === to) || (wf === to && wt === from);
          });
          if (matches.length === 0) throw new Error(`Wire ${from} <-> ${to} not found`);
          for (const wire of matches) circuitEl.removeChild(wire);
        }
      }
    }, expectedSha256);
    return { ...result, applied: operations.length };
  }

  async runTestVectors(input: string, vectors: string, circuitName = "main", timeoutMs = 60_000): Promise<Record<string, unknown>> {
    if (Buffer.byteLength(vectors, "utf8") > 1_000_000) throw new Error("Test vectors exceed 1 MB limit");
    const path = await this.projectPath(input);
    const tempDir = await mkdtemp(join(dirname(path), ".logisim-mcp-vec-"));
    const vectorPath = join(tempDir, "vectors.txt");
    try {
      await writeFile(vectorPath, vectors, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return await this.withSecureProjectSnapshot(path, ".logisim-mcp-vector-project-", async (projectSnapshot) => {
        const result = await this.run(["--locale", "en", "--test-vector", circuitName, vectorPath, projectSnapshot], timeoutMs);
        if (result.timedOut) throw new Error(`Test-vector execution timed out after ${timeoutMs}ms`);
        const match = /Passed:\s*(\d+),\s*Failed:\s*(\d+)/i.exec(`${result.stdout}\n${result.stderr}`);
        if (!match) throw new Error(`Test-vector execution failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
        const passed = Number(match[1]);
        const failed = Number(match[2]);
        return { ...result, path, circuitName, passed, failed, success: failed === 0 && result.exitCode === 0 };
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async synthesizeLogic(
    input: string,
    inputs: string[],
    outputs: Record<string, string>,
    options: { circuitName?: string; overwrite?: boolean; verify?: boolean; style?: SynthesisStyle; timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const circuitName = options.circuitName ?? "main";
    const overwrite = options.overwrite ?? false;
    const verify = options.verify ?? true;
    const style = options.style ?? "auto";
    const timeoutMs = options.timeoutMs ?? 60_000;

    if (!/^[A-Za-z_][A-Za-z0-9_ -]{0,99}$/.test(circuitName)) {
      throw new Error("Circuit name must start with a letter or underscore and contain only letters, digits, spaces, '_' or '-'");
    }

    const synthesis = synthesizeCircuit({ inputs, outputs }, style);
    const initialPath = await this.projectPath(input, false);
    const saved = await this.exclusiveWrite(async () => await this.withFileLocks([initialPath], async () => {
      const path = await this.projectPath(input, false);
      const document = this.parseProject(emptyProjectXml(circuitName, this.templateVersion), path);
      const circuitEl = this.circuit(document, circuitName);
      for (const comp of synthesis.components) {
        const element = document.createElement("comp");
        element.setAttribute("lib", comp.library);
        element.setAttribute("name", comp.name);
        element.setAttribute("loc", formatLocation(comp.x, comp.y));
        for (const [k, v] of Object.entries(normalizedComponentAttributes(comp.library, comp.name, comp.attributes))) {
          const attr = document.createElement("a");
          attr.setAttribute("name", k);
          attr.setAttribute("val", v);
          element.appendChild(attr);
        }
        circuitEl.appendChild(element);
      }
      for (const seg of synthesis.wires) {
        const wire = document.createElement("wire");
        wire.setAttribute("from", formatLocation(seg.fromX, seg.fromY));
        wire.setAttribute("to", formatLocation(seg.toX, seg.toY));
        circuitEl.appendChild(wire);
      }
      return await this.saveDestination(path, document, overwrite);
    }));

    let simulation: Record<string, unknown>;
    if (verify) {
      try {
        simulation = await this.runTestVectors(saved.path, synthesis.vectors, circuitName, timeoutMs);
      } catch (error) {
        simulation = { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    } else {
      simulation = { status: "not_run" };
    }

    return {
      ...saved,
      circuitName,
      style: synthesis.style,
      fallbackReason: synthesis.fallbackReason,
      gateCount: synthesis.gateCount,
      simplified: synthesis.simplified,
      truthTableRows: synthesis.truthTable.rows.length,
      testVectors: synthesis.vectors,
      simulation,
    };
  }

  async createExample(
    input: string,
    example: string,
    options: { overwrite?: boolean; verify?: boolean; style?: SynthesisStyle; timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const entry = EXAMPLES[example];
    if (!entry) {
      throw new Error(`Unknown example '${example}'. Choose one of: ${Object.keys(EXAMPLES).join(", ")}`);
    }
    const result = await this.synthesizeLogic(input, entry.spec.inputs, entry.spec.outputs, options);
    return { example, description: entry.description, ...result };
  }
}

export const internals = { directChildren, parseLocation, formatLocation };
