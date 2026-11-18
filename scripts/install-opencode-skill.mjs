import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(projectRoot, "skills", "logisim-evolution", "SKILL.md");
const configRoot = process.env.OPENCODE_CONFIG_DIR
  ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode");
const destinationDirectory = join(configRoot, "skills", "logisim-evolution");
const destination = join(destinationDirectory, "SKILL.md");
const temporary = join(destinationDirectory, `.SKILL.md.${process.pid}.${randomUUID()}.tmp`);

await mkdir(destinationDirectory, { recursive: true, mode: 0o755 });
try {
  await copyFile(source, temporary);
  await rename(temporary, destination);
} finally {
  await rm(temporary, { force: true });
}

console.log(`Installed Logisim-evolution skill at ${destination}`);
