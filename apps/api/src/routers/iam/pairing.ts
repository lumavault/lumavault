import { randomInt } from "node:crypto";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { IamService, PairingStatus } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { mintBearerSession } from "#/auth/server-helpers.js";
import { createPairingRequest } from "#/data/iam/pairing-request/create-pairing-request.js";
import { getPairingRequest } from "#/data/iam/pairing-request/get-pairing-request.js";
import {
  approvePairingRequestByCode,
  claimPairingRequest,
  recordFailedPairingAttempt,
} from "#/data/iam/pairing-request/update-pairing-request.js";
import { isUniqueViolation } from "#/db/errors.js";
import { requireHouseholdMember } from "#/guards.js";
import {
  PAIRING_APPROVALS_PER_WINDOW,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_DRAWS,
  PAIRING_CODE_LENGTH,
  PAIRING_DEVICE_NAME_MAX_LENGTH,
  PAIRING_MAX_FAILED_ATTEMPTS,
  PAIRING_POLL_INTERVAL_SECONDS,
  PAIRING_POLLS_PER_WINDOW,
  PAIRING_RATE_WINDOW_MS,
  PAIRING_STARTS_PER_WINDOW,
  PAIRING_TTL_MS,
} from "#/iam/constants.js";
import { RateLimiter } from "#/lib/rate-limit.js";
import { hashSecret, newSecret } from "#/lib/secrets.js";
import type { ApiModule } from "#/server/modules.js";
import { clientIpKey } from "#/server/request.js";
import { required } from "./convert.js";

/** A random code from the lookalike-free alphabet. */
export function newPairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

// People type codes with spaces, dashes, or lowercase letters; none of those change the code.
function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

function tooMany(): ConnectError {
  return new ConnectError("too many pairing attempts; wait a few minutes", Code.ResourceExhausted);
}

export const module: ApiModule = {
  name: "iam-pairing",
  rpc(router, ctx) {
    const starts = new RateLimiter(PAIRING_STARTS_PER_WINDOW, PAIRING_RATE_WINDOW_MS);
    const polls = new RateLimiter(PAIRING_POLLS_PER_WINDOW, PAIRING_RATE_WINDOW_MS);
    const approvals = new RateLimiter(PAIRING_APPROVALS_PER_WINDOW, PAIRING_RATE_WINDOW_MS);

    router.rpc(IamService.method.startPairing, async (req, call) => {
      const ip = call.values.get(clientIpKey);
      if (!starts.allow(ip)) {
        throw tooMany();
      }
      const deviceName = required(req.deviceName, "device_name");
      if (deviceName.length > PAIRING_DEVICE_NAME_MAX_LENGTH) {
        throw new ConnectError(`device_name is longer than ${PAIRING_DEVICE_NAME_MAX_LENGTH} characters`, Code.InvalidArgument);
      }
      const deviceSecret = newSecret();
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
      for (let draw = 0; draw < PAIRING_CODE_DRAWS; draw++) {
        const code = newPairingCode();
        try {
          const pairingId = await createPairingRequest(ctx.db, {
            code,
            deviceSecretHash: hashSecret(deviceSecret),
            deviceName,
            requesterIp: ip,
            expiresAt,
          });
          return {
            pairingId,
            code,
            deviceSecret,
            expiresAt: timestampFromDate(expiresAt),
            pollIntervalSeconds: PAIRING_POLL_INTERVAL_SECONDS,
          };
        } catch (err) {
          if (!isUniqueViolation(err)) {
            throw err;
          }
        }
      }
      throw new ConnectError("could not pick a free pairing code", Code.Unavailable);
    });

    // A user is in at most one household, so the Apple TV always opens in the approver's.
    router.rpc(IamService.method.approvePairing, async (req, call) => {
      const { viewer, household } = await requireHouseholdMember(call, ctx);
      if (!approvals.allow(viewer.userId)) {
        throw tooMany();
      }
      const approved = await approvePairingRequestByCode(
        ctx.db,
        normalizeCode(required(req.code, "code")),
        { approvedBy: viewer.userId, householdId: household.householdId },
        new Date(),
      );
      if (!approved) {
        throw new ConnectError("that code is wrong or expired", Code.NotFound);
      }
      return { deviceName: approved.deviceName };
    });

    router.rpc(IamService.method.pollPairing, async (req, call) => {
      if (!polls.allow(call.values.get(clientIpKey))) {
        throw tooMany();
      }
      const pairing = await getPairingRequest(ctx.db, required(req.pairingId, "pairing_id"));
      if (!pairing) {
        throw new ConnectError("no such pairing", Code.NotFound);
      }
      if (hashSecret(req.deviceSecret) !== pairing.deviceSecretHash) {
        await recordFailedPairingAttempt(ctx.db, pairing.id, PAIRING_MAX_FAILED_ATTEMPTS);
        throw new ConnectError("wrong device secret", Code.PermissionDenied);
      }
      const now = new Date();
      if (pairing.status === "pending" && pairing.expiresAt > now) {
        return { status: PairingStatus.PENDING };
      }
      if (pairing.status !== "approved") {
        return { status: PairingStatus.EXPIRED };
      }
      // Claim before minting, so two racing polls cannot both get a session.
      const claimed = await claimPairingRequest(ctx.db, pairing.id, now);
      if (!claimed?.approvedBy) {
        return { status: PairingStatus.EXPIRED };
      }
      return { status: PairingStatus.APPROVED, sessionToken: await mintBearerSession(ctx, claimed.approvedBy) };
    });
  },
};
