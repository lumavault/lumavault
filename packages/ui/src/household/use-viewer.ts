import { Code, ConnectError } from '@connectrpc/connect'
import { createConnectQueryKey, useQuery } from '@connectrpc/connect-query'
import {
  App,
  IamService,
  Role,
  type GetViewerResponse,
  type Household,
  type Usage,
  type User,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'

export function viewerQueryKey() {
  return createConnectQueryKey({
    schema: IamService.method.getViewer,
    cardinality: 'finite',
  })
}

export function isAdminRole(role: Role): boolean {
  return role === Role.OWNER || role === Role.ADMIN
}

export function hasEnabledApp(enabledApps: readonly App[], app: App): boolean {
  return enabledApps.includes(app)
}

export function roleLabel(role: Role): string {
  switch (role) {
    case Role.OWNER:
      return 'Owner'
    case Role.ADMIN:
      return 'Admin'
    case Role.MEMBER:
      return 'Member'
    default:
      return 'Unknown'
  }
}

export function appLabel(app: App): string {
  switch (app) {
    case App.PHOTOS:
      return 'Photos'
    case App.CINEMA:
      return 'Cinema'
    case App.ARCADE:
      return 'Arcade'
    default:
      return 'Unknown'
  }
}

export interface UseViewerOptions {
  enabled?: boolean
}

export interface ViewerState {
  data: GetViewerResponse | undefined
  user: User | undefined
  household: Household | undefined
  role: Role
  usage: Usage | undefined
  enabledApps: readonly App[]
  isAuthenticated: boolean
  hasHousehold: boolean
  isSuperAdmin: boolean
  isHouseholdOwner: boolean
  isHouseholdAdmin: boolean
  isPending: boolean
  isLoading: boolean
  isFetching: boolean
  error: ConnectError | null
  refetch: () => Promise<unknown>
}

export function useViewer(options?: UseViewerOptions): ViewerState {
  const query = useQuery(IamService.method.getViewer, undefined, {
    enabled: options?.enabled ?? true,
    retry: false,
  })

  const isUnauthenticated =
    query.error instanceof ConnectError &&
    query.error.code === Code.Unauthenticated

  const data = isUnauthenticated ? undefined : query.data
  const user = data?.user
  const household = data?.household
  const role = data?.role ?? Role.UNSPECIFIED
  const usage = data?.usage
  const enabledApps = household?.allowance?.enabledApps ?? []

  return {
    data,
    user,
    household,
    role,
    usage,
    enabledApps,
    isAuthenticated: Boolean(user),
    hasHousehold: Boolean(household),
    isSuperAdmin: Boolean(user?.isSuperAdmin),
    isHouseholdOwner: role === Role.OWNER,
    isHouseholdAdmin: isAdminRole(role),
    isPending: query.isPending,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: isUnauthenticated ? null : (query.error ?? null),
    refetch: query.refetch,
  }
}
