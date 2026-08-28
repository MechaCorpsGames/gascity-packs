import { expect, test } from '@playwright/test'

import { startOwnedSshStack } from './support/owned-stack.mjs'
import { openGasCityWorkspace } from './support/stock-dsh-ui.mjs'

let stack

test.beforeAll(async () => {
  stack = await startOwnedSshStack(message => process.stdout.write(`${message}\n`))
})

test.afterAll(async () => {
  await stack?.close()
})

test('stock DSH renders the Gas City workspace through an SSH-style local port forward', async ({ page }) => {
  const browserErrors = []
  const browserRequests = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('request', request => browserRequests.push(request.url()))

  expect(new URL(stack.url).port).not.toBe(new URL(stack.dshUrl).port)
  await page.goto(stack.url)
  await openGasCityWorkspace(page)
  await expect(page.getByRole('dialog', { name: 'Gas City' })).toBeVisible()
  await page.getByRole('button', { name: 'Local Supervisor' }).click()
  await page.getByRole('button', { name: 'demo', exact: true }).click()
  await page.getByRole('button', { name: 'Browser streaming check' }).click()
  await expect(page.getByText('Full structured streaming is live in stock DSH.')).toBeVisible()

  expect(stack.dshOutput()).not.toContain('opening the default browser')
  expect(browserRequests.some(url => url.startsWith(stack.fixture.url))).toBe(false)
  expect(browserErrors).toEqual([])
})
