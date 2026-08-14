import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function executableNames(command) {
  if (process.platform !== "win32" || path.extname(command)) return [command];
  const extensions = String(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return extensions.map((extension) => `${command}${extension}`);
}

function resolveWindowsShimTarget(candidate) {
  if (process.platform !== "win32" || !/\.cmd$/i.test(candidate)) {
    return fs.realpathSync.native(candidate);
  }
  try {
    const source = fs.readFileSync(candidate, "utf8");
    const match = source.match(/"%dp0%\\([^"\r\n]+\.exe)"/i);
    if (match) {
      const target = path.resolve(
        path.dirname(candidate),
        match[1].replaceAll("\\", path.sep),
      );
      if (fs.statSync(target).isFile()) return fs.realpathSync.native(target);
    }
  } catch {
    // Fall back to the shim itself when it cannot be inspected.
  }
  return fs.realpathSync.native(candidate);
}

export function resolveExecutable(command, environmentPath = process.env.PATH) {
  if (!command || typeof command !== "string") return null;
  if (/[\\/]/.test(command)) {
    const absolute = path.resolve(command);
    try {
      return fs.statSync(absolute).isFile()
        ? fs.realpathSync.native(absolute)
        : null;
    } catch {
      return null;
    }
  }

  const directories = String(environmentPath ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const directory of directories) {
    for (const name of executableNames(command)) {
      const candidate = path.resolve(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          return resolveWindowsShimTarget(candidate);
        }
      } catch {
        // Keep searching.
      }
    }
  }
  return null;
}

export function readCommandVersion(command, args = ["--version"], timeoutMs = 3000) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let child;
    let timer;
    try {
      const isWindowsShim =
        process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
      const options = {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          WINDIR: process.env.WINDIR ?? "",
          USERPROFILE: process.env.USERPROFILE ?? "",
          HOME: process.env.HOME ?? "",
          LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
          APPDATA: process.env.APPDATA ?? "",
          ComSpec: process.env.ComSpec ?? "",
        },
      };
      if (isWindowsShim) {
        const commandLine = [
          `call "${command.replaceAll('"', '""')}"`,
          ...args,
        ].join(" ");
        child = spawn(commandLine, {
          ...options,
          shell: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
        });
      } else {
        child = spawn(command, args, options);
      }
    } catch (error) {
      resolve({ ok: false, version: null, output: "", error: error.message });
      return;
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) =>
      finish({ ok: false, version: null, output, error: error.message }),
    );
    child.on("close", (code) =>
      finish({
        ok: code === 0,
        version: output.trim().split(/\r?\n/, 1)[0]?.slice(0, 200) || null,
        output: output.slice(-4000),
        error: code === 0 ? null : `Version command exited with code ${code}`,
      }),
    );
    timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        version: null,
        output: output.slice(-4000),
        error: "Version check timed out",
      });
    }, timeoutMs);
    timer.unref?.();
  });
}

export async function probeCommandExecutor({
  command,
  verifyVersion = false,
  versionArgs = ["--version"],
  timeoutMs = 3000,
} = {}) {
  const resolved = resolveExecutable(command);
  if (!resolved) {
    return {
      available: false,
      status: "unavailable",
      reason: "command_not_found",
      command: null,
      version: null,
    };
  }
  if (!verifyVersion) {
    return {
      available: true,
      status: "installed",
      reason: null,
      command: resolved,
      version: null,
      detail: null,
    };
  }
  const version = await readCommandVersion(resolved, versionArgs, timeoutMs);
  return {
    available: true,
    status: version.ok ? "available" : "degraded",
    reason: version.ok ? null : "version_check_failed",
    command: resolved,
    version: version.ok ? version.version : null,
    detail: version.ok ? null : version.error,
  };
}

export async function discoverExecutor(executor) {
  const checkedAt = new Date().toISOString();
  const save = (result) => {
    const discovery = { ...result, checked_at: checkedAt };
    if (typeof executor.setDiscovery === "function") {
      return executor.setDiscovery(discovery);
    }
    executor.discovery = discovery;
    return structuredClone(discovery);
  };
  try {
    const result =
      typeof executor.probe === "function"
        ? await executor.probe()
        : { available: true, status: "available", reason: null };
    if (result.command && typeof executor.command === "string") {
      executor.command = result.command;
    }
    return save(result);
  } catch (error) {
    return save({
      available: false,
      status: "unavailable",
      reason: "probe_failed",
      detail: error.message,
    });
  }
}

export async function discoverExecutors(executors) {
  const entries = await Promise.all(
    [...executors.entries()].map(async ([id, executor]) => [
      id,
      await discoverExecutor(executor),
    ]),
  );
  return Object.fromEntries(entries);
}
