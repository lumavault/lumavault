import { createFileRoute } from '@tanstack/react-router'

import { InvitePage } from './-invite-page'

function HouseholdInviteRoute() {
  const { token } = Route.useParams()
  const { error } = Route.useSearch()
  return (
    <InvitePage
      inviteRef={{ case: 'householdInviteToken', value: token }}
      invitePath={`/invite/household/${token}`}
      urlError={error}
    />
  )
}

export const Route = createFileRoute('/invite/household/$token')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: HouseholdInviteRoute,
})
