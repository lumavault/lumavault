// Starts a real Go Storage Gateway on a random port with a throwaway data dir. Tests only.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const READY_TIMEOUT_MS = 30_000

export interface TestGateway {
  baseUrl: string
  stop(): void
}

export interface StartTestGatewayOptions {
  ticketSecret?: string
  serviceKey?: string
  env?: Record<string, string>
}

/**
 * Builds core/cmd/lumavault and runs it on a random port with a throwaway data dir.
 * Disables background GC by default and waits for /healthz before returning.
 */
export async function startTestGateway(
  options: StartTestGatewayOptions = {},
): Promise<TestGateway> {
  const dir = mkdtempSync(join(tmpdir(), 'lumavault-test-gateway-'))
  const bin = join(dir, 'lumavault')
  execFileSync('go', ['build', '-o', bin, './core/cmd/lumavault'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LUMAVAULT_GC_INTERVAL: '0',
    ...(options.ticketSecret !== undefined
      ? { LUMAVAULT_TICKET_SECRET: options.ticketSecret }
      : {}),
    ...(options.serviceKey !== undefined
      ? { LUMAVAULT_SERVICE_KEY: options.serviceKey }
      : {}),
    ...options.env,
  }

  const proc = spawn(
    bin,
    ['-addr', '127.0.0.1:0', '-data-dir', join(dir, 'data')],
    {
      env,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  const stop = () => {
    proc.kill()
    rmSync(dir, { recursive: true, force: true })
  }

  try {
    const baseUrl = `http://${await listeningAddr(proc)}`
    await waitHealthy(baseUrl)
    return { baseUrl, stop }
  } catch (err) {
    stop()
    throw err
  }
}

// The server logs a line like: level=INFO msg=listening addr=127.0.0.1:54321 data_dir=...
function listeningAddr(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: proc.stdout! })
    const timer = setTimeout(() => {
      rl.close()
      reject(new Error('gateway did not log its address'))
    }, READY_TIMEOUT_MS)
    const onExit = (code: number | null) => {
      clearTimeout(timer)
      rl.close()
      reject(new Error(`gateway exited early with code ${code}`))
    }
    proc.once('exit', onExit)
    rl.on('line', (line) => {
      const match = /msg=listening addr=(\S+)/.exec(line)
      if (match?.[1]) {
        clearTimeout(timer)
        proc.off('exit', onExit)
        rl.close()
        // Keep draining stdout so the pipe buffer never blocks later gateway logs.
        proc.stdout?.resume()
        resolve(match[1])
      }
    })
  })
}

async function waitHealthy(baseUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) {
        return
      }
    } catch {
      // Not accepting connections yet.
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('gateway never became healthy')
}
