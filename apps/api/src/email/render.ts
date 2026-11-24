import type { ReactElement } from 'react'
import { render, toPlainText } from '@react-email/render'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** Renders a template to HTML plus a plain-text part for clients that block HTML. */
export async function renderEmail(
  subject: string,
  element: ReactElement,
): Promise<RenderedEmail> {
  const html = await render(element)
  return { subject, html, text: toPlainText(html) }
}
