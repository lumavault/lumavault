import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createEmailService, type EmailService } from '#/email/emails.js'
import { createMailer } from '#/email/mailer.js'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const LINK = 'http://localhost:3000/login/verify?token=abc123'

function captureLog() {
  const lines: string[] = []
  return { lines, log: (line: string) => void lines.push(line) }
}

describe('templates', () => {
  let sent: Parameters<ReturnType<typeof createMailer>['send']>[0][] = []
  const service = createEmailService({
    async send(email) {
      sent.push(email)
    },
    async close() {},
  })

  const cases: [string, (s: EmailService) => Promise<void>, RegExp][] = [
    [
      'magic link',
      (s) => s.sendMagicLink('a@example.com', { url: LINK }),
      /sign-in link/,
    ],
    [
      'member invite',
      (s) =>
        s.sendMemberInvite('a@example.com', {
          url: LINK,
          householdName: 'Home',
          inviterName: 'Ada',
        }),
      /Ada invited you to Home/,
    ],
    [
      'household invite',
      (s) =>
        s.sendHouseholdInvite('a@example.com', {
          url: LINK,
          inviterName: 'Ada',
        }),
      /household for you/,
    ],
  ]

  for (const [name, send, subject] of cases) {
    it(`renders the ${name} email to HTML and plain text with its link`, async () => {
      sent = []
      await send(service)
      const [email] = sent
      expect(email?.subject).toMatch(subject)
      expect(email?.html).toMatch(/^<!DOCTYPE html/i)
      expect(email?.html).toContain(LINK.replace('&', '&amp;'))
      expect(email?.text).toContain(LINK)
      expect(email?.text).not.toMatch(/<[a-z]/i)
      expect(email?.link).toBe(LINK)
    })
  }
})

describe('console fallback', () => {
  it('prints the link when SMTP_URL is unset', async () => {
    const { lines, log } = captureLog()
    const service = createEmailService(
      createMailer({ from: 'LumaVault <a@b.c>', log }),
    )
    await service.sendMagicLink('ada@example.com', { url: LINK })
    expect(lines.join('\n')).toContain('email to ada@example.com')
    expect(lines.join('\n')).toContain(`link: ${LINK}`)
  })
})

describe('SMTP delivery', () => {
  const received: { from?: string; to: string[]; data: string }[] = []
  let server: SMTPServer
  let port: number

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, session, callback) {
        const chunks: Buffer[] = []
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('end', () => {
          received.push({
            from: session.envelope.mailFrom
              ? session.envelope.mailFrom.address
              : undefined,
            to: session.envelope.rcptTo.map((r) => r.address),
            data: Buffer.concat(chunks).toString('utf8'),
          })
          callback()
        })
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server.server, 'listening')
    port = (server.server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('sends through the configured SMTP server', async () => {
    const mailer = createMailer({
      smtpUrl: `smtp://127.0.0.1:${port}`,
      from: 'LumaVault <no-reply@example.com>',
    })
    try {
      await createEmailService(mailer).sendMagicLink('ada@example.com', {
        url: LINK,
      })
    } finally {
      await mailer.close()
    }
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      from: 'no-reply@example.com',
      to: ['ada@example.com'],
    })
    expect(received[0]?.data).toMatch(/Subject: Your LumaVault sign-in link/)
    expect(received[0]?.data).toMatch(/multipart\/alternative/)
  })
})
