import { expect, test } from '@playwright/test'

import { startOwnedStack } from './support/owned-stack.mjs'

let stack

test.beforeAll(async () => {
  stack = await startOwnedStack(message => process.stdout.write(`${message}\n`))
})

test.afterAll(async () => {
  await stack?.close()
})

test('stock DSH renders and controls the provider-neutral Supervisor workspace', async ({ page }) => {
  const browserErrors = []
  const browserRequests = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('request', request => browserRequests.push(request.url()))

  await page.goto(stack.url)
  const testingNotice = page.getByRole('button', { name: 'Continue' })
  if (await testingNotice.isVisible()) {
    await testingNotice.click()
    await page.getByRole('button', { name: 'Configure later' }).waitFor({ state: 'visible', timeout: 5_000 })
  }
  const configureLater = page.getByRole('button', { name: 'Configure later' })
  if (await configureLater.isVisible()) await configureLater.click()
  await page.getByRole('button', { name: 'Gas City' }).click()
  await expect(page.getByRole('dialog', { name: 'Gas City' })).toBeVisible()
  await page.getByRole('button', { name: 'Local Supervisor' }).click()
  await page.getByRole('button', { name: 'demo', exact: true }).click()
  await expect(page.getByText('Loaded 1 of 2 sessions')).toBeVisible()
  await page.getByRole('button', { name: 'Load more sessions' }).click()
  await expect(page.getByText('Loaded 2 of 2 sessions')).toBeVisible()

  await page.getByRole('button', { name: 'Browser streaming check' }).click()
  await expect(page.getByText('Full structured streaming is live in stock DSH.')).toBeVisible()
  await expect(page.getByText('Supervisor fixture healthy')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tool call Status' })).toBeVisible()
  await expect(page.getByText('Unsupported content')).toHaveCount(0)
  await expect(page.getByText('Tracing the Supervisor stream')).toHaveCount(0)
  await expect(page.getByText('Transcript reset: cursor_invalidated')).toBeVisible()
  await expect.poll(() => stack.fixture.requests.filter(request => request.path.endsWith('/stream')).length).toBeGreaterThanOrEqual(2)
  const resumedStream = stack.fixture.requests.filter(request => request.path.endsWith('/stream'))[1]
  expect(resumedStream.lastEventId).toBeUndefined()
  expect(new URLSearchParams(resumedStream.search).get('after_cursor')).toBe('st1.session-browser-1.start.false')
  await page.getByRole('checkbox', { name: 'Show reasoning' }).check()
  await expect(page.getByText('Tracing the Supervisor stream')).toHaveCount(1)
  await page.getByText('Reasoning', { exact: true }).click()
  await expect(page.getByText('Tracing the Supervisor stream')).toBeVisible()

  const pending = page.getByRole('region', { name: 'Pending interactions' })
  await pending.getByRole('textbox').fill('Continue')
  await pending.getByRole('button', { name: 'Answer' }).click()
  await pending.getByRole('button', { name: 'Approve and accept edits' }).click()
  await pending.getByRole('combobox', { name: 'Choice' }).selectOption('Safe')
  await pending.getByRole('button', { name: 'Answer' }).click()
  await expect(pending).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Message Browser streaming check' }).fill('Run the release check')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Submitted')).toBeVisible()
  await page.getByRole('textbox', { name: 'Message Browser streaming check' }).fill('Queue this after the turn')
  await page.getByRole('button', { name: 'Follow up' }).click()
  await expect.poll(() => stack.fixture.requests.filter(request => request.path.endsWith('/submit')).length).toBe(2)
  await page.getByRole('textbox', { name: 'Message Browser streaming check' }).fill('Interrupt with this message')
  await page.getByRole('button', { name: 'Interrupt and send' }).click()
  await expect.poll(() => stack.fixture.requests.filter(request => request.path.endsWith('/submit')).length).toBe(3)

  await page.getByRole('button', { name: 'Rename session' }).click()
  await page.getByRole('textbox', { name: 'New session title' }).fill('Renamed in stock DSH')
  await page.getByRole('button', { name: 'Save title' }).click()
  await expect(page.getByRole('heading', { name: 'Renamed in stock DSH' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Renamed in stock DSH' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Suspend' }).click()
  await expect(page.getByText('Session suspended')).toBeVisible()

  await page.getByRole('button', { name: 'Dormant settings check' }).click()
  const permissionMode = page.getByRole('combobox', { name: 'Permission mode' })
  await expect(permissionMode).toBeEnabled()
  await permissionMode.selectOption('auto-edit')
  await page.getByRole('button', { name: 'Apply permission mode' }).click()
  await expect(page.getByText('Permission mode updated; it applies on the next launch')).toBeVisible()

  await page.getByRole('button', { name: 'demo/crew' }).click()
  await page.getByRole('textbox', { name: 'Message demo/crew' }).fill('Create exactly once')
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('heading', { name: 'Created from stock DSH' })).toBeVisible()
  await expect(page.locator('main.gc-session')).toHaveAttribute('data-session-id', 'session-created-browser')
  await expect(page.getByText('Created session attached to its own Supervisor stream.')).toBeVisible()

  expect(stack.fixture.requests.filter(request => request.path.endsWith('/submit')).map(request => request.body)).toEqual([
    { message: 'Run the release check' },
    { message: 'Queue this after the turn', intent: 'follow_up' },
    { message: 'Interrupt with this message', intent: 'interrupt_now' },
  ])
  expect(stack.fixture.requests.filter(request => request.path.endsWith('/respond')).map(request => request.body)).toEqual([
    { request_id: 'browser-question-1', action: 'answer', text: 'Continue' },
    { request_id: 'browser-approval-1', action: 'approve_accept_edits' },
    { request_id: 'browser-choice-1', action: 'answer', text: 'Safe' },
  ])
  expect(stack.fixture.requests.find(request => request.path.endsWith('/rename'))?.body).toEqual({
    title: 'Renamed in stock DSH',
  })
  expect(stack.fixture.requests.find(request => request.path.endsWith('/permission-mode'))?.body).toEqual({
    permission_mode: 'auto-edit',
  })
  expect(stack.fixture.requests.find(request => request.path === '/v0/city/demo/sessions' && request.method === 'POST')?.body).toEqual({
    kind: 'agent', name: 'demo/crew', message: 'Create exactly once', async: true,
  })
  expect(browserRequests.some(url => url.startsWith(stack.fixture.url))).toBe(false)
  expect(browserErrors).toEqual([])
})
