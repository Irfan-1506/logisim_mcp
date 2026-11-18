import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LogisimService } from "./logisim.js";
import type { EditOperation } from "./logisim.js";
import { EXAMPLES } from "./synthesis.js";

const projectPath = z.string().min(1).max(4096).describe(".circ path, absolute or relative to LOGISIM_WORKSPACE");
const circuitName = z.string().min(1).max(100).describe("Circuit name exactly as stored in the project");
const coordinate = z.number().int().min(-1_000_000).max(1_000_000);
const timeoutMs = z.number().int().min(1_000).max(120_000).default(30_000);
const stringAttributes = z.record(z.string().min(1).max(200), z.string().max(100_000));
const componentInputSchema = z.object({
  id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/).optional(),
  library: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  x: coordinate,
  y: coordinate,
  attributes: stringAttributes.optional(),
});
const wireInputSchema = z.object({
  from_x: coordinate,
  from_y: coordinate,
  to_x: coordinate,
  to_y: coordinate,
});
const layoutEndpoint = z.object({
  component: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/).describe("Component id from the components array"),
  port: z.string().min(1).max(100).describe("Semantic catalog port such as port, in0, out, a, b, sum, cin, or cout"),
}).strict();
const layoutWeights = z.object({
  length: z.number().min(0).max(1_000_000).optional(),
  bends: z.number().min(0).max(1_000_000).optional(),
  crossings: z.number().min(0).max(1_000_000).optional(),
  overlap: z.number().min(0).max(1_000_000).optional(),
  spacing: z.number().min(0).max(1_000_000).optional(),
  alignment: z.number().min(0).max(1_000_000).optional(),
  congestion: z.number().min(0).max(1_000_000).optional(),
}).strict().optional();
const layoutOptions = z.object({
  grid: z.number().int().min(5).max(100).optional(),
  component_clearance: z.number().int().min(0).max(500).optional(),
  wire_clearance: z.number().int().min(0).max(200).optional(),
  wire_spacing: z.number().int().min(0).max(200).optional(),
  layer_spacing: z.number().int().min(10).max(1000).optional(),
  row_spacing: z.number().int().min(10).max(1000).optional(),
  minimum_distance: z.number().int().min(0).max(2000).optional(),
  maximum_distance: z.number().int().min(1).max(4000).optional(),
  congestion_region_size: z.number().int().min(10).max(500).optional(),
  congestion_limit: z.number().int().min(1).max(100).optional(),
  max_candidates: z.number().int().min(1).max(12).optional(),
  max_astar_states: z.number().int().min(1000).max(1_000_000).optional(),
  weights: layoutWeights,
}).strict().optional();
const layoutGraphSchema = z.object({
  path: projectPath,
  circuit: circuitName,
  components: z.array(z.object({
    id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/),
    library: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    attributes: stringAttributes.optional(),
  }).strict()).min(2).max(64),
  connections: z.array(z.object({
    from: layoutEndpoint,
    to: layoutEndpoint,
    net: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.:-]{0,99}$/).optional(),
  }).strict()).min(1).max(128),
  region: z.object({ left: coordinate, top: coordinate, right: coordinate, bottom: coordinate }).strict().optional(),
  options: layoutOptions,
}).strict();
type LayoutGraphToolInput = z.infer<typeof layoutGraphSchema>;

const pointTuple = z.tuple([coordinate, coordinate]);
const attrPrimitive = z.union([z.string().max(100_000), z.number(), z.boolean()]);
const editOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_circuit"), name: circuitName, set_main: z.boolean().optional() }),
  z.object({ action: z.literal("set_main"), name: circuitName }),
  z.object({ action: z.literal("add_component"), circuit: circuitName.optional(), library: z.string().max(100).optional(), name: z.string().min(1).max(200), at: pointTuple, attributes: z.record(z.string().min(1).max(200), attrPrimitive).optional() }),
  z.object({ action: z.literal("set_attributes"), circuit: circuitName.optional(), at: pointTuple, name: z.string().min(1).max(200).optional(), attributes: z.record(z.string().min(1).max(200), attrPrimitive.nullable()) }),
  z.object({ action: z.literal("move_component"), circuit: circuitName.optional(), at: pointTuple, name: z.string().min(1).max(200).optional(), to: pointTuple }),
  z.object({ action: z.literal("remove_component"), circuit: circuitName.optional(), at: pointTuple, name: z.string().min(1).max(200).optional(), remove_wires: z.boolean().optional() }),
  z.object({ action: z.literal("add_wire"), circuit: circuitName.optional(), points: z.array(pointTuple).min(2).max(500) }),
  z.object({ action: z.literal("remove_wire"), circuit: circuitName.optional(), from: pointTuple, to: pointTuple }),
]);
const synthesisStyle = z.enum(["auto", "wires", "tunnels"]).default("auto");
const exampleNames = Object.keys(EXAMPLES) as [string, ...string[]];

