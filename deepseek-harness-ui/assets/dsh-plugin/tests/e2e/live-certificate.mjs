import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  closeRunOwnedSessions,
  newCompletedToolCallIds,
  sessionEvidence,
  waitForCreatedSession,
} from './support/live-evidence.mjs'
import {
  isBrowserHttpConsoleNoise,
  isExpectedClosedSessionNotFound,
} from './support/browser-diagnostics.mjs'
import { CleanupStack } from './support/owned-process.mjs'
import { startOwnedLiveStack } from './support/owned-stack.mjs'
import { openGasCityWorkspace } from './support/stock-dsh-ui.mjs'

const required = ['DSH_E2E_ALLOW_MUTATION', 'GC_LIVE_CITY', 'GC_LIVE_AGENT_MATRIX']
const missing = required.filter(name => process.env[name] === undefined || process.env[name] === '')
if (process.env.DSH_E2E_ALLOW_MUTATION !== '1' || missing.length > 0) {
  process.stderr.write(`UNPROVEN: live multi-provider certification requires ${required.join(', ')}\n`)
  process.exit(2)
}

let matrix
try {
  matrix = JSON.parse(process.env.GC_LIVE_AGENT_MATRIX)
} catch {
  process.stderr.write('UNPROVEN: GC_LIVE_AGENT_MATRIX must be JSON mapping agent names to provider identities\n')
  process.exit(2)
}
if (matrix === null || Array.isArray(matrix) || typeof matrix !== 'object') {
  process.stderr.write('UNPROVEN: GC_LIVE_AGENT_MATRIX must be a JSON object\n')
  process.exit(2)
}
const entries = Object.entries(matrix)
if (entries.some(([agent, provider]) => agent === '' || typeof provider !== 'string' || provider === '')) {
  process.stderr.write('UNPROVEN: every live agent and provider identity must be a nonempty string\n')
  process.exit(2)
}
if (entries.length < 2 || new Set(entries.map(([, provider]) => provider)).size < 2) {
  process.stderr.write('UNPROVEN: provide at least two agents backed by two distinct providers\n')
  process.exit(2)
}

const city = process.env.GC_LIVE_CITY
const connectionLabel = process.env.GC_LIVE_CONNECTION_LABEL ?? 'Local Supervisor'
const certificateOutput = resolve(process.env.GC_LIVE_CERTIFICATE ?? 'test-results/live-certificate.json')
const gcHome = resolve(process.env.GC_HOME ?? join(homedir(), '.gc'))
const startedAt = new Date().toISOString()
const createdSessions = []
const certifiedSessions = []
const resources = new CleanupStack()
let browser
let page
let stack
let connection
let browserVersion
let supervisorHealth
let browserErrors = []
let browserRequestFailures = []
let browserHttpFailures = []
let browserResponses = []
let browserStreamCancellations = 0
let browserFailureState
let remainingSessionIds = []
const closedSessionUrls = new Set()
const interruptController = new AbortController()
let interruptedSignal
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (interruptController.signal.aborted) return
    interruptedSignal = signal
    interruptController.abort(new Error(`interrupted by ${signal}`))
    void browser?.close().catch(() => {})
  })
}

function pathPart(value) {
  return encodeURIComponent(value)
}

function sessionBase(sessionId) {
  return `/api/gas-city/v1/connections/${pathPart(connection.id)}/city/${pathPart(city)}/session/${pathPart(sessionId)}`
}

async function gatewayJson(path, options = {}) {
  const { allowNotFound = false, label, timeoutMs, ...requestOptions } = options
  const response = await fetch(new URL(path, stack.url), {
    ...requestOptions,
    headers: {
      Accept: 'application/json',
      Origin: stack.url,
      'Sec-Fetch-Site': 'same-origin',
      ...options.headers,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs ?? 15_000),
  })
  if (allowNotFound && response.status === 404) return undefined
  if (!response.ok) throw new Error(`${label ?? path} returned HTTP ${response.status}`)
  if (response.status === 204) return undefined
  return await response.json()
}

async function readSession(sessionId) {
  return await gatewayJson(sessionBase(sessionId), {
    label: `session ${sessionId}`,
    allowNotFound: true,
  }) ?? { id: sessionId, state: 'closed', running: false }
}

