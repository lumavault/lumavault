import { ActionButton, Layout, Note, Paragraph } from "#/email/components/layout.js";

export interface PasswordResetEmailProps {
  url: string;
}

export const passwordResetSubject = () => "Reset your LumaVault password";

export default function PasswordResetEmail({ url }: PasswordResetEmailProps) {
  return (
    <Layout preview="Reset your LumaVault password" heading="Reset your password">
      <Paragraph>Use this link to choose a new password. It works once and expires soon.</Paragraph>
      <ActionButton href={url}>Choose a new password</ActionButton>
      <Note>If you did not ask to reset your password, you can ignore this email.</Note>
    </Layout>
  );
}

PasswordResetEmail.PreviewProps = { url: "http://localhost:3000/reset-password?token=preview" } satisfies PasswordResetEmailProps;