function response(payload: unknown) {
  const structured = payload as Record<string, unknown>;
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], structuredContent: structured };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text" as const, text: `Logisim operation failed: ${message}` }] };
}

function annotations(readOnly: boolean, destructive = false): ToolAnnotations {
  return { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: false };
}

export class LogisimMcpServer {
  private readonly server = new McpServer({ name: "logisim-evolution-mcp-server", version: "0.4.0" });

  constructor(readonly service = new LogisimService()) {
    this.registerTools();
    this.registerResourcesAndPrompts();
  }

  private tool<T>(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema: z.ZodType<T>;
      annotations?: ToolAnnotations;
    },
    handler: (input: T) => Promise<unknown>,
  ): void {
    this.server.registerTool(name, config, async (input) => {
      try {
        return response(await handler(input));
      } catch (error) {
        return failure(error);
      }
    });
  }

  private registerTools(): void {
    this.tool<Record<string, never>>(
      "logisim_get_status",
      { title: "Get Logisim Status", description: "Get the installed Logisim-evolution version, configured workspace, write-validation setting, and running Logisim processes.", inputSchema: z.object({}), annotations: annotations(true) },
      async () => await this.service.status(),
    );

    this.tool<{ library?: string; name?: string; attributes?: Record<string, string> }>(
      "logisim_describe_component",
      {
        title: "Describe Logisim Component",
        description: "List the source-verified component catalog, or describe one component's accepted attributes, valid values, defaults, relative bounds, semantic ports, roles, widths, required status, and legacy aliases. Supply attributes to resolve dynamic geometry such as width, input count, appearance, facing, or Pin direction.",
        inputSchema: z.object({ library: z.string().max(100).optional(), name: z.string().min(1).max(200).optional(), attributes: stringAttributes.optional() }),
        annotations: annotations(true),
      },
      async ({ library, name, attributes }) => await this.service.describeComponent(library, name, attributes),
    );

    this.tool<{ directory: string; max_depth: number; limit: number }>(
      "logisim_list_projects",
      { title: "List Logisim Projects", description: "Find .circ projects below a directory in the configured workspace. Search is bounded by depth and result limit.", inputSchema: z.object({ directory: z.string().default("."), max_depth: z.number().int().min(0).max(8).default(3), limit: z.number().int().min(1).max(500).default(100) }), annotations: annotations(true) },
      async ({ directory, max_depth, limit }) => await this.service.listProjects(directory, max_depth, limit),
    );

    this.tool<{ path: string; circuit?: string; offset: number; limit: number }>(
      "logisim_inspect_project",
      { title: "Inspect Logisim Project", description: "Read a .circ project as structured data: libraries, circuits, component indexes, component attributes, and wire indexes. Use returned indexes for update/remove tools.", inputSchema: z.object({ path: projectPath, circuit: circuitName.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(1000).default(200) }), annotations: annotations(true) },
      async ({ path, circuit, offset, limit }) => await this.service.inspectProject(path, circuit, offset, limit),
    );

    this.tool<{ path: string; circuit: string; overwrite: boolean }>(
      "logisim_create_project",
      { title: "Create Logisim Project", description: "Create a valid Logisim-evolution 4.0.0 .circ project with built-in libraries and one empty circuit.", inputSchema: z.object({ path: projectPath, circuit: circuitName.default("main"), overwrite: z.boolean().default(false) }), annotations: annotations(false, true) },
      async ({ path, circuit, overwrite }) => await this.service.createProject(path, circuit, overwrite),
    );

    this.tool<{ source_path: string; circuit: string; destination_path: string; overwrite: boolean }>(
      "logisim_copy_circuit",
      {
        title: "Copy Logisim Circuit",
        description: "Copy one circuit and its transitive subcircuit dependencies from an existing project into a new project in one operation. Project libraries and settings are preserved, unrelated circuits are removed, and the copied circuit becomes main. The destination is validated before atomic creation or replacement.",
        inputSchema: z.object({ source_path: projectPath, circuit: circuitName, destination_path: projectPath, overwrite: z.boolean().default(false) }),
        annotations: annotations(false, true),
      },
      async ({ source_path, circuit, destination_path, overwrite }) => await this.service.copyCircuit(source_path, circuit, destination_path, overwrite),
    );

    this.tool<{ path: string; circuit: string; set_main: boolean }>(
      "logisim_add_circuit",
      { title: "Add Logisim Circuit", description: "Add an empty subcircuit to a project, optionally making it the main circuit. The original project is backed up first.", inputSchema: z.object({ path: projectPath, circuit: circuitName, set_main: z.boolean().default(false) }), annotations: annotations(false, true) },
      async ({ path, circuit, set_main }) => await this.service.addCircuit(path, circuit, set_main),
    );

    this.tool<{ path: string; circuit: string }>(
      "logisim_set_main_circuit",
      { title: "Set Main Circuit", description: "Set an existing circuit as the project's main circuit.", inputSchema: z.object({ path: projectPath, circuit: circuitName }), annotations: annotations(false, true) },
      async ({ path, circuit }) => await this.service.setMainCircuit(path, circuit),
    );

    this.tool<{ path: string; circuit: string; library?: string; name: string; x: number; y: number; attributes?: Record<string, string> }>(
      "logisim_add_component",
      { title: "Add Logisim Component", description: "Add a component to a circuit using Logisim's library number, component name, location, and XML attributes. Omit library when placing a subcircuit component.", inputSchema: z.object({ path: projectPath, circuit: circuitName, library: z.string().max(100).optional(), name: z.string().min(1).max(200), x: coordinate, y: coordinate, attributes: stringAttributes.optional() }), annotations: annotations(false) },
      async ({ path, circuit, library, name, x, y, attributes }) => await this.service.addComponent(path, circuit, { library, name, x, y, attributes }),
    );

    this.tool<{ path: string; circuit: string; component_index: number; x?: number; y?: number; attributes?: Record<string, string | null> }>(
      "logisim_update_component",
      { title: "Update Logisim Component", description: "Move a component and set or remove component attributes. Use the componentIndex returned by logisim_inspect_project; null removes an attribute.", inputSchema: z.object({ path: projectPath, circuit: circuitName, component_index: z.number().int().min(0), x: coordinate.optional(), y: coordinate.optional(), attributes: z.record(z.string().min(1).max(200), z.string().max(100_000).nullable()).optional() }), annotations: annotations(false, true) },
      async ({ path, circuit, component_index, x, y, attributes }) => await this.service.updateComponent(path, circuit, component_index, { x, y, attributes }),
    );

    this.tool<{ path: string; circuit: string; component_index: number }>(
      "logisim_remove_component",
      { title: "Remove Logisim Component", description: "Remove one component by its current circuit-local component index. Wires are intentionally left unchanged for explicit review.", inputSchema: z.object({ path: projectPath, circuit: circuitName, component_index: z.number().int().min(0) }), annotations: annotations(false, true) },
      async ({ path, circuit, component_index }) => await this.service.removeComponent(path, circuit, component_index),
    );

    this.tool<{ path: string; circuit: string; from_x: number; from_y: number; to_x: number; to_y: number }>(
      "logisim_add_wire",
      { title: "Add Logisim Wire", description: "Add one horizontal or vertical wire segment between two circuit coordinates.", inputSchema: z.object({ path: projectPath, circuit: circuitName, from_x: coordinate, from_y: coordinate, to_x: coordinate, to_y: coordinate }), annotations: annotations(false) },
      async ({ path, circuit, from_x, from_y, to_x, to_y }) => await this.service.addWire(path, circuit, from_x, from_y, to_x, to_y),
    );

    this.tool<{ path: string; circuit: string; wire_index: number }>(
      "logisim_remove_wire",
      { title: "Remove Logisim Wire", description: "Remove one wire segment by its current circuit-local wire index.", inputSchema: z.object({ path: projectPath, circuit: circuitName, wire_index: z.number().int().min(0) }), annotations: annotations(false, true) },
      async ({ path, circuit, wire_index }) => await this.service.removeWire(path, circuit, wire_index),
    );

    this.tool<{
      path: string;
      circuit: string;
      components: Array<{ id?: string; library?: string; name: string; x: number; y: number; attributes?: Record<string, string> }>;
      wires: Array<{ from_x: number; from_y: number; to_x: number; to_y: number }>;
      replace: boolean;
    }>(
      "logisim_apply_batch",
      {
        title: "Apply Logisim Component and Wire Batch",
        description: "Atomically add arrays of components and orthogonal wires to one circuit in a single call and validation pass. Optional component ids are returned with their indexes. Set replace=true only to remove all existing components, wires, and stale custom appearance data before applying the batch; circuit attributes are preserved.",
        inputSchema: z.object({
          path: projectPath,
          circuit: circuitName,
          components: z.array(componentInputSchema).max(2000).default([]),
          wires: z.array(wireInputSchema).max(10000).default([]),
          replace: z.boolean().default(false),
        }),
        annotations: annotations(false, true),
      },
      async ({ path, circuit, components, wires, replace }) => await this.service.applyBatch(
        path,
        circuit,
        components,
        wires.map((wire) => ({ fromX: wire.from_x, fromY: wire.from_y, toX: wire.to_x, toY: wire.to_y })),
        replace,
      ),
    );

    this.tool<LayoutGraphToolInput>(
      "logisim_layout_graph",
      {
        title: "Layout and Build Logisim Graph",
        description: "Atomically populate an empty circuit from semantic components and directed connections. Every returned plan carries an independently recomputed geometric certificate covering visible component footprints, component and wire clearances, wire spacing, region and grid containment, exact directional port escapes, crossing-free orthogonal routing, and acyclic connected net trees; infeasible graphs fail without writing XML.",
        inputSchema: layoutGraphSchema,
        annotations: annotations(false),
      },
      async ({ path, circuit, components, connections, region, options }) => await this.service.layoutGraph(path, circuit, {
        components,
        connections,
        region,
        options: options ? {
          grid: options.grid,
          componentClearance: options.component_clearance,
          wireClearance: options.wire_clearance,
          wireSpacing: options.wire_spacing,
          layerSpacing: options.layer_spacing,
          rowSpacing: options.row_spacing,
          minimumDistance: options.minimum_distance,
          maximumDistance: options.maximum_distance,
          congestionRegionSize: options.congestion_region_size,
          congestionLimit: options.congestion_limit,
          maxCandidates: options.max_candidates,
          maxAStarStates: options.max_astar_states,
          weights: options.weights,
        } : undefined,
      }),
    );

    this.tool<{ path: string; timeout_ms: number }>(
      "logisim_validate_project",
      { title: "Validate Logisim Project", description: "Ask the installed Logisim-evolution CLI to load the project headlessly and report component statistics or load errors.", inputSchema: z.object({ path: projectPath, timeout_ms: timeoutMs }), annotations: annotations(true) },
      async ({ path, timeout_ms }) => await this.service.validateProject(path, timeout_ms),
    );

    this.tool<{ path: string; circuit?: string; timeout_ms: number }>(
      "logisim_truth_table",
      { title: "Generate Truth Table", description: "Run Logisim's headless combinational truth-table analysis for the main circuit or a named circuit. Large input widths can produce exponential output and may time out.", inputSchema: z.object({ path: projectPath, circuit: circuitName.optional(), timeout_ms: timeoutMs }), annotations: annotations(true) },
      async ({ path, circuit, timeout_ms }) => await this.service.truthTable(path, circuit, timeout_ms),
    );

    this.tool<{ path: string; circuit: string; vector_path: string; timeout_ms: number }>(
      "logisim_test_vector",
      { title: "Run Test Vector", description: "Run a Logisim .txt test vector against matching labeled pins and return parsed passed/failed counts plus raw output.", inputSchema: z.object({ path: projectPath, circuit: circuitName, vector_path: z.string().min(1).max(4096), timeout_ms: timeoutMs.default(60_000) }), annotations: annotations(true) },
      async ({ path, circuit, vector_path, timeout_ms }) => await this.service.testVector(path, circuit, vector_path, timeout_ms),
    );

    this.tool<{ path: string; timeout_ms: number }>(
      "logisim_test_bench",
      { title: "Run Test Bench", description: "Run Logisim's built-in test-bench convention (logisim_test_verif with test_bench_done_o and test_bench_ok_o outputs).", inputSchema: z.object({ path: projectPath, timeout_ms: timeoutMs.default(60_000) }), annotations: annotations(true) },
      async ({ path, timeout_ms }) => await this.service.testBench(path, timeout_ms),
    );

    this.tool<{ path?: string; circuit?: string }>(
      "logisim_launch_gui",
      { title: "Launch Logisim GUI", description: "Launch Logisim-evolution detached from the MCP server, optionally opening a project and selecting a top-level circuit. This does not control an already-running window.", inputSchema: z.object({ path: projectPath.optional(), circuit: circuitName.optional() }), annotations: annotations(false) },
      async ({ path, circuit }) => await this.service.launchGui(path, circuit),
    );

    this.tool<{ path: string; output_path: string; overwrite: boolean; timeout_ms: number }>(
      "logisim_convert_project",
      { title: "Convert Logisim Project", description: "Open a project of an older supported Logisim format and save it in the installed Logisim-evolution version's current format.", inputSchema: z.object({ path: projectPath, output_path: projectPath, overwrite: z.boolean().default(false), timeout_ms: timeoutMs.default(60_000) }), annotations: annotations(false, true) },
      async ({ path, output_path, overwrite, timeout_ms }) => await this.service.convertProject(path, output_path, overwrite, timeout_ms),
    );

    this.tool<{ path: string }>(
      "logisim_read_xml",
      { title: "Read Project XML", description: "Read raw .circ XML (including custom appearances and memory contents) along with its SHA256 revision hash.", inputSchema: z.object({ path: projectPath }), annotations: annotations(true) },
      async ({ path }) => await this.service.readXml(path),
    );

    this.tool<{ path: string; xml: string; overwrite: boolean }>(
      "logisim_import_xml",
      { title: "Import Project XML", description: "Validate and save complete native .circ XML (forbids DTD/entities and external jar#/file#/filePath resources). Existing files require overwrite=true and are backed up first.", inputSchema: z.object({ path: projectPath, xml: z.string().min(1).max(20_000_000), overwrite: z.boolean().default(false) }), annotations: annotations(false, true) },
      async ({ path, xml, overwrite }) => await this.service.importXml(path, xml, overwrite),
    );

    this.tool<{ path: string }>(
      "logisim_check_structure",
      { title: "Check Project Structure", description: "Run fast Java-free structural validation on a .circ project (XML, libraries, subcircuit references, recursion, 10-unit grid, and orthogonal wires). Electrical verification still requires Logisim simulation.", inputSchema: z.object({ path: projectPath }), annotations: annotations(true) },
      async ({ path }) => await this.service.checkStructure(path),
    );

    this.tool<{ path: string; operations: EditOperation[]; expected_sha256?: string }>(
      "logisim_edit_project",
      { title: "Edit Project by Anchor", description: "Atomically apply anchor-addressed operations (add_circuit, set_main, add_component, set_attributes, move_component, remove_component, add_wire, remove_wire). Pass expected_sha256 from logisim_inspect_project to prevent stale edits.", inputSchema: z.object({ path: projectPath, operations: z.array(editOperationSchema).min(1).max(5000), expected_sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional() }), annotations: annotations(false, true) },
      async ({ path, operations, expected_sha256 }) => await this.service.editProject(path, operations, expected_sha256),
    );

    this.tool<{ path: string; vectors: string; circuit: string; timeout_ms: number }>(
      "logisim_run_test_vectors",
      { title: "Run Inline Test Vectors", description: "Run inline Logisim test-vector text (header of pin labels followed by rows) against a circuit without needing a separate .txt file on disk.", inputSchema: z.object({ path: projectPath, vectors: z.string().min(1).max(1_000_000), circuit: circuitName.default("main"), timeout_ms: timeoutMs.default(60_000) }), annotations: annotations(true) },
      async ({ path, vectors, circuit, timeout_ms }) => await this.service.runTestVectors(path, vectors, circuit, timeout_ms),
    );

    this.tool<{ path: string; inputs: string[]; outputs: Record<string, string>; circuit: string; overwrite: boolean; verify: boolean; style: "auto" | "wires" | "tunnels"; timeout_ms: number }>(
      "logisim_synthesize_logic",
      { title: "Synthesize Combinational Logic", description: "Parse 1-bit Boolean expressions (~, &, |, ^, parentheses, 0/1; up to 12 inputs, 32 outputs), share common sub-expressions, lay out native gates (style='wires' for certified orthogonal routing, 'tunnels' for labeled tunnels, or 'auto'), save .circ, and optionally run exhaustive truth-table simulation.", inputSchema: z.object({ path: projectPath, inputs: z.array(z.string().min(1).max(32)).min(1).max(12), outputs: z.record(z.string().min(1).max(32), z.string().min(1).max(4096)), circuit: circuitName.default("main"), overwrite: z.boolean().default(false), verify: z.boolean().default(true), style: synthesisStyle, timeout_ms: timeoutMs.default(60_000) }), annotations: annotations(false, true) },
      async ({ path, inputs, outputs, circuit, overwrite, verify, style, timeout_ms }) => await this.service.synthesizeLogic(path, inputs, outputs, { circuitName: circuit, overwrite, verify, style, timeoutMs: timeout_ms }),
    );

    this.tool<{ path: string; example: string; overwrite: boolean; verify: boolean; style: "auto" | "wires" | "tunnels"; timeout_ms: number }>(
      "logisim_create_example",
      { title: "Create Example Circuit", description: `Create and optionally verify a standard combinational example circuit (${exampleNames.join(", ")}).`, inputSchema: z.object({ path: projectPath, example: z.enum(exampleNames).default("full_adder"), overwrite: z.boolean().default(false), verify: z.boolean().default(true), style: synthesisStyle, timeout_ms: timeoutMs.default(60_000) }), annotations: annotations(false, true) },
      async ({ path, example, overwrite, verify, style, timeout_ms }) => await this.service.createExample(path, example, { overwrite, verify, style, timeoutMs: timeout_ms }),
    );
  }

  private registerResourcesAndPrompts(): void {
    this.server.registerResource(
      "guide",
      "logisim://guide",
      { title: "Logisim-evolution MCP Workflow Guide", description: "Recommended workflow for designing, routing, synthesizing, and verifying .circ projects.", mimeType: "text/plain" },
      async (uri) => ({
        contents: [{
          uri: uri.href,
          text: [
            "Logisim-evolution Unified MCP Workflow:",
            "1. Call logisim_get_status and logisim_describe_component to discover the environment and verified component geometry.",
            "2. For combinational 1-bit Boolean equations, use logisim_synthesize_logic (style='auto' uses certified orthogonal wires for small circuits and labeled tunnels for larger ones) with verify=true.",
            "3. For arbitrary/sequential circuits (D Flip-Flop, Register, Counter, Adder, Splitter, Clock, LED), use logisim_create_project + logisim_layout_graph for crossing-free orthogonal routing with a geometry certificate.",
            "4. For incremental edits on existing projects, use logisim_inspect_project (note sha256 and indexes) followed by logisim_edit_project (anchor-addressed, with expected_sha256) or logisim_apply_batch / logisim_update_component.",
            "5. Always verify electrically with logisim_run_test_vectors, logisim_test_vector, logisim_test_bench, or logisim_truth_table before claiming a circuit works.",
          ].join("\n"),
        }],
      }),
    );

    this.server.registerPrompt(
      "design_circuit",
      {
        title: "Design Logisim Circuit",
        description: "Guide the assistant through designing, routing, and verifying an editable Logisim-evolution circuit.",
        argsSchema: { requirements: z.string().min(1).describe("Natural-language description of the digital logic circuit to build") },
      },
      ({ requirements }) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Design this Logisim-evolution circuit: ${requirements}\nUse the Logisim MCP tools. Inspect components with logisim_describe_component first. For 1-bit combinational Boolean logic use logisim_synthesize_logic with verify=true; for sequential or multi-bit circuits use logisim_create_project + logisim_layout_graph. Deliver the .circ path and report actual simulation results.`,
          },
        }],
      }),
    );
  }

  async start(): Promise<void> {
    await this.service.initialize();
    await this.server.connect(new StdioServerTransport());
    console.error(`Logisim-evolution MCP server ready; workspace=${this.service.workspaceRoot}`);
  }
}
