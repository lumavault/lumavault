import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "./constants.js";

// Form schemas shared by every app's sign-in screens, ported from sweetbeasts-turbo.
const password = z.string().min(MIN_PASSWORD_LENGTH, { message: `Use at least ${MIN_PASSWORD_LENGTH} characters` });
const email = z.email({ message: "Enter a valid email address" });

export const SignInSchema = z.object({
  email,
  password: z.string().min(1, { message: "Password is required" }),
});

export const SignUpSchema = z
  .object({
    name: z.string().trim().min(1, { message: "Name is required" }),
    email,
    password,
    confirmPassword: z.string().min(1, { message: "Confirm your password" }),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const MagicLinkSchema = z.object({ email });

export const ForgotPasswordSchema = z.object({ email });

export const ResetPasswordSchema = z
  .object({ newPassword: password, confirmPassword: z.string().min(1, { message: "Confirm your password" }) })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { message: "Current password is required" }),
    newPassword: password,
    confirmPassword: z.string().min(1, { message: "Confirm your password" }),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export type SignInValues = z.infer<typeof SignInSchema>;
export type SignUpValues = z.infer<typeof SignUpSchema>;
export type MagicLinkValues = z.infer<typeof MagicLinkSchema>;
export type ForgotPasswordValues = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof ResetPasswordSchema>;
export type ChangePasswordValues = z.infer<typeof ChangePasswordSchema>;
