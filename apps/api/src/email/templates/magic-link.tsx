import {
  ActionButton,
  Layout,
  Note,
  Paragraph,
} from '#/email/components/layout.js'

export interface MagicLinkEmailProps {
  url: string
}

export const magicLinkSubject = () => 'Your LumaVault sign-in link'

export default function MagicLinkEmail({ url }: MagicLinkEmailProps) {
  return (
    <Layout preview="Sign in to LumaVault" heading="Sign in to LumaVault">
      <Paragraph>
        Use this link to sign in. It works once and expires soon.
      </Paragraph>
      <ActionButton href={url}>Sign in</ActionButton>
      <Note>If you did not ask to sign in, you can ignore this email.</Note>
    </Layout>
  )
}

MagicLinkEmail.PreviewProps = {
  url: 'http://localhost:3000/login/verify?token=preview',
} satisfies MagicLinkEmailProps
