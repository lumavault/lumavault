import type { ReactNode } from 'react'
import { EMAIL_COLORS, PRODUCT_NAME } from '#/email/constants.js'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'react-email'

interface LayoutProps {
  preview: string
  heading: string
  children: ReactNode
}

/** The frame every LumaVault email shares: a heading, a short message, and one action. */
export function Layout({ preview, heading, children }: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: EMAIL_COLORS.background,
          fontFamily: 'Helvetica, Arial, sans-serif',
          margin: 0,
        }}
      >
        <Container
          style={{
            backgroundColor: EMAIL_COLORS.card,
            margin: '40px auto',
            padding: '32px',
            maxWidth: '480px',
            borderRadius: '12px',
          }}
        >
          <Text
            style={{ color: EMAIL_COLORS.muted, fontSize: '13px', margin: 0 }}
          >
            {PRODUCT_NAME}
          </Text>
          <Heading
            as="h1"
            style={{
              color: EMAIL_COLORS.text,
              fontSize: '22px',
              margin: '8px 0 16px',
            }}
          >
            {heading}
          </Heading>
          {children}
        </Container>
      </Body>
    </Html>
  )
}

export function Paragraph({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{ color: EMAIL_COLORS.text, fontSize: '15px', lineHeight: '22px' }}
    >
      {children}
    </Text>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        color: EMAIL_COLORS.muted,
        fontSize: '13px',
        lineHeight: '20px',
      }}
    >
      {children}
    </Text>
  )
}

export function ActionButton({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Section style={{ margin: '24px 0' }}>
      <Button
        href={href}
        style={{
          backgroundColor: EMAIL_COLORS.button,
          color: EMAIL_COLORS.buttonText,
          padding: '12px 20px',
          borderRadius: '8px',
          fontSize: '15px',
        }}
      >
        {children}
      </Button>
    </Section>
  )
}
