import { expect, test } from '@playwright/test'

import { startOwnedStack } from './support/owned-stack.mjs'
import { openGasCityWorkspace } from './support/stock-dsh-ui.mjs'

let stack

test.beforeAll(async () => {
  stack = await startOwnedStack(message => process.stdout.write(`${message}\n`))
})

test.afterAll(async () => {
  await stack?.close()
})

test('stock DSH prevents accidental duplicate mutations after an unknown outcome', async ({ page }) => {
  await page.goto(stack.url)
  await openGasCityWorkspace(page)
  await page.getByRole('button', { name: 'Local Supervisor' }).click()
  await page.getByRole('button', { name: 'demo', exact: true }).click()
  await page.getByRole('button', { name: 'Browser streaming check' }).click()
  await expect(page.getByText('Full structured streaming is live in stock DSH.')).toBeVisible()

  const pending = page.getByRole('region', { name: 'Pending interactions' })
  stack.fixture.failNextMutation('respond')
  await pending.getByRole('textbox').fill('May have arrived')
  await pending.getByRole('button', { name: 'Answer' }).click()
  await expect(pending.getByRole('alert')).toContainText('Response outcome unknown')
  await expect(pending.getByRole('button', { name: 'Answer' })).toBeDisabled()
  expect(stack.fixture.requests.filter(request => request.path.endsWith('/respond'))).toHaveLength(1)

  const sessionReadsBefore = stack.fixture.requests.filter(request => request.path === '/v0/city/demo/session/session-browser-1').length
  stack.fixture.failNextMutation('submit')
  const composer = page.getByRole('textbox', { name: 'Message Browser streaming check' })
  await composer.fill('Do not submit me twice')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Submit outcome unknown' })).toContainText(
    'Inspect the authoritative transcript before retrying.',
  )
  await expect(composer).toHaveValue('Do not submit me twice')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'I checked the transcript; allow retry' })).toBeVisible()
  await expect.poll(
    () => stack.fixture.requests.filter(request => request.path === '/v0/city/demo/session/session-browser-1').length,
  ).toBeGreaterThan(sessionReadsBefore)
  expect(stack.fixture.requests.filter(request => request.path.endsWith('/submit'))).toHaveLength(1)

  await page.getByRole('button', { name: 'demo/crew' }).click()
  await page.getByRole('button', { name: 'Browser streaming check' }).click()
  const sessionReadsBeforeAcceptedSubmitUnknown = stack.fixture.requests.filter(
    request => request.path === '/v0/city/demo/session/session-browser-1',
  ).length
  stack.fixture.failNextMutation('submit-result')
  const acceptedSubmitComposer = page.getByRole('textbox', { name: 'Message Browser streaming check' })
  await acceptedSubmitComposer.fill('Accepted but submit result lost')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Submit outcome unknown' })).toContainText(
    'Inspect the authoritative transcript before retrying.',
  )
  await expect(acceptedSubmitComposer).toHaveValue('Accepted but submit result lost')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'I checked the transcript; allow retry' })).toBeVisible()
  await expect.poll(
    () => stack.fixture.requests.filter(request => request.path === '/v0/city/demo/session/session-browser-1').length,
  ).toBeGreaterThan(sessionReadsBeforeAcceptedSubmitUnknown)
  expect(stack.fixture.requests.filter(request => request.path.endsWith('/submit'))).toHaveLength(2)

  await page.getByRole('button', { name: 'demo/crew' }).click()
  await page.getByRole('button', { name: 'Browser streaming check' }).click()
  stack.fixture.failNextMutation('submit-terminal-failed')
  const ambiguouslyFailedComposer = page.getByRole('textbox', { name: 'Message Browser streaming check' })
  await ambiguouslyFailedComposer.fill('Accepted and delivered but not confirmed')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Submit outcome unknown' })).toContainText(
    'Enter delivered to tmux but not confirmed',
  )
  await expect(ambiguouslyFailedComposer).toHaveValue('Accepted and delivered but not confirmed')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'I checked the transcript; allow retry' })).toBeVisible()
  expect(stack.fixture.requests.filter(request => request.path.endsWith('/submit'))).toHaveLength(3)

  await page.getByRole('button', { name: 'demo/crew' }).click()
  stack.fixture.failNextMutation('create')
  const createComposer = page.getByRole('textbox', { name: 'Message demo/crew' })
  await createComposer.fill('Create at most once')
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Create outcome unknown' })).toContainText(
    'Session inventory refreshed; inspect sessions before retrying.',
  )
  await expect(createComposer).toHaveValue('Create at most once')
  await expect(page.getByRole('button', { name: 'Start session' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'I checked sessions; allow retry' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Created from stock DSH' })).toBeVisible()
  expect(stack.fixture.requests.filter(request => request.path === '/v0/city/demo/sessions' && request.method === 'POST')).toHaveLength(1)

  const sessionReadsBeforeAcceptedUnknown = stack.fixture.requests.filter(
    request => request.path === '/v0/city/demo/sessions' && request.method === 'GET',
  ).length
  await page.getByRole('button', { name: 'demo/cold-reviewer' }).click()
  stack.fixture.failNextMutation('create-result')
  const acceptedCreateComposer = page.getByRole('textbox', { name: 'Message demo/cold-reviewer' })
  await acceptedCreateComposer.fill('Accepted but result lost')
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Create outcome unknown' })).toContainText(
    'Session inventory refreshed; inspect sessions before retrying.',
  )
  await expect(acceptedCreateComposer).toHaveValue('Accepted but result lost')
  await expect(page.getByRole('button', { name: 'Start session' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'I checked sessions; allow retry' })).toBeVisible()
  await expect.poll(() => stack.fixture.requests.filter(
    request => request.path === '/v0/city/demo/sessions' && request.method === 'GET',
  ).length).toBeGreaterThan(sessionReadsBeforeAcceptedUnknown)
  expect(stack.fixture.requests.filter(request => request.path === '/v0/city/demo/sessions' && request.method === 'POST')).toHaveLength(2)

  await page.getByRole('button', { name: 'demo/crew' }).click()
  await page.getByRole('button', { name: 'demo/cold-reviewer' }).click()
  stack.fixture.failNextMutation('create-terminal-failed')
  const ambiguouslyFailedCreateComposer = page.getByRole('textbox', { name: 'Message demo/cold-reviewer' })
  await ambiguouslyFailedCreateComposer.fill('Created but commandability was not confirmed')
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Create outcome unknown' })).toContainText(
    'session did not become commandable after creation',
  )
  await expect(ambiguouslyFailedCreateComposer).toHaveValue('Created but commandability was not confirmed')
  await expect(page.getByRole('button', { name: 'Start session' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'I checked sessions; allow retry' })).toBeVisible()
  expect(stack.fixture.requests.filter(request => request.path === '/v0/city/demo/sessions' && request.method === 'POST')).toHaveLength(3)
})
