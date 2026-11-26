const DEFAULT_MAILPIT_URL = 'http://localhost:8025'

interface MailpitAddress {
  Address: string
}

interface MailpitSummary {
  ID: string
  To?: MailpitAddress[]
  Subject?: string
}

interface MailpitMessage {
  ID: string
  Text?: string
  HTML?: string
}

function mailpitUrl(): string {
  return (process.env.MAILPIT_URL ?? DEFAULT_MAILPIT_URL).replace(/\/+$/, '')
}

export async function clearMailpit(): Promise<void> {
  const res = await fetch(`${mailpitUrl()}/api/v1/messages`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`Mailpit delete failed with status ${res.status}`)
  }
}

export async function waitForEmailLink(
  recipient: string,
  pattern: RegExp,
  timeoutMs = 15_000,
): Promise<string> {
  const lower = recipient.toLowerCase()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const listRes = await fetch(`${mailpitUrl()}/api/v1/messages`)
    if (listRes.ok) {
      const data = (await listRes.json()) as { messages?: MailpitSummary[] }
      const matches = (data.messages ?? []).filter((msg) =>
        (msg.To ?? []).some((addr) => addr.Address.toLowerCase() === lower),
      )
      for (const match of matches) {
        const msgRes = await fetch(`${mailpitUrl()}/api/v1/message/${match.ID}`)
        if (msgRes.ok) {
          const full = (await msgRes.json()) as MailpitMessage
          const body = `${full.Text ?? ''}\n${full.HTML ?? ''}`
          const found = body.match(pattern)
          if (found?.[0]) {
            return found[0].replaceAll('&amp;', '&')
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for Mailpit email to ${recipient}`)
}
