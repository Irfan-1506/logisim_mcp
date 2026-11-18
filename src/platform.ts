/**
 * Cross-platform helpers: locating Logisim-evolution, listing running Logisim
 * processes, and preserving file metadata during atomic replacement.
 *
 * Supported launch modes (first match wins):
 *   1. LOGISIM_EXECUTABLE  - native launcher (Linux script, Windows .exe, macOS app binary)
 *   2. LOGISIM_JAR         - `java -jar <jar>`; Java taken from LOGISIM_JAVA or PATH
 *   3. Auto-detection of standard install locations for the current OS
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { chmod, readdir, readFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";

export interface Launcher {
  kind: "executable" | "jar";
  /** Program actually spawned (launcher or java). */
  command: string;
  /** Arguments placed before Logisim's own arguments (e.g. `-jar <file>`). */
  prefixArgs: string[];
  /** Path of the launcher or JAR, for status reporting. */
  target: string;
  /** How the launcher was chosen. */
  source: "LOGISIM_EXECUTABLE" | "LOGISIM_JAR" | "auto-detected" | "default";
}

export const IS_WINDOWS = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";
export const IS_MAC = process.platform === "darwin";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function newestJar(directory: string): string | null {
  try {
    const jars = readdirSync(directory)
      .filter((name) => /^logisim-evolution.*\.jar$/i.test(name))
      .sort()
      .reverse();
    return jars[0] ? join(directory, jars[0]) : null;
  } catch {
    return null;
  }
}

function javaCommand(env: NodeJS.ProcessEnv): string {
  return env.LOGISIM_JAVA && env.LOGISIM_JAVA.trim() !== "" ? env.LOGISIM_JAVA : "java";
}

/** Candidate native launchers and JAR folders for the current OS. */
function candidates(env: NodeJS.ProcessEnv): { executables: string[]; jarDirectories: string[] } {
  if (IS_WINDOWS) {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs")]
      .filter((root): root is string => typeof root === "string" && root !== "");
    return {
      executables: roots.map((root) => join(root, "logisim-evolution", "logisim-evolution.exe")),
      jarDirectories: roots.map((root) => join(root, "logisim-evolution", "app")),
    };
  }
  if (IS_MAC) {
    const home = env.HOME ?? "";
    return {
      executables: [
        "/Applications/Logisim-evolution.app/Contents/MacOS/Logisim-evolution",
        join(home, "Applications/Logisim-evolution.app/Contents/MacOS/Logisim-evolution"),
      ],
      jarDirectories: [
        "/Applications/Logisim-evolution.app/Contents/app",
        join(home, "Applications/Logisim-evolution.app/Contents/app"),
      ],
    };
  }
  return {
    executables: ["/opt/logisim-evolution/bin/logisim-evolution", "/usr/bin/logisim-evolution", "/usr/local/bin/logisim-evolution"],
    jarDirectories: ["/opt/logisim-evolution/lib/app", "/opt/logisim-evolution/lib"],
  };
}

export function resolveLauncher(options: { executable?: string; jar?: string; java?: string } = {}, env: NodeJS.ProcessEnv = process.env): Launcher {
  const executable = options.executable ?? env.LOGISIM_EXECUTABLE;
  if (executable && executable.trim() !== "") {
    return { kind: "executable", command: executable, prefixArgs: [], target: executable, source: "LOGISIM_EXECUTABLE" };
  }
  const jar = options.jar ?? env.LOGISIM_JAR;
  const java = options.java ?? javaCommand(env);
  if (jar && jar.trim() !== "") {
    return { kind: "jar", command: java, prefixArgs: ["-jar", jar], target: jar, source: "LOGISIM_JAR" };
  }
  const found = candidates(env);
  for (const candidate of found.executables) {
    if (isFile(candidate)) return { kind: "executable", command: candidate, prefixArgs: [], target: candidate, source: "auto-detected" };
  }
  for (const directory of found.jarDirectories) {
    const candidate = newestJar(directory);
    if (candidate) return { kind: "jar", command: java, prefixArgs: ["-jar", candidate], target: candidate, source: "auto-detected" };
  }
  const fallback = found.executables[0] ?? "logisim-evolution";
  return { kind: "executable", command: fallback, prefixArgs: [], target: fallback, source: "default" };
}

