import { Code, ConnectError, createRouterTransport, type Transport } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { IamService, Role } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { type MockHousehold, type MockState, type MockUser, mockId } from "./state";

/**
 * An in-memory IamService with the same rules and error codes as the API: seats count pending
 * invites, a household keeps one Admin, Super-Admin calls need the flag. Pages are built and
 * tested against it before they meet the real server.
 */
export function createMockIamTransport(state: MockState): Transport {
  const now = () => timestampFromDate(new Date());
  const viewer = (): MockUser => {
    const u = state.users.find((x) => x.id === state.viewerId);
    if (!u || u.banned) throw new ConnectError("sign in required", Code.Unauthenticated);
    return u;
  };
  const superAdmin = () => {
    const u = viewer();
    if (!u.superAdmin) throw new ConnectError("Super-Admin only", Code.PermissionDenied);
    return u;
  };
  const household = (id: string | null | undefined): MockHousehold => {
    const h = state.households.find((x) => x.id === id);
    if (!h) throw new ConnectError("no such household", Code.NotFound);
    return h;
  };
  const roleIn = (h: MockHousehold, userId: string) => h.members.find((m) => m.userId === userId)?.role;
  const active = (needAdmin: boolean) => {
    const u = viewer();
    if (!state.activeHouseholdId) throw new ConnectError("no active household", Code.FailedPrecondition);
    const h = household(state.activeHouseholdId);
    const role = roleIn(h, u.id);
    if (!role) throw new ConnectError("no active household", Code.FailedPrecondition);
    if (h.suspended) throw new ConnectError("household is suspended", Code.PermissionDenied);
    if (needAdmin && role !== Role.ADMIN) throw new ConnectError("household Admin only", Code.PermissionDenied);
    return { u, h };
  };
  const userMsg = (u: MockUser) => ({ id: u.id, name: u.name, email: u.email, isSuperAdmin: u.superAdmin, banned: u.banned, createdAt: now() });
  const usage = (h: MockHousehold) => {
    const left = h.storageCapBytes - h.usedBytes - h.reservedBytes;
    return { usedBytes: h.usedBytes, reservedBytes: h.reservedBytes, remainingBytes: left > 0n ? left : 0n };
  };
  const householdMsg = (h: MockHousehold) => ({
    id: h.id,
    name: h.name,
    suspended: h.suspended,
    allowance: { storageCapBytes: h.storageCapBytes, enabledApps: h.enabledApps, memberLimit: h.memberLimit },
    createdAt: now(),
  });
  const viewerMsg = () => {
    const u = viewer();
    const memberships = state.households
      .filter((h) => roleIn(h, u.id))
      .map((h) => ({ household: householdMsg(h), role: roleIn(h, u.id)! }));
    const act = state.households.find((h) => h.id === state.activeHouseholdId && roleIn(h, u.id));
    return { user: userMsg(u), memberships, activeHouseholdId: act?.id ?? "", activeUsage: act ? usage(act) : undefined };
  };
  const seatsLeft = (h: MockHousehold) => Math.max(h.memberLimit - h.members.length - h.invites.length, 0);
  const admins = (h: MockHousehold, except: string) => h.members.filter((m) => m.role === Role.ADMIN && m.userId !== except).length;

  return createRouterTransport(({ rpc }) => {
    rpc(IamService.method.getSetupStatus, () => ({ needsSetup: state.needsSetup, adminEmailRequired: Boolean(state.adminEmail) }));
    rpc(IamService.method.completeSetup, (req) => {
      if (!state.needsSetup) throw new ConnectError("this server is already set up", Code.FailedPrecondition);
      if (state.adminEmail && req.email.toLowerCase() !== state.adminEmail) {
        throw new ConnectError("this server is set up for a different admin email", Code.PermissionDenied);
      }
      const u: MockUser = { id: mockId("u"), name: req.name, email: req.email, superAdmin: true, banned: false };
      const h: MockHousehold = {
        id: mockId("h"), name: req.householdName, suspended: false, storageCapBytes: 2n ** 62n,
        enabledApps: [1, 2, 3], memberLimit: 4, usedBytes: 0n, reservedBytes: 0n,
        members: [{ userId: u.id, role: Role.ADMIN }], invites: [],
      };
      state.users.push(u);
      state.households.push(h);
      state.needsSetup = false;
      state.viewerId = u.id;
      state.activeHouseholdId = h.id;
      return { user: userMsg(u), household: householdMsg(h) };
    });
    rpc(IamService.method.getViewer, () => viewerMsg());
    rpc(IamService.method.setActiveHousehold, (req) => {
      const u = viewer();
      if (!roleIn(household(req.householdId), u.id)) throw new ConnectError("you are not a member of that household", Code.PermissionDenied);
      state.activeHouseholdId = req.householdId;
      return { viewer: viewerMsg() };
    });

    rpc(IamService.method.createHouseholdInvite, (req) => {
      superAdmin();
      const inv = {
        id: mockId("hi"), token: mockId("tok"), note: req.note,
        storageCapBytes: req.allowance?.storageCapBytes ?? 0n, enabledApps: req.allowance?.enabledApps ?? [],
        memberLimit: req.allowance?.memberLimit || 4, redeemed: false,
      };
      state.householdInvites.push(inv);
      return { invite: { id: inv.id, note: inv.note, allowance: { storageCapBytes: inv.storageCapBytes, enabledApps: inv.enabledApps, memberLimit: inv.memberLimit } }, inviteUrl: `http://localhost:3000/invite/household/${inv.token}` };
    });
    rpc(IamService.method.listHouseholdInvites, () => {
      superAdmin();
      return { invites: state.householdInvites.filter((i) => !i.redeemed).map((i) => ({ id: i.id, note: i.note, allowance: { storageCapBytes: i.storageCapBytes, enabledApps: i.enabledApps, memberLimit: i.memberLimit } })) };
    });
    rpc(IamService.method.revokeHouseholdInvite, (req) => {
      superAdmin();
      state.householdInvites = state.householdInvites.filter((i) => i.id !== req.inviteId);
      return {};
    });
    rpc(IamService.method.listHouseholds, () => {
      superAdmin();
      return { households: state.households.map((h) => ({ household: householdMsg(h), usage: usage(h), memberCount: h.members.length, pendingInviteCount: h.invites.length })), nextPageToken: "" };
    });
    rpc(IamService.method.updateHouseholdAllowance, (req) => {
      superAdmin();
      const h = household(req.householdId);
      for (const path of req.updateMask?.paths ?? []) {
        if (path === "storage_cap_bytes") h.storageCapBytes = req.allowance?.storageCapBytes ?? 0n;
        else if (path === "enabled_apps") h.enabledApps = req.allowance?.enabledApps ?? [];
        else if (path === "member_limit") {
          if ((req.allowance?.memberLimit ?? 0) < 1) throw new ConnectError("member_limit must be at least 1", Code.InvalidArgument);
          h.memberLimit = req.allowance!.memberLimit;
        } else throw new ConnectError(`cannot update ${path}`, Code.InvalidArgument);
      }
      return { household: householdMsg(h) };
    });
    rpc(IamService.method.setHouseholdSuspended, (req) => {
      superAdmin();
      const h = household(req.householdId);
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
      if (req.userId === me.id) throw new ConnectError("you cannot ban yourself", Code.FailedPrecondition);
      const u = state.users.find((x) => x.id === req.userId);
      if (!u) throw new ConnectError("no such user", Code.NotFound);
      u.banned = true;
      return { user: userMsg(u) };
    });
    rpc(IamService.method.unbanUser, (req) => {
      superAdmin();
      const u = state.users.find((x) => x.id === req.userId);
      if (!u) throw new ConnectError("no such user", Code.NotFound);
      u.banned = false;
      return { user: userMsg(u) };
    });

    rpc(IamService.method.redeemHouseholdInvite, (req) => {
      const u = viewer();
      const inv = state.householdInvites.find((i) => i.token === req.token);
      if (!inv) throw new ConnectError("this invite link is not valid", Code.NotFound);
      if (inv.redeemed) throw new ConnectError("this invite link was already used", Code.FailedPrecondition);
      inv.redeemed = true;
      const h: MockHousehold = {
        id: mockId("h"), name: req.householdName, suspended: false, storageCapBytes: inv.storageCapBytes,
        enabledApps: inv.enabledApps, memberLimit: inv.memberLimit, usedBytes: 0n, reservedBytes: 0n,
        members: [{ userId: u.id, role: Role.ADMIN }], invites: [],
      };
      state.households.push(h);
      state.activeHouseholdId = h.id;
      return { household: householdMsg(h) };
    });
    rpc(IamService.method.listMembers, () => {
      const { h } = active(false);
      return {
        members: h.members.map((m) => ({ user: userMsg(state.users.find((u) => u.id === m.userId)!), role: m.role, joinedAt: now() })),
        pendingInvites: h.invites.map((i) => ({ ...i, expiresAt: now() })),
        seatsRemaining: seatsLeft(h),
      };
    });
    rpc(IamService.method.inviteMember, (req) => {
      const { h } = active(true);
      if (seatsLeft(h) === 0) throw new ConnectError("the household has no free seats; pending invites count", Code.ResourceExhausted);
      const inv = { id: mockId("mi"), email: req.email.toLowerCase(), role: req.role };
      h.invites.push(inv);
      return { invite: { ...inv, expiresAt: now() }, inviteUrl: `http://localhost:3000/invite/member/${inv.id}` };
    });
    rpc(IamService.method.cancelMemberInvite, (req) => {
      const { h } = active(true);
      h.invites = h.invites.filter((i) => i.id !== req.inviteId);
      return {};
    });
    rpc(IamService.method.acceptMemberInvite, (req) => {
      const u = viewer();
      const h = state.households.find((x) => x.invites.some((i) => i.id === req.inviteId));
      const inv = h?.invites.find((i) => i.id === req.inviteId);
      if (!h || !inv) throw new ConnectError("this invite is not valid", Code.NotFound);
      if (inv.email !== u.email.toLowerCase()) throw new ConnectError("this invite is for another email address", Code.PermissionDenied);
      h.invites = h.invites.filter((i) => i !== inv);
      h.members.push({ userId: u.id, role: inv.role });
      state.activeHouseholdId = h.id;
      return { household: householdMsg(h) };
    });
    rpc(IamService.method.removeMember, (req) => {
      const { h } = active(true);
      if (!roleIn(h, req.userId)) throw new ConnectError("no such member", Code.NotFound);
      if (admins(h, req.userId) === 0) throw new ConnectError("a household needs at least one Admin", Code.FailedPrecondition);
      h.members = h.members.filter((m) => m.userId !== req.userId);
      return {};
    });
    rpc(IamService.method.updateMemberRole, (req) => {
      const { h } = active(true);
      const m = h.members.find((x) => x.userId === req.userId);
      if (!m) throw new ConnectError("no such member", Code.NotFound);
      if (req.role !== Role.ADMIN && admins(h, req.userId) === 0) throw new ConnectError("a household needs at least one Admin", Code.FailedPrecondition);
      m.role = req.role;
      return { member: { user: userMsg(state.users.find((u) => u.id === m.userId)!), role: m.role, joinedAt: now() } };
    });

    rpc(IamService.method.approvePairing, (req) => {
      const u = viewer();
      if (!roleIn(household(req.householdId), u.id)) throw new ConnectError("you are not a member of that household", Code.PermissionDenied);
      const p = state.pairings.find((x) => x.code === req.code.toUpperCase().replace(/[\s-]/g, "") && x.status === "pending");
      if (!p) throw new ConnectError("that code is wrong or expired", Code.NotFound);
      p.status = "approved";
      return { deviceName: p.deviceName };
    });
  });
}
