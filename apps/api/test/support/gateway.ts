// Starts a real Go Storage Gateway with ticket checks on, for API tests. Never imported by the server.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { TEST_ENV } from "./context.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const READY_TIMEOUT_MS = 30_000;

export interface TestGateway {
  baseUrl: string;
  stop(): void;
}

/** Builds core/cmd/lumavault and runs it with the same ticket secret and service key as TEST_ENV. */
export async function startTestGateway(): Promise<TestGateway> {
  const dir = mkdtempSync(join(tmpdir(), "lv-api-gateway-"));
  const bin = join(dir, "lumavault");
  execFileSync("go", ["build", "-o", bin, "./core/cmd/lumavault"], { cwd: REPO_ROOT, stdio: "inherit" });
  const proc = spawn(bin, ["-addr", "127.0.0.1:0", "-data-dir", join(dir, "data")], {
    env: {
      ...process.env,
      LUMAVAULT_TICKET_SECRET: TEST_ENV.LUMAVAULT_TICKET_SECRET,
      LUMAVAULT_SERVICE_KEY: TEST_ENV.LUMAVAULT_SERVICE_KEY,
      LUMAVAULT_GC_INTERVAL: "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const stop = () => {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    return { baseUrl: `http://${await listeningAddr(proc)}`, stop };
  } catch (err) {
    stop();
    throw err;
  }
}

function listeningAddr(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("gateway did not log its address")), READY_TIMEOUT_MS);
    proc.once("exit", (code) => reject(new Error(`gateway exited early with code ${code}`)));
    createInterface({ input: proc.stdout! }).on("line", (line) => {
      const match = /msg=listening addr=(\S+)/.exec(line);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    });
  });
}
