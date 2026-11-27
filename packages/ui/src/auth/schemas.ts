import { z } from 'zod'

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

export const emailSchema = z.email('Enter a valid email address.')

export const passwordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  )
  .max(
    MAX_PASSWORD_LENGTH,
    `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
  )

export const signInPasswordSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})

export const signUpPasswordSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.'),
  email: emailSchema,
  password: passwordSchema,
})

export const magicLinkSchema = z.object({
  email: emailSchema,
  name: z.string().trim().optional(),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'New passwords do not match.',
  })
