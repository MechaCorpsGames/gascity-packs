import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import {
  loadCities,
  loadCityTopology,
  loadConnectionInventory,
  loadSessionPage,
  parseSessionSummary,
  type CityInventory,
  type CityTopology,
  type ConnectionInventory,
  type AgentSummary,
  type ProviderPublicSummary,
  type SessionSummary,
} from './api.js'
import {
  createStructuredFeedController,
  createCityOperationWatcher,
  type CityOperationSnapshot,
  type CityOperationWatcher,
  type PendingInteraction,
  type StructuredFeedController,
  type StructuredMessage,
} from './feed/index.js'
import { createSupervisorFeedPort } from './supervisor-feed-port.js'
import {
  allowedSessionControls,
  createSupervisorOperations,
  SupervisorOutcomeUnknownError,
  SupervisorRequestError,
  type SessionControl,
  type SubmitIntent,
} from './supervisor-operations.js'

export { createSupervisorFeedPort, type SupervisorFeedPortConfig } from './supervisor-feed-port.js'
export {
  allowedSessionControls,
  createSupervisorOperations,
  SupervisorOutcomeUnknownError,
  SupervisorRequestError,
  type SubmitIntent,
  type SupervisorOperationsConfig,
} from './supervisor-operations.js'

export const inject = ['slots']

const GAS_CITY_HASH = '#/gas-city'
const THINKING_PREFERENCE_KEY = 'gastownhall.deepseek-harness-ui.show-reasoning'
let previousHash = '#/'

