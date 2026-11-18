import { App, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";

// In-memory data behind the mocked IamService. Tests build a state, then assert on it.

export interface MockUser {
  id: string;
  name: string;
  email: string;
  superAdmin: boolean;
  banned: boolean;
  banReason: string;
  /** Bytes of private data this user has in their household, which moves with them. */
  privateBytes: bigint;
}

export interface MockMemberInvite {
  id: string;
  email: string;
  role: Role;
}

export interface MockSharedItem {
  app: App;
  kind: string;
  id: string;
  name: string;
  sizeBytes: bigint;
  uploadedBy: string;
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
  sharedItems: MockSharedItem[];
}

export interface MockHouseholdInvite {
  id: string;
  token: string;
  email: string;
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

export interface MockGracePeriod {
  householdName: string;
  privateBytes: bigint;
  deleteAt: Date;
}

export interface MockState {
  /** Who the mocked session belongs to; null when signed out. */
  viewerId: string | null;
  needsSetup: boolean;
  adminEmail?: string;
  users: MockUser[];
  households: MockHousehold[];
  householdInvites: MockHouseholdInvite[];
  pairings: MockPairing[];
  /** Grace periods by user ID. */
  grace: Record<string, MockGracePeriod>;
}

let nextId = 1;
export function mockId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export function mockUser(fields: Partial<MockUser> & Pick<MockUser, "id" | "name" | "email">): MockUser {
  return { superAdmin: false, banned: false, banReason: "", privateBytes: 0n, ...fields };
}

/** A signed-in Super-Admin who owns one household, plus a second user who is a Member. */
export function seedState(overrides: Partial<MockState> = {}): MockState {
  const owner = mockUser({ id: "u-owner", name: "Ada Lovelace", email: "ada@example.com", superAdmin: true, privateBytes: 200_000_000_000n });
  const member = mockUser({ id: "u-member", name: "Charles Babbage", email: "charles@example.com", privateBytes: 50_000_000_000n });
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
      { userId: owner.id, role: Role.OWNER },
      { userId: member.id, role: Role.MEMBER },
    ],
    invites: [],
    sharedItems: [
      { app: App.PHOTOS, kind: "album", id: "a-summer", name: "Summer 2026", sizeBytes: 12_000_000_000n, uploadedBy: member.id },
      { app: App.CINEMA, kind: "movie", id: "m-home-movies", name: "Home Movies", sizeBytes: 30_000_000_000n, uploadedBy: owner.id },
    ],
  };
  return {
    viewerId: owner.id,
    needsSetup: false,
    users: [owner, member],
    households: [home],
    householdInvites: [],
    pairings: [{ code: "ABC234", deviceName: "Living Room", status: "pending" }],
    grace: {},
    ...overrides,
  };
}
