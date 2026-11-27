// Starts a real Go Storage Gateway with ticket checks on, for API tests. Never imported by the server.
import {
  startTestGateway as launchGateway,
  type TestGateway,
} from '@lumavault/test-gateway'

import { TEST_ENV } from './context.js'

export type { TestGateway }

/** Builds core/cmd/lumavault and runs it with the same ticket secret and service key as TEST_ENV. */
export function startTestGateway(): Promise<TestGateway> {
  return launchGateway({
    ticketSecret: TEST_ENV.LUMAVAULT_TICKET_SECRET,
    serviceKey: TEST_ENV.LUMAVAULT_SERVICE_KEY,
  })
}
