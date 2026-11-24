import nodemailer from 'nodemailer'

import type { RenderedEmail } from './render.js'

export interface OutgoingEmail extends RenderedEmail {
  to: string
  /** The one link the email exists to deliver, printed when no SMTP server is configured. */
  link: string
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>
  close(): Promise<void>
}

export interface MailerOptions {
  /** For example smtp://localhost:1025 for Mailpit. Unset prints emails to the log instead. */
  smtpUrl?: string
  from: string
  log?: (line: string) => void
}

export function createMailer(options: MailerOptions): Mailer {
  const log = options.log ?? ((line) => console.info(line))
  if (!options.smtpUrl) {
    return {
      async send(email) {
        log(`email to ${email.to}: ${email.subject}\n  link: ${email.link}`)
      },
      async close() {},
    }
  }
  const transport = nodemailer.createTransport(options.smtpUrl)
  return {
    async send(email) {
      await transport.sendMail({
        from: options.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      })
    },
    async close() {
      transport.close()
    },
  }
}
