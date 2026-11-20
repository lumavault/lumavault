import { randomInt } from "node:crypto";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { IamService, PairingStatus } from "@lumavault/sdk/gen/lumavault/iam/v1/iam_pb";
import { mintBearerSession } from "#/auth/server-helpers.js";
import { createPairingRequest } from "#/data/iam/pairing-request/create-pairing-request.js";
import { getPairingRequest } from "#/data/iam/pairing-request/get-pairing-request.js";
import {
  approvePairingRequestByCode,
  claimApprovedPairingRequest,
  recordFailedPairingAttempt,
} from "#/data/iam/pairing-request/update-pairing-request.js";
import { isUniqueViolation } from "#/db/errors.js";
import { requireHouseholdMember } from "#/guards.js";
import {
  PAIRING_APPROVALS_PER_WINDOW,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_MAX_FAILED_ATTEMPTS,
  PAIRING_POLL_INTERVAL_SECONDS,
  PAIRING_POLLS_PER_WINDOW,
  PAIRING_RATE_WINDOW_MS,
  PAIRING_STARTS_PER_WINDOW,
  PAIRING_TTL_MS,
} from "#/iam/constants.js";
import { RateLimiter } from "#/iam/rate-limit.js";
import { hashSecret, newSecret } from "#/iam/secrets.js";
import type { ApiModule } from "#/modules.js";
import { clientIpKey } from "#/request.js";
import { required } from "./convert.js";

// A collision with another pending code is retried this many times before giving up.
const CODE_ATTEMPTS = 5;

export function newPairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
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

    // Called by the Apple TV without a session.
    router.rpc(IamService.method.startPairing, async (req, call) => {
      const ip = call.values.get(clientIpKey);
      if (!starts.allow(ip)) throw tooMany();
      const deviceName = required(req.deviceName, "device_name").slice(0, 100);
      const deviceSecret = newSecret();
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
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
          if (!isUniqueViolation(err)) throw err;
        }
      }
      throw new ConnectError("could not pick a free pairing code", Code.Unavailable);
    });

    // Called by a signed-in household member on their phone. The Apple TV opens in their household.
    router.rpc(IamService.method.approvePairing, async (req, call) => {
      const { viewer, household } = await requireHouseholdMember(call, ctx);
      if (!approvals.allow(viewer.userId)) throw tooMany();
      const code = required(req.code, "code").toUpperCase().replace(/[\s-]/g, "");
      const approved = await approvePairingRequestByCode(
        ctx.db,
        code,
        { userId: viewer.userId, householdId: household.householdId },
        new Date(),
      );
      if (!approved) {
        throw new ConnectError("that code is wrong or expired", Code.NotFound);
      }
      return { deviceName: approved.deviceName };
    });

    // Polled by the Apple TV. The session token comes back on exactly one poll.
    router.rpc(IamService.method.pollPairing, async (req, call) => {
      if (!polls.allow(call.values.get(clientIpKey))) throw tooMany();
      const pairing = await getPairingRequest(ctx.db, required(req.pairingId, "pairing_id"));
      if (!pairing) {
        throw new ConnectError("no such pairing", Code.NotFound);
      }
      if (hashSecret(req.deviceSecret) !== pairing.deviceSecretHash) {
        // Guessing secrets burns the pairing after a few tries.
        await recordFailedPairingAttempt(ctx.db, pairing.id, PAIRING_MAX_FAILED_ATTEMPTS);
        throw new ConnectError("wrong device secret", Code.PermissionDenied);
      }
      if (pairing.status === "pending") {
        return { status: pairing.expiresAt > new Date() ? PairingStatus.PENDING : PairingStatus.EXPIRED };
      }
      if (pairing.status !== "approved") {
        return { status: PairingStatus.EXPIRED };
      }
      // Claim first, so two polls racing cannot both get a session.
      const claimed = await claimApprovedPairingRequest(ctx.db, pairing.id, new Date());
      if (!claimed?.approvedBy || !claimed.householdId) {
        return { status: PairingStatus.EXPIRED };
      }
      const sessionToken = await mintBearerSession(ctx, claimed.approvedBy);
      return { status: PairingStatus.APPROVED, sessionToken };
    });
  },
};
