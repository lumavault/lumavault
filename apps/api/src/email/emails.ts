import type { Mailer } from './mailer.js'
import { renderEmail } from './render.js'

export interface MagicLinkEmailProps {
  url: string
}

export interface MemberInviteEmailProps {
  url: string
  householdName: string
  inviterName: string
}

export interface HouseholdInviteEmailProps {
  url: string
  inviterName: string
}

/** Every email the API sends. Routers and Better Auth call these, never the mailer directly. */
export interface EmailService {
  sendMagicLink(to: string, props: MagicLinkEmailProps): Promise<void>
  sendMemberInvite(to: string, props: MemberInviteEmailProps): Promise<void>
  sendHouseholdInvite(
    to: string,
    props: HouseholdInviteEmailProps,
  ): Promise<void>
}

export function createEmailService(mailer: Mailer): EmailService {
  return {
    async sendMagicLink(to, props) {
      const email = renderEmail({
        subject: 'Your LumaVault sign-in link',
        preview: 'Sign in to LumaVault',
        heading: 'Sign in to LumaVault',
        body: 'Use this link to sign in. It works once and expires soon.',
        actionLabel: 'Sign in',
        actionUrl: props.url,
        note: 'If you did not ask to sign in, you can ignore this email.',
      })
      await mailer.send({ ...email, to, link: props.url })
    },
    async sendMemberInvite(to, props) {
      const email = renderEmail({
        subject: `${props.inviterName} invited you to ${props.householdName} on LumaVault`,
        preview: `Join ${props.householdName} on LumaVault`,
        heading: `Join ${props.householdName}`,
        body: `${props.inviterName} invited you to their household on LumaVault, where you can share photos, movies, and games.`,
        actionLabel: 'Accept invite',
        actionUrl: props.url,
        note: 'If you were not expecting this, you can ignore this email.',
      })
      await mailer.send({ ...email, to, link: props.url })
    },
    async sendHouseholdInvite(to, props) {
      const email = renderEmail({
        subject: `${props.inviterName} set up a LumaVault household for you`,
        preview: 'Create your LumaVault household',
        heading: 'Create your household',
        body: `${props.inviterName} runs a LumaVault server and has saved space on it for you. Create your household to start adding photos, movies, and games, and invite the people you live with.`,
        actionLabel: 'Create household',
        actionUrl: props.url,
        note: 'This link works once.',
      })
      await mailer.send({ ...email, to, link: props.url })
    },
  }
}
