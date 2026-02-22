// SSH tool definitions and handlers for remote Mac management

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

const ALLOWED_HOSTS = ["studio", "air", "mini"];

function getLocalHostname(): string {
  try {
    const { execFileSync } = require("node:child_process");
    return execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf-8" }).trim().toLowerCase();
  } catch {
    return "unknown";
  }
}

async function sshExec(host: string, command: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(`Host '${host}' not in allowlist: ${ALLOWED_HOSTS.join(", ")}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync("ssh", [host, command], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: any) {
    if (err.killed) {
      return { stdout: "", stderr: `Command timed out after ${timeoutMs}ms`, exitCode: 124 };
    }
    return {
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || err.message || "").trim(),
      exitCode: err.code ?? 1,
    };
  }
}

async function runLocal(command: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: any) {
    if (err.killed) {
      return { stdout: "", stderr: `Command timed out after ${timeoutMs}ms`, exitCode: 124 };
    }
    return {
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || err.message || "").trim(),
      exitCode: err.code ?? 1,
    };
  }
}

function execOnMachine(host: string, command: string, localHostname: string, timeoutMs = 30000) {
  if (host === localHostname) {
    return runLocal(command, timeoutMs);
  }
  return sshExec(host, command, timeoutMs);
}

export function getSSHToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // ─── ssh_exec: Run arbitrary command on a remote Mac ───

  handlers.set("ssh_exec", async (input) => {
    const { host, command, timeout } = input as { host: string; command: string; timeout?: number };

    if (!host || !command) {
      return { error: "host and command are required" };
    }

    if (!ALLOWED_HOSTS.includes(host)) {
      return { error: `Host '${host}' not allowed. Valid hosts: ${ALLOWED_HOSTS.join(", ")}` };
    }

    const localHostname = getLocalHostname();
    const result = await execOnMachine(host, command, localHostname, timeout || 30000);

    return {
      host,
      local: host === localHostname,
      ...result,
    };
  });

  // ─── ssh_git_sync_status: Check git repo sync across machines ───

  handlers.set("ssh_git_sync_status", async (input) => {
    const { repos, machines } = input as { repos?: string[]; machines?: string[] };

    const targetMachines = machines?.filter((m) => ALLOWED_HOSTS.includes(m)) || [...ALLOWED_HOSTS];
    const localHostname = getLocalHostname();

    // Discover repos from local ~/dev_mm/
    let repoNames: string[];
    if (repos && repos.length > 0) {
      repoNames = repos;
    } else {
      try {
        const devDir = join(homedir(), "dev_mm");
        repoNames = readdirSync(devDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => d.name);
      } catch {
        return { error: "Could not read ~/dev_mm/ to discover repos" };
      }
    }

    const results: Array<{
      name: string;
      machines: Record<string, { branch: string; head: string; dirty: number; lastCommit: string; reachable: boolean; error?: string }>;
      inSync: boolean;
    }> = [];

    for (const repo of repoNames) {
      const repoPath = `~/dev_mm/${repo}`;
      const machineResults: Record<string, { branch: string; head: string; dirty: number; lastCommit: string; reachable: boolean; error?: string }> = {};

      const gitCmd = [
        `cd ${repoPath} 2>/dev/null || exit 1`,
        `echo "BRANCH:$(git branch --show-current 2>/dev/null)"`,
        `echo "HEAD:$(git rev-parse --short HEAD 2>/dev/null)"`,
        `echo "DIRTY:$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"`,
        `echo "LOG:$(git log --oneline -1 2>/dev/null)"`,
      ].join(" && ");

      const machinePromises = targetMachines.map(async (machine) => {
        try {
          const result = await execOnMachine(machine, gitCmd, localHostname, 15000);

          if (result.exitCode !== 0) {
            machineResults[machine] = { branch: "", head: "", dirty: 0, lastCommit: "", reachable: true, error: "not a git repo or missing" };
            return;
          }

          const lines = result.stdout.split("\n");
          const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length) || "";

          machineResults[machine] = {
            branch: get("BRANCH:"),
            head: get("HEAD:"),
            dirty: parseInt(get("DIRTY:"), 10) || 0,
            lastCommit: get("LOG:"),
            reachable: true,
          };
        } catch {
          machineResults[machine] = { branch: "", head: "", dirty: 0, lastCommit: "", reachable: false, error: "unreachable" };
        }
      });

      await Promise.all(machinePromises);

      // Determine sync status: all reachable machines with same head commit
      const reachableHeads = Object.values(machineResults)
        .filter((m) => m.reachable && !m.error && m.head)
        .map((m) => m.head);
      const uniqueHeads = [...new Set(reachableHeads)];
      const inSync = uniqueHeads.length <= 1;

      results.push({ name: repo, machines: machineResults, inSync });
    }

    const outOfSync = results.filter((r) => !r.inSync);
    const dirtyRepos = results.filter((r) =>
      Object.values(r.machines).some((m) => m.dirty > 0),
    );

    return {
      repos: results,
      summary: {
        total: results.length,
        inSync: results.filter((r) => r.inSync).length,
        outOfSync: outOfSync.length,
        dirty: dirtyRepos.length,
        machines: targetMachines,
      },
    };
  });

  // ─── ssh_mac_status: System health check on remote Macs ───

  handlers.set("ssh_mac_status", async (input) => {
    const { machines } = input as { machines?: string[] };

    const targetMachines = machines?.filter((m) => ALLOWED_HOSTS.includes(m)) || [...ALLOWED_HOSTS];
    const localHostname = getLocalHostname();

    const statusCmd = [
      `echo "UPTIME:$(uptime)"`,
      `echo "DISK:$(df -h / | tail -1)"`,
      `echo "MEMORY:$(memory_pressure 2>/dev/null | head -1 || echo 'N/A')"`,
      `echo "HOSTNAME:$(scutil --get LocalHostName 2>/dev/null || hostname -s)"`,
    ].join(" && ");

    const machineStatuses: Array<{
      host: string;
      reachable: boolean;
      uptime?: string;
      diskUsed?: string;
      diskTotal?: string;
      diskPercent?: string;
      memoryPressure?: string;
      error?: string;
    }> = [];

    const promises = targetMachines.map(async (machine) => {
      try {
        const result = await execOnMachine(machine, statusCmd, localHostname, 15000);

        if (result.exitCode !== 0 && !result.stdout) {
          machineStatuses.push({ host: machine, reachable: false, error: result.stderr || "unreachable" });
          return;
        }

        const lines = result.stdout.split("\n");
        const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() || "";

        const uptime = get("UPTIME:");
        const diskLine = get("DISK:");
        const diskParts = diskLine.split(/\s+/);
        // df -h output: filesystem  size  used  avail  capacity  mount
        const diskTotal = diskParts[1] || "?";
        const diskUsed = diskParts[2] || "?";
        const diskPercent = diskParts[4] || "?";
        const memoryPressure = get("MEMORY:");

        machineStatuses.push({
          host: machine,
          reachable: true,
          uptime,
          diskUsed,
          diskTotal,
          diskPercent,
          memoryPressure,
        });
      } catch {
        machineStatuses.push({ host: machine, reachable: false, error: "unreachable" });
      }
    });

    await Promise.all(promises);

    const warnings: string[] = [];
    for (const m of machineStatuses) {
      if (!m.reachable) warnings.push(`${m.host}: unreachable`);
      else if (m.diskPercent && parseInt(m.diskPercent, 10) > 80) {
        warnings.push(`${m.host}: disk usage at ${m.diskPercent}`);
      }
    }

    return { machines: machineStatuses, warnings };
  });

  return handlers;
}

export function getSSHToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "ssh_exec",
      description:
        "Run a shell command on a remote Mac via SSH. Hosts: studio (Mac Studio), air (MacBook Air), mini (Mac Mini). If the target is the current machine, runs locally.",
      input_schema: {
        type: "object" as const,
        properties: {
          host: {
            type: "string",
            enum: ALLOWED_HOSTS,
            description: "Target machine: studio, air, or mini",
          },
          command: {
            type: "string",
            description: "Shell command to execute on the remote machine",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000)",
          },
        },
        required: ["host", "command"],
      },
    },
    {
      name: "ssh_git_sync_status",
      description:
        "Check git sync status for repos in ~/dev_mm/ across all Macs. Compares branches, HEAD commits, and dirty status. Identifies out-of-sync repos.",
      input_schema: {
        type: "object" as const,
        properties: {
          repos: {
            type: "array",
            items: { type: "string" },
            description: "Repo directory names to check (default: auto-discover from ~/dev_mm/)",
          },
          machines: {
            type: "array",
            items: { type: "string", enum: ALLOWED_HOSTS },
            description: "Machines to check (default: all — studio, air, mini)",
          },
        },
        required: [],
      },
    },
    {
      name: "ssh_mac_status",
      description:
        "Get system health (uptime, disk usage, memory pressure) from remote Macs. Flags disk usage above 80%.",
      input_schema: {
        type: "object" as const,
        properties: {
          machines: {
            type: "array",
            items: { type: "string", enum: ALLOWED_HOSTS },
            description: "Machines to check (default: all — studio, air, mini)",
          },
        },
        required: [],
      },
    },
  ];
}
