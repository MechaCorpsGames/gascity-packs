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

async function gatewayError(response: Response): Promise<Error> {
  try {
    const problem = await response.json() as Record<string, unknown>
    if (typeof problem.detail === 'string' && problem.detail !== '') return new Error(problem.detail)
    if (typeof problem.title === 'string' && problem.title !== '') return new Error(problem.title)
  } catch {
    // Fall back to the received status when the body is not Problem Details.
  }
  return new Error(`Gas City gateway returned HTTP ${response.status}`)
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
  options?: Record<string, string>
  submission_capabilities?: {
    supports_follow_up: boolean
    supports_interrupt_now: boolean
  }
}

export interface ProviderOptionChoice {
  value: string
  label: string
}

export interface ProviderOption {
  key: string
  label: string
  type: string
  default: string
  choices: ProviderOptionChoice[]
}

export interface ProviderPublicSummary {
  name: string
  display_name?: string
  builtin: boolean
  city_level: boolean
  options_schema?: ProviderOption[]
  effective_defaults?: Record<string, string>
  compatibility_error?: string
}

interface ListResponse<T> {
  items: T[]
  total: number
  next_cursor?: string
  partial?: boolean
  partial_errors?: string[]
}

type JsonObject = Record<string, unknown>

function contractError(scope: string, detail: string): Error {
  return new Error(`Incompatible Supervisor ${scope} response: ${detail}`)
}

function objectValue(value: unknown, scope: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw contractError(scope, 'must be an object')
  return value as JsonObject
}

function stringValue(value: unknown, scope: string): string {
  if (typeof value !== 'string') throw contractError(scope, 'must be a string')
  return value
}

function booleanValue(value: unknown, scope: string): boolean {
  if (typeof value !== 'boolean') throw contractError(scope, 'must be a boolean')
  return value
}

function numberValue(value: unknown, scope: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw contractError(scope, 'must be a non-negative safe integer')
  }
  return value
}

function optionalString(value: unknown, scope: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, scope)
}

function optionalStringArray(value: unknown, scope: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw contractError(scope, 'must be an array')
  return value.map((item, index) => stringValue(item, `${scope}[${index}]`))
}

function optionalStringRecord(value: unknown, scope: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  const object = objectValue(value, scope)
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, stringValue(item, `${scope}.${key}`)]))
}

function parseList<T>(value: unknown, scope: string, parseItem: (item: unknown, index: number) => T): ListResponse<T> {
  const object = objectValue(value, scope)
  if (!Array.isArray(object.items)) throw contractError(scope, 'items must be an array')
  return {
    items: object.items.map(parseItem),
    total: numberValue(object.total, `${scope}.total`),
    ...(optionalString(object.next_cursor, `${scope}.next_cursor`) === undefined ? {} : { next_cursor: object.next_cursor as string }),
    ...(object.partial === undefined ? {} : { partial: booleanValue(object.partial, `${scope}.partial`) }),
    ...(optionalStringArray(object.partial_errors, `${scope}.partial_errors`) === undefined
      ? {}
      : { partial_errors: object.partial_errors as string[] }),
  }
}

function parseRig(value: unknown, index: number): RigSummary {
  const scope = `rigs.items[${index}]`
  const object = objectValue(value, scope)
  return {
    name: stringValue(object.name, `${scope}.name`),
    path: stringValue(object.path, `${scope}.path`),
    suspended: booleanValue(object.suspended, `${scope}.suspended`),
    agent_count: numberValue(object.agent_count, `${scope}.agent_count`),
    running_count: numberValue(object.running_count, `${scope}.running_count`),
  }
}

function parseAgent(value: unknown, index: number): AgentSummary {
  const scope = `agents.items[${index}]`
  const object = objectValue(value, scope)
  return {
    name: stringValue(object.name, `${scope}.name`),
    running: booleanValue(object.running, `${scope}.running`),
    suspended: booleanValue(object.suspended, `${scope}.suspended`),
    available: booleanValue(object.available, `${scope}.available`),
    state: stringValue(object.state, `${scope}.state`),
    ...(optionalString(object.rig, `${scope}.rig`) === undefined ? {} : { rig: object.rig as string }),
    ...(optionalString(object.description, `${scope}.description`) === undefined ? {} : { description: object.description as string }),
    ...(optionalString(object.provider, `${scope}.provider`) === undefined ? {} : { provider: object.provider as string }),
  }
}

