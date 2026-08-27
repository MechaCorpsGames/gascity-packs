import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { useEffect, useState, useSyncExternalStore } from 'react'

import {
  loadCities,
  loadCityTopology,
  loadConnectionInventory,
  type CityInventory,
  type CityTopology,
  type ConnectionInventory,
  type AgentSummary,
  type SessionSummary,
} from './api.js'
import {
  createStructuredFeedController,
  createCityOperationWatcher,
  type CityOperationWatcher,
  type PendingInteraction,
  type StructuredFeedController,
  type StructuredMessage,
} from './feed/index.js'
import { createSupervisorFeedPort } from './supervisor-feed-port.js'
import {
  allowedSessionControls,
  createSupervisorOperations,
  type SessionControl,
  type SubmitIntent,
} from './supervisor-operations.js'

export { createSupervisorFeedPort, type SupervisorFeedPortConfig } from './supervisor-feed-port.js'
export {
  allowedSessionControls,
  createSupervisorOperations,
  type SubmitIntent,
  type SupervisorOperationsConfig,
} from './supervisor-operations.js'

export const inject = ['slots']

const GAS_CITY_HASH = '#/gas-city'
let previousHash = '#/'

const gasCityStyles = `
.gc-launch {
  width: 100%; min-height: 32px; display: flex; align-items: center; gap: 9px;
  padding: 5px 9px; border: 0; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b); font: inherit; cursor: pointer;
}
.gc-launch:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); color: var(--dsw-alias-label-primary, #0f1115); }
.gc-launch > span:first-child {
  display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px;
  background: var(--dsw-alias-label-primary, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff);
  font-size: 9px; font-weight: 750; letter-spacing: -.02em;
}
.gc-workspace, .gc-workspace * { box-sizing: border-box; }
.gc-workspace {
  position: fixed; inset: 0; z-index: 900; display: grid;
  grid-template: 60px minmax(0, 1fr) / 290px minmax(0, 1fr);
  background: var(--dsw-alias-bg-base, #f7f7f5); color: var(--dsw-alias-label-primary, #0f1115);
  font-family: var(--ds-font-family, Inter, ui-sans-serif, system-ui, -apple-system, sans-serif);
  letter-spacing: -.01em;
}
.gc-topbar {
  grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between;
  min-width: 0; padding: 0 18px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  background: var(--dsw-alias-bg-layer-1, #fff);
}
.gc-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.gc-brand-mark {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px;
  background: var(--dsw-alias-label-primary, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff);
  font-size: 11px; font-weight: 800;
}
.gc-topbar h1 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 650; }
.gc-kicker {
  padding: 2px 7px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 999px;
  color: var(--dsw-alias-label-tertiary, #81858c); font-size: 10px; line-height: 16px; text-transform: uppercase; letter-spacing: .08em;
}
.gc-workspace button {
  min-height: 30px; border: 0; border-radius: 8px; padding: 5px 9px;
  background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer;
}
.gc-workspace button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.gc-workspace button:focus-visible, .gc-workspace textarea:focus-visible, .gc-workspace input:focus-visible, .gc-workspace select:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 1px;
}
.gc-workspace button:disabled { cursor: default; opacity: .42; }
.gc-close { color: var(--dsw-alias-label-tertiary, #81858c) !important; }
.gc-topology {
  grid-column: 1; grid-row: 2; min-height: 0; padding: 14px 10px 24px;
  border-right: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  background: var(--dsw-specific-sidebar, var(--dsw-alias-bg-layer-1, #fff)); overflow-y: auto;
}
.gc-topology > p { margin: 8px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; }
.gc-topology > section { margin-bottom: 10px; }
.gc-topology section section { margin: 2px 0 2px 10px; padding-left: 8px; border-left: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); }
.gc-topology h2 {
  margin: 16px 9px 5px; color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 10px; line-height: 16px; font-weight: 650; text-transform: uppercase; letter-spacing: .08em;
}
.gc-topology button { width: 100%; display: flex; align-items: center; text-align: left; }
.gc-topology button[aria-pressed="true"] { background: var(--dsw-specific-sidebar-nav-item-active-accent, rgba(77,107,254,.1)); color: var(--dsw-alias-label-primary, #0f1115); font-weight: 550; }
.gc-topology span { display: inline-block; margin: 4px 8px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 11px; }
.gc-main {
  grid-column: 2; grid-row: 2; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base, #f7f7f5); overflow: hidden;
}
.gc-main > header { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 24px 32px 15px; }
.gc-main > header h2 { margin: 0 0 4px; font-size: 20px; line-height: 28px; font-weight: 620; }
.gc-main > header span { color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; }
.gc-session-controls { flex: none; display: flex; flex-wrap: wrap; gap: 5px; padding: 0 28px 12px; }
.gc-session-controls button { color: var(--dsw-alias-label-secondary, #61666b); }
.gc-session-controls button:last-child { color: var(--dsw-alias-state-error-primary, #d44); }
.gc-transcript { flex: 1; min-height: 0; overflow-y: auto; padding: 14px max(32px, calc((100% - 820px) / 2)) 40px; }
.gc-message {
  width: min(100%, 820px); margin: 0 auto 18px; padding: 18px 20px;
  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin, var(--dsw-alias-border-l2, rgba(0,0,0,.1)));
  border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: var(--dsw-shadow-lv1, 0 1px 2px rgba(0,0,0,.04));
}
.gc-message-role { display: block; margin-bottom: 10px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; }
.gc-message p { margin: 7px 0; font-size: 14px; line-height: 1.65; }
.gc-message details { margin: 8px 0 14px; color: var(--dsw-alias-label-secondary, #61666b); font-size: 13px; }
.gc-message details summary { cursor: pointer; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; }
.gc-message section[role="region"] { margin: 10px 0; padding: 11px 13px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,.035)); }
.gc-message pre { margin: 7px 0 0; color: var(--dsw-alias-label-secondary, #61666b); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 11px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.gc-pending {
  flex: none; width: min(calc(100% - 64px), 820px); max-height: 240px; margin: 0 auto 12px; padding: 14px 16px;
  border: 1px solid var(--dsw-alias-state-warn-primary, #c78c20); border-radius: 14px;
  background: var(--dsw-alias-state-warn-bg, rgba(199,140,32,.07)); overflow-y: auto;
}
.gc-pending h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
.gc-pending article p { margin: 4px 0 10px; font-size: 13px; }
.gc-pending article > div, .gc-pending label { display: flex; align-items: center; gap: 7px; }
.gc-pending input, .gc-pending select, .gc-composer textarea {
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font: inherit;
}
.gc-pending input, .gc-pending select { height: 30px; padding: 4px 8px; }
.gc-composer {
  flex: none; display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: end; gap: 7px;
  padding: 14px max(32px, calc((100% - 820px) / 2)) 22px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  background: var(--dsw-alias-bg-layer-1, #fff);
}
.gc-composer label { min-width: 0; }
.gc-composer label > span { display: block; margin: 0 0 6px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 11px; }
.gc-composer textarea { width: 100%; min-height: 52px; max-height: 160px; resize: vertical; padding: 10px 12px; line-height: 1.45; }
.gc-composer button { margin-bottom: 1px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); }
.gc-composer button:first-of-type { border-color: transparent; background: var(--dsw-alias-button-primary-fill, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff); }
.gc-operation { flex: none; width: min(calc(100% - 64px), 820px); margin: 0 auto 10px; padding: 10px 13px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,.04)); font-size: 12px; }
.gc-operation p { display: inline; margin-left: 8px; color: var(--dsw-alias-label-tertiary, #81858c); }
.gc-draft { padding-bottom: 24px; }
.gc-draft > label { width: min(calc(100% - 64px), 820px); margin: 0 auto; }
.gc-draft > label span { display: block; margin-bottom: 6px; font-size: 12px; }
.gc-draft textarea { width: 100%; min-height: 180px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font: inherit; }
.gc-draft > button { align-self: center; margin-top: 12px; background: var(--dsw-alias-button-primary-fill, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff); }
.gc-workspace [role="alert"] { margin: 8px 32px; color: var(--dsw-alias-state-error-primary, #d44); font-size: 12px; }
.gc-workspace [role="status"] { margin: 4px 32px 8px; color: var(--dsw-alias-state-success-primary, #27864a); font-size: 12px; }
@media (max-width: 760px) {
  .gc-workspace { grid-template: 54px 190px minmax(0, 1fr) / 1fr; }
  .gc-topbar { grid-row: 1; }
  .gc-topology { grid-column: 1; grid-row: 2; border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); }
  .gc-main { grid-column: 1; grid-row: 3; }
  .gc-composer { grid-template-columns: 1fr auto; }
}
`

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function getHash(): string {
  return window.location.hash
}

