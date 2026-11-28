import { EmptyState } from '@lumavault/ui/components/ui/custom/empty-state'
import { HomeIcon } from 'lucide-react'

export interface NoHouseholdStateProps {
  title?: string
  description?: string
}

export function NoHouseholdState({
  title = 'No household yet',
  description = 'Ask a household Admin or the server owner for an invite link to join or create a household.',
}: NoHouseholdStateProps) {
  return (
    <EmptyState icon={<HomeIcon />} title={title} description={description} />
  )
}