export function parseSessionSummary(value: unknown, scope = 'session'): SessionSummary {
  const object = objectValue(value, scope)
  let submissionCapabilities: SessionSummary['submission_capabilities']
  if (object.submission_capabilities !== undefined) {
    const capabilities = objectValue(object.submission_capabilities, `${scope}.submission_capabilities`)
    submissionCapabilities = {
      supports_follow_up: booleanValue(capabilities.supports_follow_up, `${scope}.submission_capabilities.supports_follow_up`),
      supports_interrupt_now: booleanValue(capabilities.supports_interrupt_now, `${scope}.submission_capabilities.supports_interrupt_now`),
    }
  }
  return {
    id: stringValue(object.id, `${scope}.id`),
    template: stringValue(object.template, `${scope}.template`),
    state: stringValue(object.state, `${scope}.state`),
    title: stringValue(object.title, `${scope}.title`),
    provider: stringValue(object.provider, `${scope}.provider`),
    session_name: stringValue(object.session_name, `${scope}.session_name`),
    created_at: stringValue(object.created_at, `${scope}.created_at`),
    running: booleanValue(object.running, `${scope}.running`),
    ...(optionalString(object.activity, `${scope}.activity`) === undefined ? {} : { activity: object.activity as string }),
    ...(optionalStringRecord(object.options, `${scope}.options`) === undefined ? {} : { options: object.options as Record<string, string> }),
    ...(submissionCapabilities === undefined ? {} : { submission_capabilities: submissionCapabilities }),
  }
}

function parseProvider(value: unknown, index: number): ProviderPublicSummary {
  const scope = `providers.items[${index}]`
  const object = objectValue(value, scope)
  const name = stringValue(object.name, `${scope}.name`)
  const base: ProviderPublicSummary = {
    name,
    builtin: booleanValue(object.builtin, `${scope}.builtin`),
    city_level: booleanValue(object.city_level, `${scope}.city_level`),
    ...(optionalString(object.display_name, `${scope}.display_name`) === undefined ? {} : { display_name: object.display_name as string }),
    ...(optionalStringRecord(object.effective_defaults, `${scope}.effective_defaults`) === undefined
      ? {}
      : { effective_defaults: object.effective_defaults as Record<string, string> }),
  }
  if (object.options_schema === undefined) return base
  try {
    if (!Array.isArray(object.options_schema)) throw new Error('options_schema must be an array')
    const options = object.options_schema.map((optionValue, optionIndex): ProviderOption => {
      const option = objectValue(optionValue, `${scope}.options_schema[${optionIndex}]`)
      if (!Array.isArray(option.choices)) throw new Error('choices must be an array')
      return {
        key: stringValue(option.key, `${scope}.options_schema[${optionIndex}].key`),
        label: stringValue(option.label, `${scope}.options_schema[${optionIndex}].label`),
        type: stringValue(option.type, `${scope}.options_schema[${optionIndex}].type`),
        default: stringValue(option.default, `${scope}.options_schema[${optionIndex}].default`),
        choices: option.choices.map((choiceValue, choiceIndex) => {
          const choice = objectValue(choiceValue, `${scope}.options_schema[${optionIndex}].choices[${choiceIndex}]`)
          return {
            value: stringValue(choice.value, `${scope}.options_schema[${optionIndex}].choices[${choiceIndex}].value`),
            label: stringValue(choice.label, `${scope}.options_schema[${optionIndex}].choices[${choiceIndex}].label`),
          }
        }),
      }
    })
    return { ...base, options_schema: options }
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message.replace(/^Incompatible Supervisor [^:]+ response: /, '') : String(reason)
    return { ...base, compatibility_error: `Provider ${name} options are incompatible: ${detail}` }
  }
}

function optionalCursor(cursor: string | undefined): { nextSessionCursor?: string } {
  return cursor === undefined || cursor === '' ? {} : { nextSessionCursor: cursor }
}

export interface CityTopology {
  rigs: RigSummary[]
  agents: AgentSummary[]
  providers: ProviderPublicSummary[]
  sessions: SessionSummary[]
  sessionTotal: number
  sessionPartial: boolean
  sessionPartialErrors: string[]
  nextSessionCursor?: string
}