function readThinkingPreference(): boolean {
  try {
    return window.localStorage.getItem(THINKING_PREFERENCE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeThinkingPreference(value: boolean): void {
  try {
    window.localStorage.setItem(THINKING_PREFERENCE_KEY, String(value))
  } catch {
    // Storage can be unavailable in hardened or ephemeral browser profiles.
  }
}

function mutationFailure(action: string, reason: unknown): { message: string; refresh: boolean } {
  const detail = reason instanceof Error ? reason.message : String(reason)
  if (reason instanceof SupervisorRequestError) {
    return { message: `${action} rejected: ${detail}`, refresh: false }
  }
  if (reason instanceof SupervisorOutcomeUnknownError) {
    return { message: `${action} outcome unknown: ${detail}`, refresh: true }
  }
  return { message: `${action} outcome unknown: ${detail}`, refresh: true }
}

function operationOutcomeUnknownDetail(snapshot: CityOperationSnapshot): string {
  const payload = snapshot.terminal?.payload
  if (typeof payload === 'object' && payload !== null && 'error_message' in payload
    && typeof payload.error_message === 'string' && payload.error_message !== '') {
    const code = 'error_code' in payload && typeof payload.error_code === 'string' && payload.error_code !== ''
      ? ` ${payload.error_code}`
      : ''
    return `Supervisor reported${code}: ${payload.error_message}`
  }
  return `Supervisor result watch ended with ${snapshot.unknownReason ?? 'an unknown reason'}`
}

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
.gc-topology-search {
  width: calc(100% - 16px); height: 32px; margin: 8px; padding: 5px 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font: inherit; font-size: 12px;
}
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
.gc-session-controls label { display: flex; align-items: center; gap: 6px; padding: 4px 7px; color: var(--dsw-alias-label-secondary, #61666b); font-size: 12px; }
.gc-session-settings {
  flex: none; display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 0 32px 12px;
}
.gc-session-settings label { display: grid; gap: 4px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 11px; }
.gc-session-settings input, .gc-session-settings select {
  height: 32px; min-width: 180px; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font: inherit; font-size: 12px;
}
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
  const [topologySearch, setTopologySearch] = useState('')
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false)
  const loadMoreAbortRef = useRef<AbortController | null>(null)
  const selectionRef = useRef({ connectionId: selectedConnectionId, cityName: selectedCityName })
  selectionRef.current = { connectionId: selectedConnectionId, cityName: selectedCityName }

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
    setTopologySearch('')
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
    setTopologySearch('')
    setError(null)
    loadCityTopology(selectedConnectionId, selectedCityName, abort.signal).then(setTopology, (reason: unknown) => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => abort.abort()
  }, [selectedCityName, selectedConnectionId])

  useEffect(() => {
    loadMoreAbortRef.current?.abort()
    loadMoreAbortRef.current = null
    setLoadingMoreSessions(false)
    return () => loadMoreAbortRef.current?.abort()
  }, [selectedCityName, selectedConnectionId])

  const matchedSessionIds = new Set<string>()
  if (topology !== null) {
    for (const agent of topology.agents) {
      for (const session of topology.sessions) {
        if (session.template === agent.name) matchedSessionIds.add(session.id)
      }
    }
  }
  const normalizedSearch = topologySearch.trim().toLocaleLowerCase()
  const sessionMatchesSearch = (session: SessionSummary): boolean => normalizedSearch === '' || [
    session.title,
    session.id,
    session.provider,
    session.template,
  ].some(value => value.toLocaleLowerCase().includes(normalizedSearch))
  const agentMatchesSearch = (agent: AgentSummary): boolean => normalizedSearch === ''
    || agent.name.toLocaleLowerCase().includes(normalizedSearch)
    || topology?.sessions.some(session => session.template === agent.name && sessionMatchesSearch(session)) === true
  const rigNames = new Set(topology?.rigs.map(rig => rig.name) ?? [])
  const otherAgents = topology?.agents.filter(agent => (agent.rig === undefined || !rigNames.has(agent.rig)) && agentMatchesSearch(agent)) ?? []
  const renderAgent = (agent: AgentSummary): React.JSX.Element => (
    <section key={agent.name} aria-label={`Agent ${agent.name}`}>
      <button
        type="button"
        disabled={!agent.available}
        aria-pressed={selectedAgent?.name === agent.name}
        onClick={() => {
          setSelectedSession(null)
          setSelectedAgent(agent)
        }}
      >
        {agent.name}
      </button>
      {topology?.sessions.filter(session => session.template === agent.name && sessionMatchesSearch(session)).map(session => (
        <button key={session.id} type="button" aria-pressed={selectedSession?.id === session.id} onClick={() => {
          setSelectedAgent(null)
          setSelectedSession(session)
        }}>
          {session.title || session.id}
        </button>
      ))}
    </section>
  )

  const loadMoreSessions = async (): Promise<void> => {
    if (selectedConnectionId === null || selectedCityName === null || topology?.nextSessionCursor === undefined || loadingMoreSessions) return
    const abort = new AbortController()
    loadMoreAbortRef.current?.abort()
    loadMoreAbortRef.current = abort
    setLoadingMoreSessions(true)
    setError(null)
    try {
      const page = await loadSessionPage(
        selectedConnectionId,
        selectedCityName,
        topology.nextSessionCursor,
        abort.signal,
      )
      if (loadMoreAbortRef.current !== abort) return
      setTopology(current => {
        if (current === null) return current
        const sessions = new Map(current.sessions.map(session => [session.id, session]))
        for (const session of page.sessions) sessions.set(session.id, session)
        const { nextSessionCursor: _previousCursor, ...withoutCursor } = current
        return {
          ...withoutCursor,
          sessions: [...sessions.values()],
          sessionTotal: page.total,
          sessionPartial: current.sessionPartial || page.partial,
          sessionPartialErrors: [...new Set([...current.sessionPartialErrors, ...page.partialErrors])],
          ...(page.nextSessionCursor === undefined ? {} : { nextSessionCursor: page.nextSessionCursor }),
        }
      })
    } catch (reason) {
      if (!abort.signal.aborted && loadMoreAbortRef.current === abort) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (loadMoreAbortRef.current === abort) {
        loadMoreAbortRef.current = null
        setLoadingMoreSessions(false)
      }
    }
  }

  const updateSelectedSession = (updated: SessionSummary): void => {
    setSelectedSession(updated)
    setTopology(current => current === null
      ? current
      : { ...current, sessions: current.sessions.map(session => session.id === updated.id ? updated : session) })
  }

  const selectCreatedSession = (created: SessionSummary): void => {
    setSelectedAgent(null)
    setSelectedSession(created)
    setTopology(current => {
      if (current === null) return current
      const alreadyLoaded = current.sessions.some(session => session.id === created.id)
      const sessions = alreadyLoaded
        ? current.sessions.map(session => session.id === created.id ? created : session)
        : [...current.sessions, created]
      return {
        ...current,
        sessions,
        sessionTotal: Math.max(sessions.length, current.sessionTotal + (alreadyLoaded ? 0 : 1)),
      }
    })
  }

  const refreshSelectedTopology = async (): Promise<void> => {
    const connectionId = selectedConnectionId
    const cityName = selectedCityName
    if (connectionId === null || cityName === null) throw new Error('No Gas City is selected')
    const refreshed = await loadCityTopology(connectionId, cityName, AbortSignal.timeout(15_000))
    const current = selectionRef.current
    if (current.connectionId === connectionId && current.cityName === cityName) setTopology(refreshed)
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
        {topology !== null && (
          <input
            className="gc-topology-search"
            type="search"
            aria-label="Search agents and sessions"
            placeholder="Search agents and sessions"
            value={topologySearch}
            onChange={event => setTopologySearch(event.currentTarget.value)}
          />
        )}
        {topology?.rigs.map(rig => (
          <section key={rig.name} aria-label={`Rig ${rig.name}`}>
            <h2>{rig.name}</h2>
            {topology.agents.filter(agent => agent.rig === rig.name && agentMatchesSearch(agent)).map(renderAgent)}
          </section>
        ))}
        {otherAgents.length > 0 && (
          <section role="region" aria-label="City and other agents">
            <h2>City and other agents</h2>
            {otherAgents.map(renderAgent)}
          </section>
        )}
        {topology !== null && topology.sessions.some(session => !matchedSessionIds.has(session.id) && sessionMatchesSearch(session)) && (
          <section role="region" aria-label="Other sessions">
            <h2>Other sessions</h2>
            {topology.sessions.filter(session => !matchedSessionIds.has(session.id) && sessionMatchesSearch(session)).map(session => (
              <button key={session.id} type="button" aria-pressed={selectedSession?.id === session.id} onClick={() => {
                setSelectedAgent(null)
                setSelectedSession(session)
              }}>
                {session.title || session.id}
              </button>
            ))}
          </section>
        )}
        {topology?.nextSessionCursor !== undefined && (
          <button type="button" disabled={loadingMoreSessions} onClick={() => void loadMoreSessions()}>
            {loadingMoreSessions ? 'Loading more sessions…' : 'Load more sessions'}
          </button>
        )}
        {topology !== null && (
          <p role="status">Loaded {topology.sessions.length} of {topology.sessionTotal} sessions</p>
        )}
        {topology?.sessionPartial === true && (
          <p role="alert">
            Session inventory is partial{topology.sessionPartialErrors.length === 0 ? '' : `: ${topology.sessionPartialErrors.join('; ')}`}
          </p>
        )}
        {topology !== null && normalizedSearch !== ''
          && !topology.sessions.some(sessionMatchesSearch)
          && !topology.agents.some(agentMatchesSearch)
          && <p>No loaded agents or sessions match this filter.</p>}
      </nav>
      {selectedConnectionId !== null && selectedCityName !== null && selectedAgent !== null && (
        <DraftSessionWorkspace
          key={`${selectedConnectionId}:${selectedCityName}:draft:${selectedAgent.name}`}
          connectionId={selectedConnectionId}
          cityName={selectedCityName}
          agent={selectedAgent}
          onCreated={selectCreatedSession}
          onOutcomeUnknown={refreshSelectedTopology}
        />
      )}
      {selectedConnectionId !== null && selectedCityName !== null && selectedSession !== null && (
        <SessionWorkspace
          key={`${selectedConnectionId}:${selectedCityName}:${selectedSession.id}`}
          connectionId={selectedConnectionId}
          cityName={selectedCityName}
          session={selectedSession}
          provider={topology?.providers.find(provider => provider.name === selectedSession.provider)}
          onSessionChanged={updateSelectedSession}
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
  onOutcomeUnknown,
}: {
  connectionId: string
  cityName: string
  agent: AgentSummary
  onCreated: (session: SessionSummary) => void
  onOutcomeUnknown: () => Promise<void>
}): React.JSX.Element {
  const [operations] = useState(() => createSupervisorOperations({ connectionId, cityName }))
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [retryBlocked, setRetryBlocked] = useState(false)
  const [operation, setOperation] = useState<{ watcher: CityOperationWatcher; prompt: string } | null>(null)

  const handleAcceptedOutcomeUnknown = async (detail: string): Promise<void> => {
    setOperation(null)
    setRetryBlocked(true)
    try {
      await onOutcomeUnknown()
      setCreateError(`Create outcome unknown: ${detail}. Session inventory refreshed; inspect sessions before retrying.`)
    } catch (refreshReason) {
      const refreshDetail = refreshReason instanceof Error ? refreshReason.message : String(refreshReason)
      setCreateError(`Create outcome unknown: ${detail}. Session inventory refresh failed: ${refreshDetail}. Inspect Gas City before retrying.`)
    }
  }

  const create = async (): Promise<void> => {
    if (draft.trim() === '' || creating || operation !== null || retryBlocked) return
    const prompt = draft
    setCreating(true)
    setCreateError(null)
    setRetryBlocked(false)
    try {
      const accepted = await operations.createAgentSession(agent.name, prompt)
      const watcher = createCityOperationWatcher(operations.cityOperationPort, accepted)
      setOperation({ watcher, prompt })
      await watcher.start()
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason)
      if (reason instanceof SupervisorRequestError) {
        setCreateError(`Session failed to start: ${detail}`)
      } else {
        setRetryBlocked(true)
        try {
          await onOutcomeUnknown()
          setCreateError(`Create outcome unknown: ${detail}. Session inventory refreshed; inspect sessions before retrying.`)
        } catch (refreshReason) {
          const refreshDetail = refreshReason instanceof Error ? refreshReason.message : String(refreshReason)
          setCreateError(`Create outcome unknown: ${detail}. Session inventory refresh failed: ${refreshDetail}. Inspect Gas City before retrying.`)
        }
      }
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
        <CreateOperation
          watcher={operation.watcher}
          prompt={operation.prompt}
          onCreated={onCreated}
          onFailed={detail => {
            setOperation(null)
            setCreateError(`Session failed to start: ${detail}`)
          }}
          onOutcomeUnknown={detail => void handleAcceptedOutcomeUnknown(detail)}
        />
      )}
      {createError !== null && <p role="alert">{createError}</p>}
      {retryBlocked && (
        <button type="button" onClick={() => {
          setRetryBlocked(false)
          setCreateError(null)
        }}>
          I checked sessions; allow retry
        </button>
      )}
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
        disabled={creating || operation !== null || retryBlocked || draft.trim() === ''}
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
  onFailed,
  onOutcomeUnknown,
}: {
  watcher: CityOperationWatcher
  prompt: string
  onCreated: (session: SessionSummary) => void
  onFailed: (detail: string) => void
  onOutcomeUnknown: (detail: string) => void
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(watcher.subscribe, watcher.getSnapshot)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const terminalHandled = useRef(false)
  useEffect(() => () => watcher.dispose(), [watcher])
  useEffect(() => {
    if (terminalHandled.current) return
    if (snapshot.phase === 'outcome_unknown') {
      terminalHandled.current = true
      onOutcomeUnknown(operationOutcomeUnknownDetail(snapshot))
      return
    }
    if (snapshot.phase === 'failed' && snapshot.terminal !== null) {
      terminalHandled.current = true
      const payload = snapshot.terminal.payload
      const detail = typeof payload === 'object' && payload !== null && 'error_message' in payload
        && typeof payload.error_message === 'string'
        ? payload.error_message
        : 'Supervisor reported request failure'
      onFailed(detail)
      return
    }
    if (snapshot.phase !== 'succeeded' || snapshot.terminal === null) return
    terminalHandled.current = true
    const payload = snapshot.terminal.payload
    if (typeof payload !== 'object' || payload === null || !('session' in payload)) return
    const session = payload.session
    try {
      onCreated(parseSessionSummary(session, 'session create result'))
    } catch (reason) {
      setTerminalError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [onCreated, onFailed, onOutcomeUnknown, snapshot.phase, snapshot.terminal, snapshot.unknownReason])
  const label = terminalError !== null
    ? 'Session result incompatible'
    : snapshot.phase === 'succeeded'
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
      {terminalError !== null && <p role="alert">{terminalError}</p>}
    </aside>
  )
}

function messageBlocks(message: StructuredMessage): React.JSX.Element[] {
  const rendered: React.JSX.Element[] = []
  if (message.user_prompt !== undefined) {
    if (typeof message.user_prompt.text === 'string' && message.user_prompt.text !== '') {
      rendered.push(<p key={`${message.id}:prompt`}>{message.user_prompt.text}</p>)
    }
    for (const [index, file] of (message.user_prompt.uploaded_files ?? []).entries()) {
      const name = file.original_name || file.file_path || `Attachment ${index + 1}`
      const details = [file.mime_type, file.size].filter(value => typeof value === 'string' && value !== '').join(' · ')
      rendered.push(
        <section key={`${message.id}:attachment:${index}`} role="region" aria-label={`Attachment ${name}`}>
          <strong>{name}</strong>
          {details !== '' && <span>{details}</span>}
          {file.file_path !== undefined && file.file_path !== name && <pre>{file.file_path}</pre>}
        </section>,
      )
    }
    if ((message.user_prompt.opened_files?.length ?? 0) > 0) {
      rendered.push(
        <section key={`${message.id}:opened-files`}>
          <strong>Opened files</strong>
          <pre>{message.user_prompt.opened_files?.join('\n')}</pre>
        </section>,
      )
    }
    const selections = message.user_prompt.selections?.map(selection => selection.text).filter(
      (value): value is string => typeof value === 'string' && value !== '',
    ) ?? []
    if (selections.length > 0) {
      rendered.push(
        <section key={`${message.id}:selections`}>
          <strong>IDE selections</strong>
          <pre>{selections.join('\n\n')}</pre>
        </section>,
      )
    }
  }
  if (message.system_event !== undefined) {
    const label = message.system_event.message
      || message.system_event.code
      || message.system_event.kind
      || 'System event'
    rendered.push(<p key={`${message.id}:system-event`}>{label}</p>)
  }
  for (const [index, block] of (message.blocks ?? []).entries()) {
    if (block.type === 'text' && typeof block.text === 'string') {
      rendered.push(<p key={`${message.id}:text:${index}`}>{block.text}</p>)
    } else if (block.type === 'thinking') {
      if (typeof block.thinking === 'string' && block.thinking !== '') {
        rendered.push(
          <details key={`${message.id}:thinking:${index}`}>
            <summary>Reasoning</summary>
            <p>{block.thinking}</p>
          </details>,
        )
      }
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
      const details = [block.mime_type, block.file_path, block.image_url]
        .filter(value => typeof value === 'string' && value !== '')
        .join('\n')
      rendered.push(
        <section key={`${message.id}:image:${index}`} role="region" aria-label="Image metadata">
          <strong>Image metadata</strong>
          {details !== '' && <pre>{details}</pre>}
        </section>,
      )
    } else if (block.type === 'interaction' && block.interaction !== null && typeof block.interaction === 'object') {
      const interaction = block.interaction as Record<string, unknown>
      rendered.push(
        <section key={`${message.id}:interaction:${index}`} role="region" aria-label="Interaction history">
          <strong>{typeof interaction.kind === 'string' && interaction.kind !== '' ? interaction.kind : 'Interaction'}</strong>
          {typeof interaction.prompt === 'string' && interaction.prompt !== '' && <p>{interaction.prompt}</p>}
          {typeof interaction.state === 'string' && interaction.state !== '' && <span>{interaction.state}</span>}
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
  const metadata = [
    message.model === undefined || message.model === '' ? undefined : `model ${message.model}`,
    message.stop_reason === undefined || message.stop_reason === '' ? undefined : `stop ${message.stop_reason}`,
    message.usage === undefined ? undefined : Object.entries(message.usage)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key} ${value}`)
      .join(' · '),
  ].filter((value): value is string => value !== undefined && value !== '')
  if (metadata.length > 0) rendered.push(<small key={`${message.id}:metadata`}>{metadata.join(' · ')}</small>)
  return rendered
}

function normalizedPendingKind(kind: string): 'approval' | 'question' | 'choice' | 'unknown' {
  if (kind === 'approval' || kind === 'tool-approval' || kind === 'tool_approval') return 'approval'
  if (kind === 'question') return 'question'
  if (kind === 'choice') return 'choice'
  return 'unknown'
}

export function canChangePermissionMode(state: string, activity?: string): boolean {
  if ((state === 'asleep' || state === 'drained' || state === 'failed-create') && activity === 'idle') return true
  return state === 'suspended' && (activity === 'idle' || activity === 'hold')
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
            {interaction.responseState === 'outcome_unknown' && (
              <p role="alert">Response outcome unknown. Waiting for Gas City to clear or retain this interaction; do not resend it.</p>
            )}
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
  provider,
  onSessionChanged,
}: {
  connectionId: string
  cityName: string
  session: SessionSummary
  provider: ProviderPublicSummary | undefined
  onSessionChanged: (session: SessionSummary) => void
}): React.JSX.Element {
  const [includeThinking, setIncludeThinking] = useState(readThinkingPreference)
  const controller = useMemo(() => createStructuredFeedController(createSupervisorFeedPort({
    connectionId,
    cityName,
    includeThinking,
  })), [cityName, connectionId, includeThinking])
  const operations = useMemo(() => createSupervisorOperations({ connectionId, cityName }), [cityName, connectionId])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitRetryBlocked, setSubmitRetryBlocked] = useState(false)
  const [submission, setSubmission] = useState<{ watcher: CityOperationWatcher; prompt: string } | null>(null)
  const [submissionNotice, setSubmissionNotice] = useState<{ label: string; prompt: string } | null>(null)
  const [controlBusy, setControlBusy] = useState<SessionControl | null>(null)
  const [controlNotice, setControlNotice] = useState<string | null>(null)
  const [controlError, setControlError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(session.title || session.id)
  const [settingsBusy, setSettingsBusy] = useState<'rename' | 'permission' | null>(null)
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const permissionOption = provider?.options_schema?.find(option => option.key === 'permission_mode')
  const currentPermissionMode = session.options?.permission_mode
    ?? provider?.effective_defaults?.permission_mode
    ?? permissionOption?.default
    ?? ''
  const [permissionDraft, setPermissionDraft] = useState(currentPermissionMode)

  useEffect(() => {
    setBootstrapError(null)
    void controller.bootstrap({ sessionId: session.id }).catch((reason: unknown) => {
      setBootstrapError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => controller.dispose()
  }, [controller, session.id])

  useEffect(() => setTitleDraft(session.title || session.id), [session.id, session.title])
  useEffect(() => setPermissionDraft(currentPermissionMode), [currentPermissionMode])

  const handleSubmitOutcomeUnknown = async (prompt: string, detail: string): Promise<void> => {
    setSubmission(null)
    setSubmissionNotice(null)
    setDraft(prompt)
    setSubmitRetryBlocked(true)
    try {
      const refreshed = await operations.fetchSession(session.id)
      onSessionChanged(refreshed)
      await controller.bootstrap({ sessionId: session.id })
      setSubmitError(`Submit outcome unknown: ${detail}. Inspect the authoritative transcript before retrying.`)
    } catch (refreshReason) {
      const refreshDetail = refreshReason instanceof Error ? refreshReason.message : String(refreshReason)
      setSubmitError(`Submit outcome unknown: ${detail}. Authoritative refresh failed: ${refreshDetail}. Inspect Gas City before retrying.`)
    }
  }

  const submit = async (intent?: SubmitIntent): Promise<void> => {
    if (draft.trim() === '' || sending || submitRetryBlocked) return
    const prompt = draft
    setSending(true)
    setSubmitError(null)
    setSubmitRetryBlocked(false)
    setSubmissionNotice(null)
    try {
      const accepted = await operations.submitSession(session.id, prompt, intent)
      const watcher = createCityOperationWatcher(operations.cityOperationPort, accepted)
      setSubmission({ watcher, prompt })
      setDraft('')
      await watcher.start()
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason)
      if (reason instanceof SupervisorRequestError) {
        setSubmitError(`Submission rejected: ${detail}`)
      } else {
        await handleSubmitOutcomeUnknown(prompt, detail)
      }
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
  const refreshAuthoritativeSession = async (): Promise<SessionSummary> => {
    const refreshed = await operations.fetchSession(session.id)
    onSessionChanged(refreshed)
    return refreshed
  }

  const controlSession = async (control: SessionControl): Promise<void> => {
    if (controlBusy !== null) return
    if (control === 'kill' && !window.confirm('Kill this session runtime?')) return
    if (control === 'close' && !window.confirm('Close this session permanently?')) return
    setControlBusy(control)
    setControlNotice(null)
    setControlError(null)
    try {
      await operations.controlSession(session.id, control)
      try {
        await refreshAuthoritativeSession()
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : String(reason)
        setControlNotice(controlNotices[control])
        setControlError(`${controlNotices[control]}, but session refresh failed: ${detail}`)
        return
      }
      setControlNotice(controlNotices[control])
    } catch (reason) {
      const failure = mutationFailure(controlLabels[control], reason)
      if (failure.refresh) {
        try {
          await refreshAuthoritativeSession()
        } catch (refreshReason) {
          const detail = refreshReason instanceof Error ? refreshReason.message : String(refreshReason)
          failure.message = `${failure.message}; session refresh failed: ${detail}`
        }
      }
      setControlError(failure.message)
    } finally {
      setControlBusy(null)
    }
  }

  const renameSession = async (): Promise<void> => {
    if (settingsBusy !== null || titleDraft.trim() === '') return
    setSettingsBusy('rename')
    setSettingsError(null)
    setSettingsNotice(null)
    try {
      const accepted = await operations.renameSession(session.id, titleDraft)
      try {
        await refreshAuthoritativeSession()
      } catch (reason) {
        onSessionChanged(accepted)
        const detail = reason instanceof Error ? reason.message : String(reason)
        setSettingsError(`Session renamed, but authoritative refresh failed: ${detail}`)
      }
      setRenaming(false)
      setSettingsNotice('Session renamed')
    } catch (reason) {
      const failure = mutationFailure('Rename', reason)
      if (failure.refresh) {
        try {
          await refreshAuthoritativeSession()
        } catch (refreshReason) {
          const detail = refreshReason instanceof Error ? refreshReason.message : String(refreshReason)
          failure.message = `${failure.message}; session refresh failed: ${detail}`
        }
      }
      setSettingsError(failure.message)
    } finally {
      setSettingsBusy(null)
    }
  }

  const permissionState = snapshot.session?.state ?? session.state
  const permissionActivity = snapshot.activity ?? session.activity
  const permissionModeLegal = canChangePermissionMode(permissionState, permissionActivity)
  const updatePermissionMode = async (): Promise<void> => {
    if (settingsBusy !== null || permissionDraft === '' || permissionDraft === currentPermissionMode) return
    setSettingsBusy('permission')
    setSettingsError(null)
    setSettingsNotice(null)
    try {
      const accepted = await operations.setPermissionMode(session.id, permissionDraft)
      try {
        await refreshAuthoritativeSession()
      } catch (reason) {
        onSessionChanged(accepted)
        const detail = reason instanceof Error ? reason.message : String(reason)
        setSettingsError(`Permission mode updated, but authoritative refresh failed: ${detail}`)
      }
      setSettingsNotice('Permission mode updated; it applies on the next launch')
    } catch (reason) {
      const failure = mutationFailure('Permission mode', reason)
      if (failure.refresh) {
        try {
          await refreshAuthoritativeSession()
        } catch (refreshReason) {
          const detail = refreshReason instanceof Error ? refreshReason.message : String(refreshReason)
          failure.message = `${failure.message}; session refresh failed: ${detail}`
        }
      }
      setSettingsError(failure.message)
    } finally {
      setSettingsBusy(null)
    }
  }

  return (
    <main className="gc-main gc-session" data-session-id={session.id} aria-label={`Session ${session.title || session.id}`}>
      <header>
        <div>
          <h2>{session.title || session.id}</h2>
          <span>{session.provider}</span>
        </div>
        <span>{snapshot.activity ?? snapshot.phase}</span>
      </header>
      <section className="gc-session-controls" aria-label="Session controls">
        <label>
          <input
            type="checkbox"
            checked={includeThinking}
            onChange={event => {
              writeThinkingPreference(event.currentTarget.checked)
              setIncludeThinking(event.currentTarget.checked)
            }}
          />
          Show reasoning
        </label>
        <button type="button" disabled={settingsBusy !== null} onClick={() => setRenaming(current => !current)}>
          Rename session
        </button>
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
      {provider?.compatibility_error !== undefined && (
        <p role="alert">Provider settings unavailable: {provider.compatibility_error}</p>
      )}
      {(renaming || (permissionOption !== undefined && permissionOption.choices.length > 0)) && (
        <section className="gc-session-settings" aria-label="Session settings">
          {renaming && (
            <>
              <label>
                New session title
                <input
                  aria-label="New session title"
                  value={titleDraft}
                  disabled={settingsBusy !== null}
                  onChange={event => setTitleDraft(event.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                disabled={settingsBusy !== null || titleDraft.trim() === '' || titleDraft.trim() === session.title}
                onClick={() => void renameSession()}
              >
                Save title
              </button>
              <button
                type="button"
                disabled={settingsBusy !== null}
                onClick={() => {
                  setTitleDraft(session.title || session.id)
                  setRenaming(false)
                }}
              >
                Cancel rename
              </button>
            </>
          )}
          {permissionOption !== undefined && permissionOption.choices.length > 0 && (
            <>
              <label>
                {permissionOption.label || 'Permission mode'}
                <select
                  aria-label="Permission mode"
                  value={permissionDraft}
                  disabled={settingsBusy !== null || !permissionModeLegal}
                  onChange={event => setPermissionDraft(event.currentTarget.value)}
                >
                  {permissionOption.choices.map(choice => (
                    <option key={choice.value} value={choice.value}>{choice.label || choice.value}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={settingsBusy !== null || !permissionModeLegal || permissionDraft === '' || permissionDraft === currentPermissionMode}
                onClick={() => void updatePermissionMode()}
              >
                Apply permission mode
              </button>
              <span>
                {permissionModeLegal
                  ? 'Applies on the next launch or wake.'
                  : 'Suspend the idle session before changing a mode that applies on the next launch.'}
              </span>
            </>
          )}
        </section>
      )}
      {settingsNotice !== null && <p role="status">{settingsNotice}</p>}
      {settingsError !== null && <p role="alert">{settingsError}</p>}
      {controlNotice !== null && <p role="status">{controlNotice}</p>}
      {controlError !== null && <p role="alert">{controlError}</p>}
      {bootstrapError !== null && <p role="alert">{bootstrapError}</p>}
      {snapshot.issue !== undefined && <p role="alert">Transcript stream: {snapshot.issue.message}</p>}
      {snapshot.resetNotice !== null && <p role="status">Transcript reset: {snapshot.resetNotice.reason}</p>}
      {snapshot.transcript?.degraded === true && (
        <p role="alert">Transcript degraded{snapshot.transcript.degradedReason === undefined ? '' : `: ${snapshot.transcript.degradedReason}`}</p>
      )}
      {(snapshot.transcript?.diagnostics?.length ?? 0) > 0 && (
        <aside className="gc-operation" aria-label="Transcript diagnostics">
          {snapshot.transcript?.diagnostics?.map(diagnostic => (
            <p key={diagnostic.code}>
              {diagnostic.code}{diagnostic.message === undefined ? '' : `: ${diagnostic.message}`}
              {diagnostic.count === undefined ? '' : ` (${diagnostic.count})`}
            </p>
          ))}
        </aside>
      )}
      <section className="gc-transcript" aria-label="Transcript">
        {snapshot.transcript?.messages.map(message => (
          <article className="gc-message" key={message.id} data-role={message.role} data-status={message.status}>
            <span className="gc-message-role">{message.role}</span>
            {messageBlocks(message)}
          </article>
        ))}
      </section>
      <PendingInteractions controller={controller} pending={snapshot.pending} />
      {submission !== null && (
        <SubmissionOperation
          watcher={submission.watcher}
          prompt={submission.prompt}
          onSucceeded={() => {
            setSubmission(null)
            setSubmissionNotice({ label: 'Submitted', prompt: submission.prompt })
          }}
          onFailed={detail => {
            setSubmission(null)
            setDraft(submission.prompt)
            setSubmitError(`Submission failed: ${detail}`)
          }}
          onOutcomeUnknown={detail => void handleSubmitOutcomeUnknown(submission.prompt, detail)}
        />
      )}
      {submissionNotice !== null && (
        <aside className="gc-operation" aria-label="Submission status">
          <strong>{submissionNotice.label}</strong>
          <p>{submissionNotice.prompt}</p>
        </aside>
      )}
      {submitError !== null && <p role="alert">{submitError}</p>}
      {submitRetryBlocked && (
        <button type="button" onClick={() => {
          setSubmitRetryBlocked(false)
          setSubmitError(null)
        }}>
          I checked the transcript; allow retry
        </button>
      )}
      <section className="gc-composer" aria-label="Composer">
        <label>
          <span>Message {session.title || session.id}</span>
          <textarea
            aria-label={`Message ${session.title || session.id}`}
            value={draft}
            disabled={sending || submission !== null}
            onChange={event => setDraft(event.currentTarget.value)}
          />
        </label>
        <button type="button" disabled={sending || submission !== null || submitRetryBlocked || draft.trim() === ''} onClick={() => void submit()}>Send</button>
        {session.submission_capabilities?.supports_follow_up === true && (
          <button type="button" disabled={sending || submission !== null || submitRetryBlocked || draft.trim() === ''} onClick={() => void submit('follow_up')}>
            Follow up
          </button>
        )}
        {session.submission_capabilities?.supports_interrupt_now === true && (
          <button type="button" disabled={sending || submission !== null || submitRetryBlocked || draft.trim() === ''} onClick={() => void submit('interrupt_now')}>
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
  onSucceeded,
  onFailed,
  onOutcomeUnknown,
}: {
  watcher: CityOperationWatcher
  prompt: string
  onSucceeded: () => void
  onFailed: (detail: string) => void
  onOutcomeUnknown: (detail: string) => void
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(watcher.subscribe, watcher.getSnapshot)
  const terminalHandled = useRef(false)
  useEffect(() => () => watcher.dispose(), [watcher])
  useEffect(() => {
    if (terminalHandled.current) return
    if (snapshot.phase === 'succeeded') {
      terminalHandled.current = true
      onSucceeded()
      return
    }
    if (snapshot.phase === 'outcome_unknown') {
      terminalHandled.current = true
      onOutcomeUnknown(operationOutcomeUnknownDetail(snapshot))
      return
    }
    if (snapshot.phase === 'failed' && snapshot.terminal !== null) {
      terminalHandled.current = true
      const payload = snapshot.terminal.payload
      const detail = typeof payload === 'object' && payload !== null && 'error_message' in payload
        && typeof payload.error_message === 'string'
        ? payload.error_message
        : 'Supervisor reported request failure'
      onFailed(detail)
    }
  }, [onFailed, onOutcomeUnknown, onSucceeded, snapshot.phase, snapshot.terminal, snapshot.unknownReason])
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
