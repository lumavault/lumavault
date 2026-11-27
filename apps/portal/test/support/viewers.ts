import { create } from '@bufbuild/protobuf'
import {
  App,
  GetViewerResponseSchema,
  Role,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { MAX_STORAGE_CAP_BYTES } from '@lumavault/ui/lib/format-bytes'

export function superAdminViewer(memberLimit = 4) {
  return create(GetViewerResponseSchema, {
    user: {
      id: 'admin-1',
      name: 'Server Owner',
      email: 'admin@example.com',
      isSuperAdmin: true,
    },
    household: {
      id: 'house-admin',
      name: 'Owner Home',
      ownerUserId: 'admin-1',
      allowance: {
        storageCapBytes: MAX_STORAGE_CAP_BYTES,
        enabledApps: [App.PHOTOS, App.CINEMA, App.ARCADE],
        memberLimit,
      },
    },
    role: Role.OWNER,
    usage: {
      usedBytes: 10n * 1024n ** 3n,
      reservedBytes: 0n,
      remainingBytes: MAX_STORAGE_CAP_BYTES - 10n * 1024n ** 3n,
    },
  })
}