function cityBase(connectionId: string, cityName: string): string {
  return `/api/gas-city/v1/connections/${encodeURIComponent(connectionId)}/city/${encodeURIComponent(cityName)}`
}

export interface SessionPage {
  sessions: SessionSummary[]
  total: number
  partial: boolean
  partialErrors: string[]
  nextSessionCursor?: string
}

export async function loadSessionPage(
  connectionId: string,
  cityName: string,
  cursor: string,
  signal: AbortSignal,
): Promise<SessionPage> {
  const query = new URLSearchParams({ state: 'all', cursor })
  const page = await loadList(`${cityBase(connectionId, cityName)}/sessions?${query.toString()}`, signal, 'sessions', (item, index) => (
    parseSessionSummary(item, `sessions.items[${index}]`)
  ))
  return {
    sessions: page.items,
    total: page.total,
    partial: page.partial === true,
    partialErrors: page.partial_errors ?? [],
    ...optionalCursor(page.next_cursor),
  }
}

export async function loadConnectionInventory(signal: AbortSignal): Promise<ConnectionInventory> {
  const response = await fetch('/api/gas-city/v1/connections', {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw await gatewayError(response)
  const value = objectValue(await response.json(), 'connections')
  if (!Array.isArray(value.connections)) throw contractError('connections', 'connections must be an array')
  return {
    connections: value.connections.map((item, index) => {
      const scope = `connections.connections[${index}]`
      const object = objectValue(item, scope)
      return {
        id: stringValue(object.id, `${scope}.id`),
        label: stringValue(object.label, `${scope}.label`),
        cities: optionalStringArray(object.cities, `${scope}.cities`) ?? [],
        available: booleanValue(object.available, `${scope}.available`),
        ...(optionalString(object.diagnostic, `${scope}.diagnostic`) === undefined ? {} : { diagnostic: object.diagnostic as string }),
      }
    }),
  }
}

export async function loadCities(connectionId: string, signal: AbortSignal): Promise<CityInventory> {
  const response = await fetch(`/api/gas-city/v1/connections/${encodeURIComponent(connectionId)}/cities`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw await gatewayError(response)
  const list = parseList(await response.json(), 'cities', (item, index): CitySummary => {
    const scope = `cities.items[${index}]`
    const object = objectValue(item, scope)
    return {
      name: stringValue(object.name, `${scope}.name`),
      path: stringValue(object.path, `${scope}.path`),
      running: booleanValue(object.running, `${scope}.running`),
      ...(optionalString(object.status, `${scope}.status`) === undefined ? {} : { status: object.status as string }),
      ...(optionalString(object.error, `${scope}.error`) === undefined ? {} : { error: object.error as string }),
      ...(optionalStringArray(object.phases_completed, `${scope}.phases_completed`) === undefined
        ? {}
        : { phases_completed: object.phases_completed as string[] }),
    }
  })
  return { items: list.items, total: list.total }
}

async function loadList<T>(
  path: string,
  signal: AbortSignal,
  scope: string,
  parseItem: (item: unknown, index: number) => T,
): Promise<ListResponse<T>> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, signal })
  if (!response.ok) throw await gatewayError(response)
  return parseList(await response.json(), scope, parseItem)
}

export async function loadCityTopology(
  connectionId: string,
  cityName: string,
  signal: AbortSignal,
): Promise<CityTopology> {
  const base = cityBase(connectionId, cityName)
  const [rigs, agents, providers, sessions] = await Promise.all([
    loadList(`${base}/rigs`, signal, 'rigs', parseRig),
    loadList(`${base}/agents`, signal, 'agents', parseAgent),
    loadList(`${base}/providers/public`, signal, 'providers', parseProvider),
    loadList(`${base}/sessions?state=all`, signal, 'sessions', (item, index) => (
      parseSessionSummary(item, `sessions.items[${index}]`)
    )),
  ])
  return {
    rigs: rigs.items,
    agents: agents.items,
    providers: providers.items,
    sessions: sessions.items,
    sessionTotal: sessions.total,
    sessionPartial: sessions.partial === true,
    sessionPartialErrors: sessions.partial_errors ?? [],
    ...optionalCursor(sessions.next_cursor),
  }
}
