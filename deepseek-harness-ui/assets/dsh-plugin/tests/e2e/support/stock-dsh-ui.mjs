export async function openGasCityWorkspace(page, { timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
  const configureLaterButton = page.getByRole('button', { name: 'Configure later', exact: true })
  const gasCityButton = page.getByRole('button', { name: 'Gas City', exact: true })
  let lastError

  while (Date.now() < deadline) {
    if (await continueButton.isVisible()) {
      try {
        await continueButton.click({ timeout: 1_000 })
      } catch (error) {
        // Stock onboarding can replace one step between the visibility probe
        // and the click. Re-read the rendered step on the next iteration.
        lastError = error
      }
      continue
    }
    if (await configureLaterButton.isVisible()) {
      try {
        await configureLaterButton.click({ timeout: 1_000 })
      } catch (error) {
        lastError = error
        continue
      }
      // Stock DSH persists onboarding asynchronously. Treat the click as
      // complete only after the modal actually releases its pointer mask;
      // otherwise the next loop retries the visible action.
      await configureLaterButton.waitFor({ state: 'hidden', timeout: 1_000 }).catch(error => {
        lastError = error
      })
      continue
    }

    try {
      // A trial click makes Playwright prove that the stock DSH modal mask no
      // longer intercepts pointer events. It deliberately does not use force.
      await gasCityButton.click({ trial: true, timeout: 250 })
      await gasCityButton.click({ timeout: 1_000 })
      await page.getByRole('dialog', { name: 'Gas City' }).waitFor({ state: 'visible', timeout: 5_000 })
      return
    } catch (error) {
      lastError = error
    }
    await page.waitForTimeout(100)
  }

  const openDialogs = await page.getByRole('dialog').allTextContents()
  throw new Error([
    `stock DSH onboarding did not release the Gas City navigation within ${timeoutMs}ms`,
    `open dialogs: ${JSON.stringify(openDialogs)}`,
    `last actionability error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  ].join('\n'))
}
