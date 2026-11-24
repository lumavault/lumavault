import {
  ActionButton,
  Layout,
  Note,
  Paragraph,
} from '#/email/components/layout.js'

export interface HouseholdInviteEmailProps {
  url: string
  inviterName: string
}

export const householdInviteSubject = (p: HouseholdInviteEmailProps) =>
  `${p.inviterName} set up a LumaVault household for you`

export default function HouseholdInviteEmail({
  url,
  inviterName,
}: HouseholdInviteEmailProps) {
  return (
    <Layout
      preview="Create your LumaVault household"
      heading="Create your household"
    >
      <Paragraph>
        {inviterName} runs a LumaVault server and has saved space on it for you.
        Create your household to start adding photos, movies, and games, and
        invite the people you live with.
      </Paragraph>
      <ActionButton href={url}>Create household</ActionButton>
      <Note>This link works once.</Note>
    </Layout>
  )
}

HouseholdInviteEmail.PreviewProps = {
  url: 'http://localhost:3000/invite/household/preview',
  inviterName: 'Ada',
} satisfies HouseholdInviteEmailProps