export function launcherExists(launcher: Launcher): boolean {
  if (launcher.kind === "jar") return isFile(launcher.target) && existsSync(launcher.target);
  return isFile(launcher.command);
}

/** Parse "Logisim-evolution v3.8.0" style output. */
export function parseLogisimVersion(output: string): string | null {
  const match = /Logisim-evolution\s+v?(\d+\.\d+\.\d+)/i.exec(output);
  return match ? match[1]! : null;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function capture(command: string, args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolvePromise) => {
    let output = "";
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      resolvePromise("");
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length < 2_000_000) output += chunk.toString("utf8");
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolvePromise("");
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolvePromise(output);
    });
  });
}

/** Best-effort list of running Logisim processes on any OS. */
export async function listLogisimProcesses(launcher: Launcher): Promise<Array<{ pid: number; command: string }>> {
  const matches = (command: string): boolean =>
    command.includes(launcher.target) || /logisim-evolution[\w.-]*\.(jar|exe)/i.test(command) || /Logisim-evolution\.app/i.test(command);
  const processes: Array<{ pid: number; command: string }> = [];
  if (IS_LINUX) {
    for (const entry of await readdir("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      try {
        const command = (await readFile(join("/proc", entry.name, "cmdline"), "utf8")).replaceAll("\0", " ").trim();
        if (Number(entry.name) !== process.pid && matches(command)) processes.push({ pid: Number(entry.name), command });
      } catch {
        // Processes can exit while /proc is being scanned.
      }
    }
    return processes;
  }
  if (IS_WINDOWS) {
    const script = "Get-CimInstance Win32_Process -Filter \"Name like '%logisim%' or Name like 'java%'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    const raw = await capture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    try {
      const parsed = JSON.parse(raw || "[]") as unknown;
      const list = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ ProcessId?: number; CommandLine?: string | null }>;
      for (const item of list) {
        const command = item?.CommandLine ?? "";
        if (item?.ProcessId && matches(command)) processes.push({ pid: item.ProcessId, command });
      }
    } catch {
      // Ignore unparsable output; status is informational.
    }
    return processes;
  }
  const raw = await capture("ps", ["-ax", "-o", "pid=,command="]);
  for (const line of raw.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match && Number(match[1]) !== process.pid && matches(match[2]!)) processes.push({ pid: Number(match[1]), command: match[2]!.trim() });
  }
  return processes;
}

/**
 * Copy permissions (and on Linux, all attributes including ownership/xattrs via
 * GNU cp) from the file being replaced onto its replacement.
 */
export async function preserveMetadata(sourcePath: string, targetPath: string): Promise<void> {
  if (IS_LINUX && isFile("/usr/bin/cp")) {
    const ok = await new Promise<boolean>((resolveCopy) => {
      const child = spawn("/usr/bin/cp", ["--attributes-only", "--preserve=all", sourcePath, targetPath], { stdio: "ignore" });
      child.once("error", () => resolveCopy(false));
      child.once("close", (exitCode) => resolveCopy(exitCode === 0));
    });
    if (!ok) await chmodLike(sourcePath, targetPath);
  } else {
    await chmodLike(sourcePath, targetPath);
  }
  const now = new Date();
  await utimes(targetPath, now, now);
}

async function chmodLike(sourcePath: string, targetPath: string): Promise<void> {
  try {
    const info = await stat(sourcePath);
    await chmod(targetPath, info.mode & 0o7777);
  } catch {
    // Permission bits are advisory on Windows; ignore failures.
  }
}