async function readTranscript(sessionId) {
  return await gatewayJson(`${sessionBase(sessionId)}/transcript?format=structured&include_thinking=true&tail=500`, {
    label: `transcript ${sessionId}`,
  })
}

async function waitForEvidence(sessionId, expectedTemplate, expectedProvider, nonce, predicate = () => true) {
  const deadline = Date.now() + 180_000
  let lastError
  while (Date.now() < deadline) {
    if (interruptController.signal.aborted) throw interruptController.signal.reason
    try {
      const [session, transcript] = await Promise.all([readSession(sessionId), readTranscript(sessionId)])
      const evidence = sessionEvidence(session, transcript, { expectedTemplate, expectedProvider, nonce })
      if (predicate(evidence)) return evidence
      lastError = new Error('authoritative transcript has not reached the required tool delta')
    } catch (error) {
      lastError = error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1_000))
  }
  throw new Error(`timed out waiting for authoritative provider evidence: ${lastError?.message ?? 'no evidence'}`)
}

async function waitForClosed(sessionId) {
  const deadline = Date.now() + 30_000
  let last
  while (Date.now() < deadline) {
    last = await readSession(sessionId)
    if (last?.state === 'closed') return last
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  }
  throw new Error(`${sessionId} remained ${last?.state ?? '<missing>'} after close`)
}

async function waitForSubmissionOutcome(sessionWorkspace, prompt) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (interruptController.signal.aborted) throw interruptController.signal.reason
    const submitted = await sessionWorkspace.locator('[aria-label="Submission status"] strong').allInnerTexts()
    if (submitted.includes('Submitted')) return { kind: 'succeeded', detail: 'Submitted' }
    const alerts = await sessionWorkspace.getByRole('alert').allInnerTexts()
    const unknown = alerts.find(message => message.includes('Submit outcome unknown'))
    if (unknown !== undefined) {
      const composer = sessionWorkspace.getByRole('textbox', { name: /Message / })
      if (await composer.inputValue() !== prompt) throw new Error('outcome-unknown submit did not preserve its prompt')
      if (!await sessionWorkspace.getByRole('button', { name: 'Send', exact: true }).isDisabled()) {
        throw new Error('outcome-unknown submit left retry enabled')
      }
      if (await sessionWorkspace.getByRole('button', { name: 'I checked the transcript; allow retry' }).count() !== 1) {
        throw new Error('outcome-unknown submit did not require authoritative transcript acknowledgment')
      }
      return { kind: 'outcome_unknown', detail: unknown }
    }
    const failed = alerts.find(message => message.includes('Submission failed'))
    if (failed !== undefined) throw new Error(`live submission was presented as safely retryable: ${failed}`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
  }
  const statuses = await sessionWorkspace.locator('[aria-label="Submission status"] strong').allInnerTexts()
  throw new Error(`live submission outcome was not observed; current statuses: ${JSON.stringify(statuses)}`)
}

async function writeCertificate(result, error) {
  const certificate = {
    schema_version: 'gastownhall.deepseek-harness-ui.live-certificate.v1',
    result,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    artifact_sha256: stack?.artifactSha,
    dsh_version: stack?.dshVersion,
    browser_version: browserVersion,
    supervisor: supervisorHealth === undefined ? undefined : {
      version: supervisorHealth.version,
      build_id: supervisorHealth.build_id,
    },
    fixture: {
      city_created_by: 'gc init',
      beads_provider: process.env.GC_LIVE_BEADS_PROVIDER,
    },
    city,
    sessions: certifiedSessions,
    browser_diagnostics: {
      errors: browserErrors,
      http_failures: browserHttpFailures,
      request_failures: browserRequestFailures,
      expected_stream_cancellations: browserStreamCancellations,
      responses: browserResponses,
      ...(browserFailureState === undefined ? {} : { failure_state: browserFailureState }),
    },
    cleanup_remaining_session_ids: remainingSessionIds,
    ...(error === undefined ? {} : { failure: error instanceof Error ? error.message : String(error) }),
  }
  await mkdir(dirname(certificateOutput), { recursive: true })
  await writeFile(certificateOutput, `${JSON.stringify(certificate, null, 2)}\n`)
}

