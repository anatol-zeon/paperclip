import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** OS start identity for a direct child; never trust a recycled PID alone. */
export async function readLocalProcessIdentity(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "linux") {
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      // comm can contain spaces and parentheses. Fields after its final ')'
      // begin at field 3; starttime is field 22 and ppid is field 4.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      if (fields[1] !== String(process.pid) || !/^\d+$/.test(fields[19] ?? "")) return null;
      return `${pid}:${fields[1]}:${fields[19]}`;
    }
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("ps", ["-o", "ppid=,lstart=", "-p", String(pid)], {
        encoding: "utf8", timeout: 1_500,
      });
      const value = stdout.trim();
      const match = /^(\d+)\s+(.+)$/.exec(value);
      if (match?.[1] !== String(process.pid) || !Number.isFinite(Date.parse(match[2]))) return null;
      return `${pid}:${value}`;
    }
  } catch { /* Missing process or unavailable OS identity: fail closed. */ }
  return null;
}

export async function killVerifiedLocalProcess(
  pid: number,
  identity: string | null | undefined,
  deps = { readIdentity: readLocalProcessIdentity, kill: process.kill.bind(process) },
): Promise<boolean> {
  try {
    if (!identity || await deps.readIdentity(pid) !== identity) return false;
    deps.kill(pid, "SIGKILL");
    return true;
  } catch { return false; }
}
