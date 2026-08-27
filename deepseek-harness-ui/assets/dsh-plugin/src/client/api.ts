export interface ConnectionSummary {
  id: string
  label: string
  cities: string[]
  available: boolean
  diagnostic?: string
}

export interface ConnectionInventory {
  connections: ConnectionSummary[]
}

export interface CitySummary {
  name: string
  path: string
  running: boolean
  status?: string
  error?: string
  phases_completed?: string[]
}

export interface CityInventory {
  items: CitySummary[]
  total: number
}

export interface RigSummary {
  name: string
  path: string
  suspended: boolean
  agent_count: number
  running_count: number
}

export interface AgentSummary {
  name: string
  rig?: string
  description?: string
  provider?: string
  running: boolean
  suspended: boolean
  available: boolean
  state: string
}

export interface SessionSummary {
  id: string
  template: string
  state: string
  title: string
  provider: string
  session_name: string
  created_at: string
  running: boolean
  activity?: string
  submission_capabilities?: {
    supports_follow_up: boolean
    supports_interrupt_now: boolean
  }
}

interface ListResponse<T> {
  items: T[]
  total: number
  next_cursor?: string
}

export interface CityTopology {
  rigs: RigSummary[]
  agents: AgentSummary[]
  sessions: SessionSummary[]
  nextSessionCursor?: string
}

export async function loadConnectionInventory(signal: AbortSignal): Promise<ConnectionInventory> {
  const response = await fetch('/api/gas-city/v1/connections', {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`Gas City gateway returned HTTP ${response.status}`)
  return await response.json() as ConnectionInventory
}

export async function loadCities(connectionId: string, signal: AbortSignal): Promise<CityInventory> {
  const response = await fetch(`/api/gas-city/v1/connections/${encodeURIComponent(connectionId)}/cities`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`Gas City gateway returned HTTP ${response.status}`)
  return await response.json() as CityInventory
}

async function loadList<T>(path: string, signal: AbortSignal): Promise<ListResponse<T>> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`Gas City gateway returned HTTP ${response.status}`)
  return await response.json() as ListResponse<T>
}

export async function loadCityTopology(
  connectionId: string,
  cityName: string,
  signal: AbortSignal,
): Promise<CityTopology> {
  const base = `/api/gas-city/v1/connections/${encodeURIComponent(connectionId)}/city/${encodeURIComponent(cityName)}`
  const [rigs, agents, sessions] = await Promise.all([
    loadList<RigSummary>(`${base}/rigs`, signal),
    loadList<AgentSummary>(`${base}/agents`, signal),
    loadList<SessionSummary>(`${base}/sessions?state=all`, signal),
  ])
  return {
    rigs: rigs.items,
    agents: agents.items,
    sessions: sessions.items,
    ...(sessions.next_cursor === undefined ? {} : { nextSessionCursor: sessions.next_cursor }),
  }
}
