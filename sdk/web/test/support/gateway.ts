import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const READY_TIMEOUT_MS = 30_000;

export interface TestGateway {
  baseUrl: string;
  stop(): void;
}

/**
 * Builds core/cmd/lumavault and runs it on a random port with a throwaway data dir. Pass env to
 * turn on storage ticket checks.
 */
export async function startGateway(env: Record<string, string> = {}): Promise<TestGateway> {
  const dir = mkdtempSync(join(tmpdir(), "lumavault-sdk-test-"));
  const bin = join(dir, "lumavault");
  execFileSync("go", ["build", "-o", bin, "./core/cmd/lumavault"], { cwd: REPO_ROOT, stdio: "inherit" });

  const proc = spawn(bin, ["-addr", "127.0.0.1:0", "-data-dir", join(dir, "data")], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const stop = () => {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    const baseUrl = `http://${await listeningAddr(proc)}`;
    await waitHealthy(baseUrl);
    return { baseUrl, stop };
  } catch (err) {
    stop();
    throw err;
  }
}

// The server logs a line like: level=INFO msg=listening addr=127.0.0.1:54321 data_dir=...
function listeningAddr(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("gateway did not log its address")), READY_TIMEOUT_MS);
    proc.once("exit", (code) => reject(new Error(`gateway exited early with code ${code}`)));
    createInterface({ input: proc.stdout! }).on("line", (line) => {
      const match = /msg=listening addr=(\S+)/.exec(line);
      if (match) {
        clearTimeout(timer);
        resolve(match[1] as string);
      }
    });
  });
}

async function waitHealthy(baseUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) {
        return;
      }
    } catch {
      // Not accepting connections yet.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("gateway never became healthy");
}
