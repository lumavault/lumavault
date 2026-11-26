import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import {
  IamService,
  PairingStatus,
} from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { expect, test } from '@playwright/test'

import { clearMailpit, waitForEmailLink } from './mailpit'

const API_URL = (process.env.E2E_API_URL ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
)
const OWNER_EMAIL = 'owner@example.com'
const OWNER_PASSWORD = 'owner-password-1234'
const SECOND_HOUSEHOLD_EMAIL = 'friend@example.com'
const SECOND_HOUSEHOLD_PASSWORD = 'friend-password-1234'
const MEMBER_EMAIL = 'member@example.com'
const MEMBER_PASSWORD = 'member-password-1234'

function createIamClient() {
  return createClient(
    IamService,
    createConnectTransport({ baseUrl: `${API_URL}/api/rpc` }),
  )
}

test.describe.serial('LumaVault Portal end-to-end', () => {
  test('completes first-run setup and signs in with password, magic link, and passkey', async ({
    page,
    context,
  }) => {
    await clearMailpit()

    // 1. Fresh install redirects to /setup.
    await page.goto('/')
    await expect(page).toHaveURL(/\/setup$/)

    await page.getByLabel('Your name').fill('Server Owner')
    await page.getByLabel('Email').fill(OWNER_EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(OWNER_PASSWORD)
    await page.getByLabel('Confirm password').fill(OWNER_PASSWORD)
    await page.getByLabel('Household name').fill('Owner Home')
    await page.getByRole('button', { name: 'Complete setup' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('heading', { name: 'Owner Home' }),
    ).toBeVisible()

    // 2. Register a passkey via Chromium virtual WebAuthn authenticator.
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    })

    await page.goto('/account')
    await page.getByLabel('Device label (optional)').fill('Playwright Key')
    await page.getByRole('button', { name: 'Add passkey' }).click()
    await expect(page.getByText('Playwright Key')).toBeVisible()

    // 3. Sign out and sign back in with passkey.
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)

    await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('heading', { name: 'Owner Home' }),
    ).toBeVisible()

    // 4. Sign out and sign back in with password.
    await page.goto('/account')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)

    await page.getByLabel('Email').fill(OWNER_EMAIL)
    await page.locator('#login-password').fill(OWNER_PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)

    // 5. Sign out and sign back in with magic link fetched from Mailpit.
    await page.goto('/account')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)

    await page.getByRole('tab', { name: 'Magic link' }).click()
    await page.locator('#magic-email').fill(OWNER_EMAIL)
    await page.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(page.getByText('Check your email')).toBeVisible()

    const magicUrl = await waitForEmailLink(
      OWNER_EMAIL,
      /http:\/\/localhost:\d+\/api\/auth\/magic-link\/verify\?[^\s"<>]+/,
    )
    await page.goto(magicUrl)
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('heading', { name: 'Owner Home' }),
    ).toBeVisible()
  })

  test('Super-Admin creates a household invite, invitee redeems it, and Super-Admin updates allowance', async ({
    browser,
    page,
  }) => {
    await clearMailpit()

    // Sign in as Super-Admin.
    await page.goto('/login')
    await page.getByLabel('Email').fill(OWNER_EMAIL)
    await page.locator('#login-password').fill(OWNER_PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)

    // Create household creation invite.
    await page.goto('/admin/invites')
    await page.getByRole('button', { name: 'New household invite' }).click()
    await page.locator('#invite-create-email').fill(SECOND_HOUSEHOLD_EMAIL)
    await page.locator('#invite-note').fill('E2E Friend')
    await page.getByRole('button', { name: 'Create invite' }).click()

    const inviteUrl = await page
      .getByLabel('One-time household invite link')
      .inputValue()
    expect(inviteUrl).toContain('/invite/household/')

    // Redeem in a clean browser context.
    const friendContext = await browser.newContext()
    const friendPage = await friendContext.newPage()
    await friendPage.goto(inviteUrl)
    await expect(friendPage.getByText('Create your household')).toBeVisible()

    await friendPage.locator('#invite-name').fill('Friend Owner')
    await friendPage.locator('#invite-password').fill(SECOND_HOUSEHOLD_PASSWORD)
    await friendPage
      .getByRole('button', { name: 'Create account and continue' })
      .click()

    await friendPage.locator('#join-household-name').fill('Friend Home')
    await friendPage.getByRole('button', { name: 'Create household' }).click()
    await expect(friendPage).toHaveURL(/\/$/)
    await expect(
      friendPage.getByRole('heading', { name: 'Friend Home' }),
    ).toBeVisible()
    await friendContext.close()

    // Super-Admin edits Friend Home's member limit and searches users.
    await page.goto('/admin/households')
    const row = page.locator('tr', { hasText: 'Friend Home' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Edit allowance' }).click()
    await page.locator('#edit-member-limit').fill('6')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(row).toContainText('1 / 6')

    await page.goto('/admin/users')
    await page.getByLabel('Search users').fill('friend@example.com')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText('Friend Owner')).toBeVisible()
  })

  test('household invite auto-joins member, supports role update, ownership transfer, and Apple TV pairing', async ({
    browser,
    page,
  }) => {
    await clearMailpit()

    // Sign in as Friend Owner.
    await page.goto('/login')
    await page.getByLabel('Email').fill(SECOND_HOUSEHOLD_EMAIL)
    await page.locator('#login-password').fill(SECOND_HOUSEHOLD_PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)

    // Invite a member.
    await page.goto('/household')
    await page.locator('#member-invite-email').fill(MEMBER_EMAIL)
    await page.getByRole('button', { name: 'Send invite' }).click()

    const memberInviteUrl = await page
      .getByLabel('Member invite link')
      .inputValue()
    expect(memberInviteUrl).toContain('/invite/member/')

    // Member signs up in a fresh context and joins automatically.
    const memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()
    await memberPage.goto(memberInviteUrl)
    await expect(memberPage.getByText('Join Friend Home')).toBeVisible()
    await memberPage.locator('#invite-name').fill('Household Member')
    await memberPage.locator('#invite-password').fill(MEMBER_PASSWORD)
    await memberPage
      .getByRole('button', { name: 'Create account and continue' })
      .click()
    await expect(memberPage).toHaveURL(/\/$/)
    await expect(
      memberPage.getByRole('heading', { name: 'Friend Home' }),
    ).toBeVisible()
    await memberContext.close()

    // Reload /household, promote member to Admin, then transfer ownership.
    await page.reload()
    const memberRow = page.locator('tr', { hasText: 'Household Member' })
    await expect(memberRow).toBeVisible()

    const roleSelect = memberRow.getByLabel('Role for Household Member')
    await expect(roleSelect).toContainText('Member')
    await roleSelect.click()
    await page.getByRole('option', { name: 'Admin' }).click()
    await expect(roleSelect).toContainText('Admin')

    await memberRow.getByRole('button', { name: 'Make Owner' }).click()
    await page.getByRole('button', { name: 'Transfer ownership' }).click()
    await expect(page.getByRole('button', { name: 'Make Owner' })).toHaveCount(
      0,
    )

    // Apple TV pairing: StartPairing -> /pair approve -> PollPairing returns session token.
    const iam = createIamClient()
    const started = await iam.startPairing({ deviceName: 'Living Room TV' })

    await page.goto('/pair')
    await page.getByLabel('Pairing code').fill(started.code)
    await page.getByRole('button', { name: 'Approve Apple TV' }).click()
    await expect(page.getByText('TV signed in')).toBeVisible()
    await expect(page.getByText(/Living Room TV/)).toBeVisible()

    const polled = await iam.pollPairing({
      pairingId: started.pairingId,
      deviceSecret: started.deviceSecret,
    })
    expect(polled.status).toBe(PairingStatus.APPROVED)
    expect(polled.sessionToken.length).toBeGreaterThan(0)
  })
})
