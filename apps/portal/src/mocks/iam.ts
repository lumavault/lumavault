import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createRouterTransport, type Transport } from "@connectrpc/connect";
import { IamService, type InviteRef, InviteKind, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { type MockHousehold, type MockState, type MockUser, mockId, mockUser } from "./state";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * An in-memory IamService with the same rules and error codes as the API: one household per
 * user, one Owner, seats count pending invites, moves carry private data, and removed people
 * keep a grace period. Pages are built and tested against it before they meet the real server.
 */
export function createMockIamTransport(state: MockState): Transport {
  const now = () => timestampFromDate(new Date());
  const fail = (code: Code, message: string): never => {
    throw new ConnectError(message, code);
  };
  const viewer = (): MockUser => {
    const u = state.users.find((x) => x.id === state.viewerId);
    if (!u || u.banned) return fail(Code.Unauthenticated, "sign in required");
    return u;
  };
  const superAdmin = () => {
    const u = viewer();
    if (!u.superAdmin) fail(Code.PermissionDenied, "Super-Admin only");
    return u;
  };
  const householdById = (id: string) => state.households.find((h) => h.id === id) ?? fail(Code.NotFound, "no such household");
  const householdOf = (userId: string) => state.households.find((h) => h.members.some((m) => m.userId === userId));
  const roleIn = (h: MockHousehold, userId: string) => h.members.find((m) => m.userId === userId)?.role;
  const userById = (id: string) => state.users.find((u) => u.id === id)!;
  const mine = (needAdmin: boolean, needOwner = false) => {
    const u = viewer();
    const h = householdOf(u.id) ?? fail(Code.FailedPrecondition, "you are not in a household");
    if (h.suspended) fail(Code.PermissionDenied, "household is suspended");
    const role = roleIn(h, u.id)!;
    if (needOwner && role !== Role.OWNER) fail(Code.PermissionDenied, "household Owner only");
    if (needAdmin && role === Role.MEMBER) fail(Code.PermissionDenied, "household Admin only");
    return { u, h, role };
  };
  const userMsg = (u: MockUser) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isSuperAdmin: u.superAdmin,
    banned: u.banned,
    banReason: u.banReason,
    createdAt: now(),
  });
  const held = (h: MockHousehold) =>
    Object.entries(state.grace)
      .filter(([, g]) => g.householdName === h.name)
      .reduce((sum, [, g]) => sum + g.privateBytes, 0n);
  const usage = (h: MockHousehold) => {
    const left = h.storageCapBytes - h.usedBytes - h.reservedBytes;
    return { usedBytes: h.usedBytes, reservedBytes: h.reservedBytes, remainingBytes: left > 0n ? left : 0n, heldBytes: held(h) };
  };
  const ownerId = (h: MockHousehold) => h.members.find((m) => m.role === Role.OWNER)?.userId ?? "";
  const householdMsg = (h: MockHousehold) => ({
    id: h.id,
    name: h.name,
    suspended: h.suspended,
    allowance: { storageCapBytes: h.storageCapBytes, enabledApps: h.enabledApps, memberLimit: h.memberLimit },
    ownerUserId: ownerId(h),
    createdAt: now(),
  });
  const viewerMsg = () => {
    const u = viewer();
    const h = householdOf(u.id);
    const g = state.grace[u.id];
    return {
      user: userMsg(u),
      household: h ? householdMsg(h) : undefined,
      role: h ? roleIn(h, u.id)! : Role.UNSPECIFIED,
      usage: h ? usage(h) : undefined,
      gracePeriod: g ? { formerHouseholdName: g.householdName, privateBytes: g.privateBytes, deleteAt: timestampFromDate(g.deleteAt) } : undefined,
    };
  };
  const seatsLeft = (h: MockHousehold) => Math.max(h.memberLimit - h.members.length - h.invites.length, 0);
  const startGrace = (u: MockUser, h: MockHousehold) => {
    state.grace[u.id] = { householdName: h.name, privateBytes: u.privateBytes, deleteAt: new Date(Date.now() + GRACE_MS) };
  };
  const resolve = (ref: InviteRef | undefined) => {
    const which = ref?.invite;
    if (which?.case === "householdInviteToken") {
      const inv = state.householdInvites.find((i) => i.token === which.value) ?? fail(Code.NotFound, "this invite link is not valid");
      if (inv.redeemed) fail(Code.FailedPrecondition, "this invite link was already used");
      return { kind: "new" as const, inv };
    }
    if (which?.case === "memberInviteId") {
      const h = state.households.find((x) => x.invites.some((i) => i.id === which.value)) ?? fail(Code.NotFound, "this invite link is not valid");
      return { kind: "member" as const, h, inv: h.invites.find((i) => i.id === which.value)! };
    }
    return fail(Code.InvalidArgument, "invite is required");
  };
  const leave = (u: MockUser, h: MockHousehold, nextOwner: string) => {
    const others = h.members.filter((m) => m.userId !== u.id);
    if (roleIn(h, u.id) === Role.OWNER && others.length > 0) {
      if (!nextOwner) fail(Code.FailedPrecondition, "name the next Owner of your current household");
      const next = others.find((m) => m.userId === nextOwner) ?? fail(Code.InvalidArgument, "the next Owner must be a member of your current household");
      next.role = Role.OWNER;
    }
    h.members = others;
    h.usedBytes -= u.privateBytes;
    return others.length === 0;
  };

  return createRouterTransport(({ rpc }) => {
    rpc(IamService.method.getSetupStatus, () => ({ needsSetup: state.needsSetup, adminEmailRequired: Boolean(state.adminEmail) }));
    rpc(IamService.method.completeSetup, (req) => {
      if (!state.needsSetup) fail(Code.FailedPrecondition, "this server is already set up");
      if (state.adminEmail && req.email.toLowerCase() !== state.adminEmail) {
        fail(Code.PermissionDenied, "this server is set up for a different admin email");
      }
      const u = mockUser({ id: mockId("u"), name: req.name, email: req.email, superAdmin: true });
      const h: MockHousehold = {
        id: mockId("h"), name: req.householdName, suspended: false, storageCapBytes: 2n ** 62n, enabledApps: [1, 2, 3],
        memberLimit: 4, usedBytes: 0n, reservedBytes: 0n, members: [{ userId: u.id, role: Role.OWNER }], invites: [], sharedItems: [],
      };
      state.users.push(u);
      state.households.push(h);
      state.needsSetup = false;
      state.viewerId = u.id;
      return { user: userMsg(u), household: householdMsg(h) };
    });
    rpc(IamService.method.getViewer, () => viewerMsg());

    rpc(IamService.method.createHouseholdInvite, (req) => {
      superAdmin();
      if (!req.email.trim()) fail(Code.InvalidArgument, "email is required");
      const inv = {
        id: mockId("hi"), token: mockId("tok"), email: req.email.toLowerCase(), note: req.note,
        storageCapBytes: req.allowance?.storageCapBytes ?? 0n, enabledApps: req.allowance?.enabledApps ?? [],
        memberLimit: req.allowance?.memberLimit || 4, redeemed: false,
      };
      state.householdInvites.push(inv);
      return {
        invite: { id: inv.id, email: inv.email, note: inv.note, allowance: { storageCapBytes: inv.storageCapBytes, enabledApps: inv.enabledApps, memberLimit: inv.memberLimit } },
        inviteUrl: `http://localhost:3000/invite/household/${inv.token}`,
      };
    });
    rpc(IamService.method.listHouseholdInvites, () => {
      superAdmin();
      return {
        invites: state.householdInvites
          .filter((i) => !i.redeemed)
          .map((i) => ({ id: i.id, email: i.email, note: i.note, allowance: { storageCapBytes: i.storageCapBytes, enabledApps: i.enabledApps, memberLimit: i.memberLimit } })),
      };
    });
    rpc(IamService.method.revokeHouseholdInvite, (req) => {
      superAdmin();
      state.householdInvites = state.householdInvites.filter((i) => i.id !== req.inviteId);
      return {};
    });
    rpc(IamService.method.listHouseholds, () => {
      superAdmin();
      return {
        households: state.households.map((h) => ({
          household: householdMsg(h),
          owner: ownerId(h) ? userMsg(userById(ownerId(h))) : undefined,
          usage: usage(h),
          memberCount: h.members.length,
          pendingInviteCount: h.invites.length,
        })),
        nextPageToken: "",
      };
    });
    rpc(IamService.method.updateHouseholdAllowance, (req) => {
      superAdmin();
      const h = householdById(req.householdId);
      for (const path of req.updateMask?.paths ?? []) {
        if (path === "storage_cap_bytes") h.storageCapBytes = req.allowance?.storageCapBytes ?? 0n;
        else if (path === "enabled_apps") h.enabledApps = req.allowance?.enabledApps ?? [];
        else if (path === "member_limit") {
          if ((req.allowance?.memberLimit ?? 0) < 1) fail(Code.InvalidArgument, "member_limit must be at least 1");
          h.memberLimit = req.allowance!.memberLimit;
        } else fail(Code.InvalidArgument, `cannot update ${path}`);
      }
      return { household: householdMsg(h) };
    });
    rpc(IamService.method.setHouseholdSuspended, (req) => {
      superAdmin();
      const h = householdById(req.householdId);
      h.suspended = req.suspended;
      return { household: householdMsg(h) };
    });
    rpc(IamService.method.listUsers, (req) => {
      superAdmin();
      const q = req.query.toLowerCase();
      return { users: state.users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).map(userMsg), nextPageToken: "" };
    });
    rpc(IamService.method.banUser, (req) => {
      const me = superAdmin();
      if (req.userId === me.id) fail(Code.FailedPrecondition, "you cannot ban yourself");
      const u = state.users.find((x) => x.id === req.userId) ?? fail(Code.NotFound, "no such user");
      u.banned = true;
      u.banReason = req.reason;
      return { user: userMsg(u) };
    });
    rpc(IamService.method.unbanUser, (req) => {
      superAdmin();
      const u = state.users.find((x) => x.id === req.userId) ?? fail(Code.NotFound, "no such user");
      u.banned = false;
      u.banReason = "";
      return { user: userMsg(u) };
    });

    rpc(IamService.method.getInvite, (req) => {
      const r = resolve(req.invite);
      const base = r.kind === "new"
        ? { kind: InviteKind.NEW_HOUSEHOLD, email: r.inv.email, inviterName: "Server owner", householdName: "", role: Role.OWNER }
        : { kind: InviteKind.MEMBER, email: r.inv.email, inviterName: userById(ownerId(r.h)).name, householdName: r.h.name, role: r.inv.role };
      const u = state.users.find((x) => x.id === state.viewerId && !x.banned);
      const h = u && householdOf(u.id);
      if (!u || !h) return base;
      const others = h.members.filter((m) => m.userId !== u.id);
      const owner = roleIn(h, u.id) === Role.OWNER;
      return {
        ...base,
        move: {
          currentHousehold: householdMsg(h),
          privateBytes: u.privateBytes,
          mustChooseNextOwner: owner && others.length > 0,
          nextOwnerCandidates: owner ? others.map((m) => ({ user: userMsg(userById(m.userId)), role: m.role, joinedAt: now() })) : [],
          closesCurrentHousehold: others.length === 0,
        },
      };
    });
    rpc(IamService.method.listCopyableItems, () => {
      const { u, h } = mine(false);
      return {
        items: h.sharedItems.map((i) => ({ ref: { app: i.app, kind: i.kind, id: i.id }, name: i.name, sizeBytes: i.sizeBytes, uploadedByCaller: i.uploadedBy === u.id })),
        nextPageToken: "",
      };
    });
    rpc(IamService.method.joinHousehold, (req) => {
      const u = viewer();
      const r = resolve(req.invite);
      if (r.inv.email !== u.email.toLowerCase()) fail(Code.PermissionDenied, "this invite is for another email address");
      const current = householdOf(u.id);
      const copies = current ? current.sharedItems.filter((i) => req.copyItems.some((c) => c.app === i.app && c.kind === i.kind && c.id === i.id)) : [];
      const incoming = (current || state.grace[u.id] ? u.privateBytes : 0n) + copies.reduce((s, i) => s + i.sizeBytes, 0n);
      let target: MockHousehold;
      if (r.kind === "new") {
        if (!req.householdName.trim()) fail(Code.InvalidArgument, "household_name is required");
        if (incoming > r.inv.storageCapBytes) fail(Code.ResourceExhausted, "the household does not have room for your data and copies");
        if (current) leave(u, current, req.nextOwnerUserId);
        r.inv.redeemed = true;
        target = {
          id: mockId("h"), name: req.householdName, suspended: false, storageCapBytes: r.inv.storageCapBytes, enabledApps: r.inv.enabledApps,
          memberLimit: r.inv.memberLimit, usedBytes: 0n, reservedBytes: 0n, members: [{ userId: u.id, role: Role.OWNER }], invites: [], sharedItems: [],
        };
        state.households.push(target);
      } else {
        target = r.h;
        if (current?.id === target.id) fail(Code.AlreadyExists, "you are already in this household");
        if (target.usedBytes + target.reservedBytes + incoming > target.storageCapBytes) {
          fail(Code.ResourceExhausted, "the household does not have room for your data and copies");
        }
        if (current) leave(u, current, req.nextOwnerUserId);
        target.invites = target.invites.filter((i) => i !== r.inv);
        target.members.push({ userId: u.id, role: r.inv.role });
      }
      target.usedBytes += incoming;
      target.sharedItems.push(...copies.map((c) => ({ ...c, uploadedBy: u.id })));
      if (current && current.members.length === 0) state.households = state.households.filter((h) => h !== current);
      delete state.grace[u.id];
      return { household: householdMsg(target) };
    });
    rpc(IamService.method.leaveHousehold, (req) => {
      const u = viewer();
      const h = householdOf(u.id) ?? fail(Code.FailedPrecondition, "you are not in a household");
      leave(u, h, req.nextOwnerUserId);
      h.usedBytes += u.privateBytes;
      startGrace(u, h);
      return {};
    });

    rpc(IamService.method.listMembers, () => {
      const { h } = mine(false);
      return {
        members: h.members.map((m) => ({ user: userMsg(userById(m.userId)), role: m.role, joinedAt: now() })),
        pendingInvites: h.invites.map((i) => ({ ...i, expiresAt: now() })),
        seatsRemaining: seatsLeft(h),
      };
    });
    rpc(IamService.method.inviteMember, (req) => {
      const { h } = mine(true);
      if (req.role !== Role.ADMIN && req.role !== Role.MEMBER) fail(Code.InvalidArgument, "role must be Admin or Member");
      if (seatsLeft(h) === 0) fail(Code.ResourceExhausted, "the household has no free seats; pending invites count");
      const inv = { id: mockId("mi"), email: req.email.toLowerCase(), role: req.role };
      h.invites.push(inv);
      return { invite: { ...inv, expiresAt: now() }, inviteUrl: `http://localhost:3000/invite/member/${inv.id}` };
    });
    rpc(IamService.method.cancelMemberInvite, (req) => {
      const { h } = mine(true);
      h.invites = h.invites.filter((i) => i.id !== req.inviteId);
      return {};
    });
    rpc(IamService.method.removeMember, (req) => {
      const { h } = mine(true);
      const role = roleIn(h, req.userId) ?? fail(Code.NotFound, "no such member");
      if (role === Role.OWNER) fail(Code.FailedPrecondition, "the Owner cannot be removed; transfer ownership first");
      h.members = h.members.filter((m) => m.userId !== req.userId);
      startGrace(userById(req.userId), h);
      return {};
    });
    rpc(IamService.method.updateMemberRole, (req) => {
      const { h } = mine(true);
      const m = h.members.find((x) => x.userId === req.userId) ?? fail(Code.NotFound, "no such member");
      if (m.role === Role.OWNER) fail(Code.FailedPrecondition, "the Owner's role changes only by transferring ownership");
      if (req.role !== Role.ADMIN && req.role !== Role.MEMBER) fail(Code.InvalidArgument, "role must be Admin or Member");
      m.role = req.role;
      return { member: { user: userMsg(userById(m.userId)), role: m.role, joinedAt: now() } };
    });
    rpc(IamService.method.transferOwnership, (req) => {
      const { u, h } = mine(false, true);
      const next = h.members.find((m) => m.userId === req.userId) ?? fail(Code.NotFound, "no such member");
      if (next.userId === u.id) fail(Code.InvalidArgument, "you are already the Owner");
      next.role = Role.OWNER;
      h.members.find((m) => m.userId === u.id)!.role = Role.ADMIN;
      return {};
    });

    rpc(IamService.method.approvePairing, (req) => {
      mine(false);
      const p = state.pairings.find((x) => x.code === req.code.toUpperCase().replace(/[\s-]/g, "") && x.status === "pending");
      if (!p) fail(Code.NotFound, "that code is wrong or expired");
      p!.status = "approved";
      return { deviceName: p!.deviceName };
    });
  });
}