function openGasCity(): void {
  if (window.location.hash !== GAS_CITY_HASH) previousHash = window.location.hash || '#/'
  window.location.hash = GAS_CITY_HASH
}

function closeGasCity(): void {
  window.location.hash = previousHash
}

function GasCityWorkspaceAction({ wide }: { wide: boolean }): React.JSX.Element {
  return (
    <>
      <style>{gasCityStyles}</style>
      <button className="gc-launch" type="button" aria-label="Gas City" onClick={openGasCity}>
        <span aria-hidden="true">GC</span>
        {wide && <span>Gas City</span>}
      </button>
    </>
  )
}

function GasCityWorkspaceOverlay(): React.JSX.Element | null {
  const hash = useSyncExternalStore(subscribeToHash, getHash)
  if (hash !== GAS_CITY_HASH) return null

  return <GasCityWorkspace />
}

function GasCityWorkspace(): React.JSX.Element {
  const [inventory, setInventory] = useState<ConnectionInventory | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [selectedCityName, setSelectedCityName] = useState<string | null>(null)
  const [cities, setCities] = useState<CityInventory | null>(null)
  const [topology, setTopology] = useState<CityTopology | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<AgentSummary | null>(null)
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    loadConnectionInventory(abort.signal).then(setInventory, (reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => abort.abort()
  }, [])

  useEffect(() => {
    if (selectedConnectionId === null) return
    const abort = new AbortController()
    setCities(null)
    setSelectedCityName(null)
    setTopology(null)
    setSelectedAgent(null)
    setSelectedSession(null)
    setError(null)
    loadCities(selectedConnectionId, abort.signal).then(setCities, (reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => abort.abort()
  }, [selectedConnectionId])

  useEffect(() => {
    if (selectedConnectionId === null || selectedCityName === null) return
    const abort = new AbortController()
    setTopology(null)
    setSelectedAgent(null)
    setSelectedSession(null)
    setError(null)
    loadCityTopology(selectedConnectionId, selectedCityName, abort.signal).then(setTopology, (reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => abort.abort()
  }, [selectedCityName, selectedConnectionId])

  const matchedSessionIds = new Set<string>()
  if (topology !== null) {
    for (const agent of topology.agents) {
      for (const session of topology.sessions) {
        if (session.template === agent.name) matchedSessionIds.add(session.id)
      }
    }
  }

  return (
    <section className="gc-workspace" role="dialog" aria-label="Gas City">
      <style>{gasCityStyles}</style>
      <header className="gc-topbar">
        <div className="gc-brand">
          <span className="gc-brand-mark" aria-hidden="true">GC</span>
          <h1>Gas City</h1>
          <span className="gc-kicker">Supervisor client</span>
        </div>
        <button className="gc-close" type="button" aria-label="Close Gas City" onClick={closeGasCity}>Close</button>
      </header>
      <nav className="gc-topology" aria-label="Gas City topology">
        {error !== null && <p role="alert">{error}</p>}
        {error === null && inventory === null && <p>Connecting to Supervisor…</p>}
        {inventory?.connections.map(connection => (
          <section key={connection.id}>
            <button
              type="button"
              disabled={!connection.available}
              aria-pressed={selectedConnectionId === connection.id}
              onClick={() => setSelectedConnectionId(connection.id)}
            >
              {connection.label}
            </button>
            {connection.cities.map(city => <span key={city}>{city}</span>)}
          </section>
        ))}
        {selectedConnectionId !== null && cities === null && error === null && <p>Loading cities…</p>}
        {cities?.items.map(city => (
          <button
            key={city.name}
            type="button"
            disabled={!city.running}
            aria-pressed={selectedCityName === city.name}
            onClick={() => setSelectedCityName(city.name)}
          >
            {city.name}
          </button>
        ))}
        {selectedCityName !== null && topology === null && error === null && <p>Loading city topology…</p>}
        {topology?.rigs.map(rig => (
          <section key={rig.name} aria-label={`Rig ${rig.name}`}>
            <h2>{rig.name}</h2>
            {topology.agents.filter(agent => agent.rig === rig.name).map(agent => (
              <section key={agent.name} aria-label={`Agent ${agent.name}`}>
                <button
                  type="button"
                  disabled={!agent.available}
                  onClick={() => {
                    setSelectedSession(null)
                    setSelectedAgent(agent)
                  }}
                >
                  {agent.name}
                </button>
                {topology.sessions.filter(session => session.template === agent.name).map(session => (
                  <button key={session.id} type="button" onClick={() => {
                    setSelectedAgent(null)
                    setSelectedSession(session)
                  }}>
                    {session.title || session.id}
                  </button>
                ))}
              </section>
            ))}
          </section>
        ))}
        {topology !== null && topology.sessions.some(session => !matchedSessionIds.has(session.id)) && (
          <section role="region" aria-label="Other sessions">
            <h2>Other sessions</h2>
            {topology.sessions.filter(session => !matchedSessionIds.has(session.id)).map(session => (
              <button key={session.id} type="button" onClick={() => {
                setSelectedAgent(null)
                setSelectedSession(session)
              }}>
                {session.title || session.id}
              </button>
            ))}
          </section>
        )}
      </nav>
      {selectedConnectionId !== null && selectedCityName !== null && selectedAgent !== null && (
        <DraftSessionWorkspace
          key={`${selectedConnectionId}:${selectedCityName}:draft:${selectedAgent.name}`}
          connectionId={selectedConnectionId}
          cityName={selectedCityName}
          agent={selectedAgent}
          onCreated={session => {
            setSelectedAgent(null)
            setSelectedSession(session)
          }}
        />
      )}
      {selectedConnectionId !== null && selectedCityName !== null && selectedSession !== null && (
        <SessionWorkspace
          key={`${selectedConnectionId}:${selectedCityName}:${selectedSession.id}`}
          connectionId={selectedConnectionId}
          cityName={selectedCityName}
          session={selectedSession}
        />
      )}
    </section>
  )
}

function DraftSessionWorkspace({
  connectionId,
  cityName,
  agent,
  onCreated,
}: {
  connectionId: string
  cityName: string
  agent: AgentSummary
  onCreated: (session: SessionSummary) => void
}): React.JSX.Element {
  const [operations] = useState(() => createSupervisorOperations({ connectionId, cityName }))
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [operation, setOperation] = useState<{ watcher: CityOperationWatcher; prompt: string } | null>(null)

  const create = async (): Promise<void> => {
    if (draft.trim() === '' || creating || operation !== null) return
    const prompt = draft
    setCreating(true)
    setCreateError(null)
    try {
      const accepted = await operations.createAgentSession(agent.name, prompt)
      const watcher = createCityOperationWatcher(operations.cityOperationPort, accepted)
      setOperation({ watcher, prompt })
      await watcher.start()
    } catch (reason) {
      setCreateError(`Create outcome unknown: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="gc-main gc-draft" aria-label={`New session with ${agent.name}`}>
      <header>
        <h2>New session with {agent.name}</h2>
        {agent.provider !== undefined && <span>{agent.provider}</span>}
      </header>
      {operation !== null && (
        <CreateOperation watcher={operation.watcher} prompt={operation.prompt} onCreated={onCreated} />
      )}
      {createError !== null && <p role="alert">{createError}</p>}
      <label>
        <span>Message {agent.name}</span>
        <textarea
          aria-label={`Message ${agent.name}`}
          value={draft}
          disabled={creating || operation !== null}
          onChange={event => setDraft(event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        disabled={creating || operation !== null || draft.trim() === ''}
        onClick={() => void create()}
      >
        Start session
      </button>
    </main>
  )
}

function CreateOperation({
  watcher,
  prompt,
  onCreated,
}: {
  watcher: CityOperationWatcher
  prompt: string
  onCreated: (session: SessionSummary) => void
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(watcher.subscribe, watcher.getSnapshot)
  useEffect(() => () => watcher.dispose(), [watcher])
  useEffect(() => {
    if (snapshot.phase !== 'succeeded' || snapshot.terminal === null) return
    const payload = snapshot.terminal.payload
    if (typeof payload !== 'object' || payload === null || !('session' in payload)) return
    const session = payload.session
    if (typeof session === 'object' && session !== null && 'id' in session && typeof session.id === 'string') {
      onCreated(session as unknown as SessionSummary)
    }
  }, [onCreated, snapshot.phase, snapshot.terminal])
  const label = snapshot.phase === 'succeeded'
    ? 'Session started'
    : snapshot.phase === 'failed'
      ? 'Session failed to start'
      : snapshot.phase === 'outcome_unknown'
        ? 'Create outcome unknown'
        : 'Starting…'
  return (
    <aside className="gc-operation" aria-label="Session creation status">
      <strong>{label}</strong>
      <p>{prompt}</p>
    </aside>
  )
}

function messageBlocks(message: StructuredMessage): React.JSX.Element[] {
  const rendered: React.JSX.Element[] = []
  for (const [index, block] of (message.blocks ?? []).entries()) {
    if (block.type === 'text' && typeof block.text === 'string') {
      rendered.push(<p key={`${message.id}:text:${index}`}>{block.text}</p>)
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      rendered.push(
        <details key={`${message.id}:thinking:${index}`}>
          <summary>Reasoning</summary>
          <p>{block.thinking}</p>
        </details>,
      )
    } else if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' && block.name !== '' ? block.name : 'Unknown tool'
      rendered.push(
        <section key={`${message.id}:tool:${index}`} role="region" aria-label={`Tool call ${name}`}>
          <strong>{name}</strong>
          {block.input !== undefined && <pre>{JSON.stringify(block.input, null, 2)}</pre>}
        </section>,
      )
    } else if (block.type === 'tool_result') {
      const callId = typeof block.tool_call_id === 'string' ? block.tool_call_id : 'unknown'
      rendered.push(
        <section key={`${message.id}:result:${index}`} role="region" aria-label={`Tool result ${callId}`}>
          <strong>{block.is_error === true ? 'Tool error' : 'Tool result'}</strong>
          {typeof block.content === 'string' && <pre>{block.content}</pre>}
          {block.structured !== undefined && <pre>{JSON.stringify(block.structured, null, 2)}</pre>}
        </section>,
      )
    } else if (block.type === 'image') {
      rendered.push(
        <section key={`${message.id}:image:${index}`}>
          <strong>Image attachment</strong>
          {typeof block.file_path === 'string' && <span>{block.file_path}</span>}
        </section>,
      )
    } else {
      rendered.push(
        <section key={`${message.id}:unknown:${index}`}>
          <strong>Unsupported content</strong>
          <span>{typeof block.type === 'string' ? block.type : 'unknown'}</span>
        </section>,
      )
    }
  }
  return rendered
}

function normalizedPendingKind(kind: string): 'approval' | 'question' | 'choice' | 'unknown' {
  if (kind === 'approval' || kind === 'tool-approval' || kind === 'tool_approval') return 'approval'
  if (kind === 'question') return 'question'
  if (kind === 'choice') return 'choice'
  return 'unknown'
}

function PendingInteractions({
  controller,
  pending,
}: {
  controller: StructuredFeedController
  pending: readonly PendingInteraction[]
}): React.JSX.Element | null {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (pending.length === 0) return null

  return (
    <section className="gc-pending" role="region" aria-label="Pending interactions">
      <h3>Needs your input</h3>
      {pending.map(interaction => {
        const kind = normalizedPendingKind(interaction.kind)
        const enabled = interaction.responseState === 'enabled'
        const answer = answers[interaction.requestId] ?? ''
        const respond = (response: Readonly<Record<string, unknown>>): void => {
          void controller.respond(interaction.requestId, response)
        }
        return (
          <article key={interaction.requestId}>
            <p>{interaction.prompt}</p>
            {kind === 'approval' && (
              <div>
                <button type="button" disabled={!enabled} onClick={() => respond({ action: 'approve' })}>Approve</button>
                <button type="button" disabled={!enabled} onClick={() => respond({ action: 'approve_accept_edits' })}>Approve and accept edits</button>
                <button type="button" disabled={!enabled} onClick={() => respond({ action: 'deny' })}>Deny</button>
              </div>
            )}
            {kind === 'question' && (
              <div>
                <label>
                  Answer
                  <input
                    value={answer}
                    disabled={!enabled}
                    onChange={event => setAnswers(current => ({
                      ...current,
                      [interaction.requestId]: event.currentTarget.value,
                    }))}
                  />
                </label>
                <button
                  type="button"
                  disabled={!enabled || answer.trim() === ''}
                  onClick={() => respond({ action: 'answer', text: answer.trim() })}
                >
                  Answer
                </button>
              </div>
            )}
            {kind === 'choice' && (
              <div>
                <label>
                  Choice
                  <select
                    value={answer}
                    disabled={!enabled}
                    onChange={event => setAnswers(current => ({
                      ...current,
                      [interaction.requestId]: event.currentTarget.value,
                    }))}
                  >
                    <option value="">Select an option</option>
                    {interaction.options?.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!enabled || !interaction.options?.includes(answer)}
                  onClick={() => respond({ action: 'answer', text: answer })}
                >
                  Answer
                </button>
              </div>
            )}
            {kind === 'unknown' && <p>Unsupported interaction: {interaction.kind}</p>}
          </article>
        )
      })}
    </section>
  )
}

function SessionWorkspace({
  connectionId,
  cityName,
  session,
}: {
  connectionId: string
  cityName: string
  session: SessionSummary
}): React.JSX.Element {
  const [controller] = useState(() => createStructuredFeedController(createSupervisorFeedPort({
    connectionId,
    cityName,
    includeThinking: false,
  })))
  const [operations] = useState(() => createSupervisorOperations({ connectionId, cityName }))
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submission, setSubmission] = useState<{ watcher: CityOperationWatcher; prompt: string } | null>(null)
  const [controlBusy, setControlBusy] = useState<SessionControl | null>(null)
  const [controlNotice, setControlNotice] = useState<string | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)

  useEffect(() => {
    void controller.bootstrap({ sessionId: session.id }).catch((reason: unknown) => {
      setBootstrapError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => controller.dispose()
  }, [controller, session.id])

  const submit = async (intent?: SubmitIntent): Promise<void> => {
    if (draft.trim() === '' || sending) return
    const prompt = draft
    setSending(true)
    setSubmitError(null)
    try {
      const accepted = await operations.submitSession(session.id, prompt, intent)
      const watcher = createCityOperationWatcher(operations.cityOperationPort, accepted)
      setSubmission({ watcher, prompt })
      setDraft('')
      await watcher.start()
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }

  const controlLabels: Readonly<Record<SessionControl, string>> = {
    stop: 'Interrupt turn',
    kill: 'Kill runtime',
    suspend: 'Suspend',
    wake: 'Wake',
    close: 'Close permanently',
  }
  const controlNotices: Readonly<Record<SessionControl, string>> = {
    stop: 'Turn interrupted',
    kill: 'Runtime killed',
    suspend: 'Session suspended',
    wake: 'Wake requested',
    close: 'Session closed permanently',
  }
  const availableControls = allowedSessionControls(
    snapshot.session?.state ?? session.state,
    snapshot.activity ?? session.activity,
  )

  const controlSession = async (control: SessionControl): Promise<void> => {
    if (controlBusy !== null) return
    if (control === 'kill' && !window.confirm('Kill this session runtime?')) return
    if (control === 'close' && !window.confirm('Close this session permanently?')) return
    setControlBusy(control)
    setControlNotice(null)
    setControlError(null)
    try {
      await operations.controlSession(session.id, control)
      setControlNotice(controlNotices[control])
    } catch (reason) {
      setControlError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setControlBusy(null)
    }
  }

  return (
    <main className="gc-main gc-session" aria-label={`Session ${session.title || session.id}`}>
      <header>
        <div>
          <h2>{session.title || session.id}</h2>
          <span>{session.provider}</span>
        </div>
        <span>{snapshot.activity ?? snapshot.phase}</span>
      </header>
      <section className="gc-session-controls" aria-label="Session controls">
        {availableControls.map(control => (
          <button
            key={control}
            type="button"
            disabled={controlBusy !== null}
            onClick={() => void controlSession(control)}
          >
            {controlLabels[control]}
          </button>
        ))}
      </section>
      {controlNotice !== null && <p role="status">{controlNotice}</p>}
      {controlError !== null && <p role="alert">{controlError}</p>}
      {bootstrapError !== null && <p role="alert">{bootstrapError}</p>}
      <section className="gc-transcript" aria-label="Transcript">
        {snapshot.transcript?.messages.map(message => (
          <article className="gc-message" key={message.id} data-role={message.role} data-status={message.status}>
            <span className="gc-message-role">{message.role}</span>
            {messageBlocks(message)}
          </article>
        ))}
      </section>
      <PendingInteractions controller={controller} pending={snapshot.pending} />
      {submission !== null && <SubmissionOperation watcher={submission.watcher} prompt={submission.prompt} />}
      {submitError !== null && <p role="alert">{submitError}</p>}
      <section className="gc-composer" aria-label="Composer">
        <label>
          <span>Message {session.title || session.id}</span>
          <textarea
            aria-label={`Message ${session.title || session.id}`}
            value={draft}
            disabled={sending}
            onChange={event => setDraft(event.currentTarget.value)}
          />
        </label>
        <button type="button" disabled={sending || draft.trim() === ''} onClick={() => void submit()}>Send</button>
        {session.submission_capabilities?.supports_follow_up === true && (
          <button type="button" disabled={sending || draft.trim() === ''} onClick={() => void submit('follow_up')}>
            Follow up
          </button>
        )}
        {session.submission_capabilities?.supports_interrupt_now === true && (
          <button type="button" disabled={sending || draft.trim() === ''} onClick={() => void submit('interrupt_now')}>
            Interrupt and send
          </button>
        )}
      </section>
    </main>
  )
}

function SubmissionOperation({
  watcher,
  prompt,
}: {
  watcher: CityOperationWatcher
  prompt: string
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(watcher.subscribe, watcher.getSnapshot)
  useEffect(() => () => watcher.dispose(), [watcher])
  const label = snapshot.phase === 'succeeded'
    ? 'Submitted'
    : snapshot.phase === 'failed'
      ? 'Submission failed'
      : snapshot.phase === 'outcome_unknown'
        ? 'Submit outcome unknown'
        : 'Submitting…'
  return (
    <aside className="gc-operation" aria-label="Submission status">
      <strong>{label}</strong>
      <p>{prompt}</p>
    </aside>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'gas-city-workspace-action',
  }, GasCityWorkspaceAction))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'gas-city-workspace-overlay',
  }, GasCityWorkspaceOverlay))
}