async function captureBrowserFailure(error) {
  if (page === undefined || browserFailureState !== undefined) return
  const failureScreenshot = resolve(dirname(certificateOutput), 'live-browser-failure.png')
  await mkdir(dirname(failureScreenshot), { recursive: true })
  await page.screenshot({ path: failureScreenshot, fullPage: true })
  browserFailureState = {
    error: error instanceof Error ? error.message : String(error),
    url: page.url(),
    visible_text: (await page.locator('body').innerText()).slice(0, 8_000),
    submission_statuses: await page.locator('[aria-label="Submission status"] strong').allInnerTexts(),
    screenshot: failureScreenshot,
  }
}

let operationError
try {
  stack = await startOwnedLiveStack({
    gcHome,
    progress: message => process.stdout.write(`${message}\n`),
  })
  resources.defer('isolated stock DSH stack', () => stack.close())
  connection = stack.inventory.connections.find(candidate => candidate.label === connectionLabel)
  if (connection === undefined || connection.available !== true) {
    throw new Error(`live connection ${connectionLabel} is not available through the installed gateway`)
  }
  const cityBase = `/api/gas-city/v1/connections/${pathPart(connection.id)}/city/${pathPart(city)}`
  const [health, agents] = await Promise.all([
    gatewayJson(`/api/gas-city/v1/connections/${pathPart(connection.id)}/health`, { label: 'Supervisor health' }),
    gatewayJson(`${cityBase}/agents`, { label: 'configured agent inventory' }),
  ])
  supervisorHealth = health
  for (const [agentName, expectedProvider] of entries) {
    const authoritativeAgent = agents.items?.find(agent => agent.name === agentName)
    if (authoritativeAgent?.available !== true || authoritativeAgent.provider !== expectedProvider) {
      throw new Error(`agent ${agentName} is not ready with authoritative provider ${expectedProvider}`)
    }
  }

  browser = await chromium.launch({
    headless: true,
    ...(process.env.CI === 'true' ? {} : { channel: 'chrome' }),
  })
  browserVersion = browser.version()
  resources.defer('live certificate browser', () => browser.close())
  resources.defer('run-owned live sessions', async () => {
    const cleanup = await closeRunOwnedSessions(createdSessions, {
      getSession: readSession,
      async closeSession(id) {
        await gatewayJson(`${sessionBase(id)}/close?delete=true`, {
          method: 'POST',
          label: `close session ${id}`,
        })
        await waitForClosed(id)
      },
    })
    remainingSessionIds = cleanup.remainingSessionIds
    if (cleanup.errors.length > 0) {
      throw new AggregateError(cleanup.errors, `live session cleanup failed; remaining IDs: ${remainingSessionIds.join(', ')}`)
    }
  })

  page = await browser.newPage()
  const browserRequests = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && !isBrowserHttpConsoleNoise(message.text())) {
      browserErrors.push(message.text())
    }
  })
  page.on('request', request => browserRequests.push(request.url()))
  page.on('requestfailed', request => {
    if (!request.url().includes('/api/gas-city/')) return
    const errorText = request.failure()?.errorText ?? 'failed'
    if (errorText === 'net::ERR_ABORTED' && request.url().includes('/stream')) {
      browserStreamCancellations += 1
      return
    }
    const diagnostic = `${request.method()} ${request.url()} ${errorText}`
    browserRequestFailures.push(diagnostic)
    process.stdout.write(`[browser request failed] ${diagnostic}\n`)
  })
  page.on('response', response => {
    if (!response.url().includes('/api/gas-city/')) return
    const observed = {
      method: response.request().method(),
      status: response.status(),
      url: response.url(),
    }
    const diagnostic = `${observed.method} ${observed.status} ${observed.url}`
    browserResponses.push(diagnostic)
    process.stdout.write(`[browser response] ${diagnostic}\n`)
    if (observed.status >= 400 && !isExpectedClosedSessionNotFound(observed, closedSessionUrls)) {
      browserHttpFailures.push(diagnostic)
    }
  })
  await page.goto(stack.url)
  await openGasCityWorkspace(page)
  await page.getByRole('button', { name: connectionLabel }).click()
  await page.getByRole('button', { name: city, exact: true }).click()

  for (const [agent, expectedProvider] of entries) {
    const nonce = `dsh-gc-release-${randomUUID()}`
    await page.getByRole('button', { name: agent, exact: true }).click()
    await page.getByRole('textbox', { name: `Message ${agent}` }).fill(`Reply briefly with this exact nonce: ${nonce}`)
    await page.getByRole('button', { name: 'Start session' }).click()
    let sessionWorkspace
    try {
      sessionWorkspace = await waitForCreatedSession(page, { agent, timeoutMs: 330_000 })
    } catch (error) {
      await captureBrowserFailure(error)
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nVisible UI: ${browserFailureState.visible_text}`)
    }
    const sessionId = await sessionWorkspace.getAttribute('data-session-id')
    if (sessionId === null || sessionId === '') throw new Error(`created ${agent} session has no canonical ID`)
    createdSessions.push(sessionId)
    await sessionWorkspace.getByText(expectedProvider, { exact: true }).waitFor({ state: 'visible' })
    const initial = await waitForEvidence(sessionId, agent, expectedProvider, nonce)
    await sessionWorkspace.locator('.gc-message[data-role="assistant"]').getByText(nonce, { exact: false }).waitFor({
      state: 'visible',
      timeout: 30_000,
    })

    const toolNonce = `tool-${randomUUID()}`
    const toolPrompt = `Use one harmless read-only tool, then reply with this exact nonce: ${toolNonce}`
    await sessionWorkspace.getByRole('textbox', { name: /Message / }).fill(toolPrompt)
    await sessionWorkspace.getByRole('button', { name: 'Send', exact: true }).click()
    const submissionObservation = waitForSubmissionOutcome(sessionWorkspace, toolPrompt)
    const afterTool = await waitForEvidence(
      sessionId,
      agent,
      expectedProvider,
      toolNonce,
      evidence => newCompletedToolCallIds(initial, evidence).length > 0,
    )
    const submissionOutcome = await submissionObservation
    const completedToolDelta = newCompletedToolCallIds(initial, afterTool)
    await sessionWorkspace.locator('[aria-label^="Tool call "]').last().waitFor({ state: 'visible', timeout: 30_000 })
    await sessionWorkspace.locator('[aria-label^="Tool result "]').last().waitFor({ state: 'visible', timeout: 30_000 })

    certifiedSessions.push({
      session_id: sessionId,
      agent,
      provider: afterTool.provider,
      schema_version: afterTool.schemaVersion,
      assistant_message_count: afterTool.assistantMessageIds.length,
      completed_tool_call_delta: completedToolDelta.length,
      submission_outcome: submissionOutcome.kind,
      submission_detail: submissionOutcome.detail,
      tool_use_count: afterTool.toolUseCount,
      tool_result_count: afterTool.toolResultCount,
    })
    page.once('dialog', dialog => dialog.accept())
    closedSessionUrls.add(new URL(sessionBase(sessionId), stack.url).toString())
    await sessionWorkspace.getByRole('button', { name: 'Close permanently' }).click()
    await waitForClosed(sessionId)
  }

  const dshOrigin = new URL(stack.url).origin
  const foreignRequests = browserRequests.filter(url => new URL(url).origin !== dshOrigin)
  if (foreignRequests.length > 0) throw new Error(`browser made ${foreignRequests.length} request(s) outside stock DSH origin`)
  if (browserErrors.length > 0) throw new Error(`browser errors: ${browserErrors.join(' | ')}`)
  if (browserHttpFailures.length > 0) throw new Error(`browser HTTP failures: ${browserHttpFailures.join(' | ')}`)
} catch (error) {
  operationError = interruptController.signal.aborted ? interruptController.signal.reason : error
  if (!interruptController.signal.aborted) {
    try {
      await captureBrowserFailure(error)
    } catch (captureError) {
      browserErrors.push(`failed to capture browser failure state: ${captureError instanceof Error ? captureError.message : String(captureError)}`)
    }
  }
}

let finalError
try {
  await resources.close(operationError)
} catch (error) {
  finalError = error
}

await writeCertificate(finalError === undefined ? 'passed' : 'unproven', finalError)
if (finalError !== undefined) {
  process.stderr.write(`UNPROVEN: ${finalError.message}\n`)
  if (remainingSessionIds.length > 0) {
    process.stderr.write(`manual cleanup required for sessions: ${remainingSessionIds.join(', ')}\n`)
  }
  if (interruptedSignal === undefined) throw finalError
  process.exitCode = 130
}
if (finalError === undefined) process.stdout.write(`live multi-provider certificate: ${certificateOutput}\n`)
