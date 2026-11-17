import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";

// In-memory data behind the mocked IamService. Tests build a state, then assert on it.

export interface MockUser {
  id: string;
  name: string;
  email: string;
  superAdmin: boolean;
  banned: boolean;
}

export interface MockMemberInvite {
  id: string;
  email: string;
  role: Role;
}

export interface MockHousehold {
  id: string;
  name: string;
  suspended: boolean;
  storageCapBytes: bigint;
  enabledApps: App[];
  memberLimit: number;
  usedBytes: bigint;
  reservedBytes: bigint;
  members: { userId: string; role: Role }[];
  invites: MockMemberInvite[];
}

export interface MockHouseholdInvite {
  id: string;
  token: string;
  storageCapBytes: bigint;
  enabledApps: App[];
  memberLimit: number;
  note: string;
  redeemed: boolean;
}

export interface MockPairing {
  code: string;
  deviceName: string;
  status: "pending" | "approved" | "expired";
}

export interface MockState {
  /** Who the mocked session belongs to; null when signed out. */
  viewerId: string | null;
  activeHouseholdId: string | null;
  needsSetup: boolean;
  adminEmail?: string;
  users: MockUser[];
  households: MockHousehold[];
  householdInvites: MockHouseholdInvite[];
  pairings: MockPairing[];
}

let nextId = 1;
export function mockId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

/** A signed-in Super-Admin who owns one household, plus a second user who is a Member. */
export function seedState(overrides: Partial<MockState> = {}): MockState {
  const owner: MockUser = { id: "u-owner", name: "Ada Lovelace", email: "ada@example.com", superAdmin: true, banned: false };
  const member: MockUser = { id: "u-member", name: "Charles Babbage", email: "charles@example.com", superAdmin: false, banned: false };
  const home: MockHousehold = {
    id: "h-home",
    name: "Lovelace Home",
    suspended: false,
    storageCapBytes: 2_000_000_000_000n,
    enabledApps: [App.PHOTOS, App.CINEMA, App.ARCADE],
    memberLimit: 4,
    usedBytes: 750_000_000_000n,
    reservedBytes: 50_000_000_000n,
    members: [
      { userId: owner.id, role: Role.ADMIN },
      { userId: member.id, role: Role.MEMBER },
    ],
    invites: [],
  };
  return {
    viewerId: owner.id,
    activeHouseholdId: home.id,
    needsSetup: false,
    users: [owner, member],
    households: [home],
    householdInvites: [],
    pairings: [{ code: "ABC234", deviceName: "Living Room", status: "pending" }],
    ...overrides,
  };
}
