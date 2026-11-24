import {
  ActionButton,
  Layout,
  Note,
  Paragraph,
} from '#/email/components/layout.js'

export interface MemberInviteEmailProps {
  url: string
  householdName: string
  inviterName: string
}

export const memberInviteSubject = (p: MemberInviteEmailProps) =>
  `${p.inviterName} invited you to ${p.householdName} on LumaVault`

export default function MemberInviteEmail({
  url,
  householdName,
  inviterName,
}: MemberInviteEmailProps) {
  return (
    <Layout
      preview={`Join ${householdName} on LumaVault`}
      heading={`Join ${householdName}`}
    >
      <Paragraph>
        {inviterName} invited you to their household on LumaVault, where you can
        share photos, movies, and games.
      </Paragraph>
      <ActionButton href={url}>Accept invite</ActionButton>
      <Note>If you were not expecting this, you can ignore this email.</Note>
    </Layout>
  )
}

MemberInviteEmail.PreviewProps = {
  url: 'http://localhost:3000/invite/member/preview',
  householdName: 'The Lovelace Family',
  inviterName: 'Ada',
} satisfies MemberInviteEmailProps
