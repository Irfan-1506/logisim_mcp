#!/usr/bin/env node
import { LogisimMcpServer } from "./server.js";

new LogisimMcpServer().start().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Failed to start Logisim-evolution MCP server: ${message}`);
  process.exitCode = 1;
});
