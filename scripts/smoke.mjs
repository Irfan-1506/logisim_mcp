import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
  env: { ...process.env },
});
const client = new Client({ name: "logisim-mcp-smoke", version: "0.4.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const requiredTools = ["logisim_apply_batch", "logisim_copy_circuit", "logisim_describe_component", "logisim_layout_graph"];
  for (const required of requiredTools) {
    if (!tools.tools.some((tool) => tool.name === required)) throw new Error(`${required} was not registered`);
  }
  const layoutTool = tools.tools.find((tool) => tool.name === "logisim_layout_graph");
  if (!JSON.stringify(layoutTool?.inputSchema).includes("wire_spacing")) throw new Error("logisim_layout_graph does not expose wire_spacing");
  const status = await client.callTool({ name: "logisim_get_status", arguments: {} });
  const pinDescription = await client.callTool({ name: "logisim_describe_component", arguments: { library: "0", name: "Pin", attributes: { output: "true", width: "2" } } });
  console.log(JSON.stringify({ toolCount: tools.tools.length, toolNames: tools.tools.map((tool) => tool.name), status, pinDescription }, null, 2));
} finally {
  await client.close();
}
