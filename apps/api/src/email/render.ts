import { EMAIL_COLORS, HTML_ESCAPE_MAP, PRODUCT_NAME } from './constants.js'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface EmailTemplate {
  subject: string
  preview: string
  heading: string
  body: string
  actionLabel: string
  actionUrl: string
  note: string
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char)
}

function assertHttpUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('email action URL must be a valid http or https URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('email action URL must use http or https')
  }
}

/** Renders the shared LumaVault email frame to HTML and plain text. */
export function renderEmail(template: EmailTemplate): RenderedEmail {
  assertHttpUrl(template.actionUrl)

  const subject = template.subject.replace(/[\r\n]+/g, ' ')
  const preview = escapeHtml(template.preview)
  const product = escapeHtml(PRODUCT_NAME)
  const heading = escapeHtml(template.heading)
  const body = escapeHtml(template.body)
  const actionUrl = escapeHtml(template.actionUrl)
  const actionLabel = escapeHtml(template.actionLabel)
  const note = escapeHtml(template.note)

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width,initial-scale=1" />',
    '</head>',
    `<body style="background-color:${EMAIL_COLORS.background};font-family:Helvetica,Arial,sans-serif;margin:0;padding:40px 16px">`,
    `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">${preview}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;background-color:${EMAIL_COLORS.card};border-radius:12px">`,
    '<tr><td style="padding:32px">',
    `<p style="color:${EMAIL_COLORS.muted};font-size:13px;margin:0">${product}</p>`,
    `<h1 style="color:${EMAIL_COLORS.text};font-size:22px;margin:8px 0 16px">${heading}</h1>`,
    `<p style="color:${EMAIL_COLORS.text};font-size:15px;line-height:22px;margin:16px 0">${body}</p>`,
    '<div style="margin:24px 0">',
    `<a href="${actionUrl}" style="display:inline-block;background-color:${EMAIL_COLORS.button};color:${EMAIL_COLORS.buttonText};padding:12px 20px;border-radius:8px;font-size:15px;text-decoration:none">${actionLabel}</a>`,
    '</div>',
    `<p style="color:${EMAIL_COLORS.muted};font-size:13px;line-height:20px;margin:16px 0 0">${note}</p>`,
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n')

  const text = [
    PRODUCT_NAME,
    '',
    template.heading,
    '',
    template.body,
    '',
    `${template.actionLabel}: ${template.actionUrl}`,
    '',
    template.note,
  ].join('\n')

  return { subject, html, text }
}
