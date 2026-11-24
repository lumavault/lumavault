import { createElement } from 'react'

import type { Mailer } from './mailer.js'
import { renderEmail } from './render.js'
import HouseholdInviteEmail, {
  householdInviteSubject,
  type HouseholdInviteEmailProps,
} from './templates/household-invite.js'
import MagicLinkEmail, {
  magicLinkSubject,
  type MagicLinkEmailProps,
} from './templates/magic-link.js'
import MemberInviteEmail, {
  memberInviteSubject,
  type MemberInviteEmailProps,
} from './templates/member-invite.js'

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
      const email = await renderEmail(
        magicLinkSubject(),
        createElement(MagicLinkEmail, props),
      )
      await mailer.send({ ...email, to, link: props.url })
    },
    async sendMemberInvite(to, props) {
      const email = await renderEmail(
        memberInviteSubject(props),
        createElement(MemberInviteEmail, props),
      )
      await mailer.send({ ...email, to, link: props.url })
    },
    async sendHouseholdInvite(to, props) {
      const email = await renderEmail(
        householdInviteSubject(props),
        createElement(HouseholdInviteEmail, props),
      )
      await mailer.send({ ...email, to, link: props.url })
    },
  }
}
