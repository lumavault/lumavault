// Conversions between IamService wire types and the API's own values. Shared by the IAM
// router files; it registers no RPCs itself.
import { Code, ConnectError } from "@connectrpc/connect";
import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { HOUSEHOLD_ADMIN_ROLE, HOUSEHOLD_MEMBER_ROLE, type HouseholdRole } from "#/auth/constants.js";
import type { IamApp } from "#/iam/constants.js";

const APP_TO_WIRE: Record<IamApp, App> = { photos: App.PHOTOS, cinema: App.CINEMA, arcade: App.ARCADE };

export function appToWire(app: IamApp): App {
  return APP_TO_WIRE[app];
}

/** The app named by a request, rejecting APP_UNSPECIFIED and unknown values. */
export function appFromWire(app: App): IamApp {
  const found = (Object.entries(APP_TO_WIRE) as [IamApp, App][]).find(([, wire]) => wire === app);
  if (!found) {
    throw new ConnectError("app is required", Code.InvalidArgument);
  }
  return found[0];
}

export function appsFromWire(apps: App[]): IamApp[] {
  return [...new Set(apps.map(appFromWire))];
}

export function roleToWire(role: HouseholdRole): Role {
  return role === HOUSEHOLD_ADMIN_ROLE ? Role.ADMIN : Role.MEMBER;
}

export function roleFromWire(role: Role): HouseholdRole {
  if (role === Role.ADMIN) return HOUSEHOLD_ADMIN_ROLE;
  if (role === Role.MEMBER) return HOUSEHOLD_MEMBER_ROLE;
  throw new ConnectError("role is required", Code.InvalidArgument);
}

/** A required string field, trimmed. */
export function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConnectError(`${field} is required`, Code.InvalidArgument);
  }
  return trimmed;
}
