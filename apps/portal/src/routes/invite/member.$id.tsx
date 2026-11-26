import { createFileRoute } from '@tanstack/react-router'

import { InvitePage } from './-invite-page'

function MemberInviteRoute() {
  const { id } = Route.useParams()
  const { error } = Route.useSearch()
  return (
    <InvitePage
      inviteRef={{ case: 'memberInviteId', value: id }}
      invitePath={`/invite/member/${id}`}
      urlError={error}
    />
  )
}

export const Route = createFileRoute('/invite/member/$id')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: MemberInviteRoute,
})
