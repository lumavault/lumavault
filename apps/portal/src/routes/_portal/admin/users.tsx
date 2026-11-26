import * as React from 'react'
import { IamService } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { Alert, AlertDescription } from '@lumavault/ui/components/ui/alert'
import { Badge } from '@lumavault/ui/components/ui/badge'
import { Button } from '@lumavault/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@lumavault/ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@lumavault/ui/components/ui/empty'
import { Input } from '@lumavault/ui/components/ui/input'
import { Skeleton } from '@lumavault/ui/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lumavault/ui/components/ui/table'
import { useQuery } from '@lumavault/ui/rpc'
import { createFileRoute } from '@tanstack/react-router'
import {
  CursorPagination,
  useCursorPagination,
} from '#/components/cursor-pagination'
import { formatDate, rpcErrorMessage } from '#/lib/format'
import { AlertCircleIcon, SearchIcon, UsersIcon } from 'lucide-react'

const PAGE_SIZE = 20

function AdminUsersPage() {
  const [searchInput, setSearchInput] = React.useState('')
  const [submittedQuery, setSubmittedQuery] = React.useState('')
  const pagination = useCursorPagination()

  const usersQuery = useQuery(IamService.method.listUsers, {
    query: submittedQuery,
    pageSize: PAGE_SIZE,
    pageToken: pagination.pageToken,
  })

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmittedQuery(searchInput.trim())
    pagination.reset()
  }

  function handleClearSearch() {
    setSearchInput('')
    setSubmittedQuery('')
    pagination.reset()
  }

  const users = usersQuery.data?.users ?? []
  const nextPageToken = usersQuery.data?.nextPageToken ?? ''

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Browse and search all accounts on this LumaVault server.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>
            Filter accounts by name or email address.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-wrap items-center gap-2"
          >
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search users"
              className="max-w-sm"
            />
            <Button type="submit" variant="outline">
              <SearchIcon data-icon="inline-start" />
              Search
            </Button>
            {submittedQuery ? (
              <Button type="button" variant="ghost" onClick={handleClearSearch}>
                Clear
              </Button>
            ) : null}
          </form>

          {usersQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : usersQuery.error ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>
                {rpcErrorMessage(usersQuery.error, 'Could not load users.')}
              </AlertDescription>
            </Alert>
          ) : users.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>No matching users</EmptyTitle>
                <EmptyDescription>
                  {submittedQuery
                    ? `No accounts matched "${submittedQuery}".`
                    : 'No user accounts exist yet.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        {user.isSuperAdmin ? (
                          <Badge>Super-Admin</Badge>
                        ) : (
                          <Badge variant="secondary">User</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <CursorPagination
                hasPrevious={pagination.hasPrevious}
                nextPageToken={nextPageToken}
                onPrevious={pagination.goPrevious}
                onNext={pagination.goNext}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_portal/admin/users')({
  component: AdminUsersPage,
})
