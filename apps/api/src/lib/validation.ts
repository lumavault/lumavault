// Input schemas shared by every RPC handler, so each field has one rule.
import { z } from 'zod'

export const emailSchema = z.email()
export const uuidSchema = z.uuid()
