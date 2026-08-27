import { expect, test } from '@playwright/test'

import { startOwnedStack } from './support/owned-stack.mjs'
import { openGasCityWorkspace } from './support/stock-dsh-ui.mjs'

const configuredCycles = Number.parseInt(process.env.DSH_E2E_SOAK_CYCLES ?? '3', 10)
if (!Number.isSafeInteger(configuredCycles) || configuredCycles < 1) {
  throw new Error('DSH_E2E_SOAK_CYCLES must be a positive integer')
}

let stack

test.beforeAll(async () => {
  stack = await startOwnedStack(message => process.stdout.write(`${message}\n`))
})

test.afterAll(async () => {
  await stack?.close()
})

test(`stock DSH survives ${configuredCycles} Supervisor restart and cursor-reset cycles`, async ({ page }) => {
  const browserErrors = []
  const browserRequests = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('request', request => browserRequests.push(request.url()))

  process.stdout.write(`[0/${configuredCycles}] opening the stock DSH Gas City workspace\n`)
  await page.goto(stack.url)
  await openGasCityWorkspace(page)
  await page.getByRole('button', { name: 'Local Supervisor' }).click()
  await page.getByRole('button', { name: 'demo', exact: true }).click()
  await page.getByRole('button', { name: 'Browser streaming check' }).click()
  await expect(page.getByText('Full structured streaming is live in stock DSH.')).toBeVisible()

  for (let cycle = 1; cycle <= configuredCycles; cycle += 1) {
    const streamCount = stack.fixture.requests.filter(request => request.path.endsWith('/stream')).length
    await stack.fixture.restart({
      downtimeMs: 250,
      resetMessage: `Recovered after Supervisor restart ${cycle}`,
    })
    await expect.poll(
      () => stack.fixture.requests.filter(request => request.path.endsWith('/stream')).length,
      { message: `cycle ${cycle} did not reconnect its structured stream` },
    ).toBeGreaterThan(streamCount)
    await expect(page.getByText(`Recovered after Supervisor restart ${cycle}`, { exact: true })).toBeVisible()

    await page.getByRole('textbox', { name: 'Message Browser streaming check' }).fill(`Interrupt cycle ${cycle}`)
    await page.getByRole('button', { name: 'Interrupt and send' }).click()
    await expect.poll(
      () => stack.fixture.requests.filter(request => request.path.endsWith('/submit')).length,
      { message: `cycle ${cycle} interrupt did not reach the Supervisor` },
    ).toBe(cycle)
    process.stdout.write(`[${cycle}/${configuredCycles}] restart, cursor reset, stream recovery, and interrupt passed\n`)
  }

  const submits = stack.fixture.requests.filter(request => request.path.endsWith('/submit'))
  expect(submits.map(request => request.body)).toEqual(Array.from(
    { length: configuredCycles },
    (_, index) => ({ message: `Interrupt cycle ${index + 1}`, intent: 'interrupt_now' }),
  ))
  expect(browserRequests.some(url => url.startsWith(stack.fixture.url))).toBe(false)
  expect(browserErrors.length).toBeGreaterThanOrEqual(configuredCycles)
  expect(browserErrors.filter(message => !(
    message.includes('net::ERR_INCOMPLETE_CHUNKED_ENCODING')
    || message.includes('502 (Bad Gateway)')
  ))).toEqual([])
})
