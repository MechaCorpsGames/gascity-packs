function textFromBlock(block) {
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : ''
}

export function sessionEvidence(session, transcript, { expectedTemplate, expectedProvider, nonce }) {
  if (session?.id !== transcript?.id) throw new Error('authoritative session and transcript IDs differ')
  if (expectedTemplate !== undefined && session?.template !== expectedTemplate) {
    throw new Error(`authoritative session template ${session?.template ?? '<missing>'} does not match ${expectedTemplate}`)
  }
  if (expectedTemplate !== undefined && transcript?.template !== expectedTemplate) {
    throw new Error(`authoritative transcript template ${transcript?.template ?? '<missing>'} does not match ${expectedTemplate}`)
  }
  if (session?.provider !== expectedProvider) {
    throw new Error(`authoritative session provider ${session?.provider ?? '<missing>'} does not match ${expectedProvider}`)
  }
  if (transcript?.provider !== expectedProvider) {
    throw new Error(`authoritative transcript provider ${transcript?.provider ?? '<missing>'} does not match ${expectedProvider}`)
  }
  if (transcript?.schema_version !== 'session.structured.v1') {
    throw new Error(`unexpected transcript schema ${transcript?.schema_version ?? '<missing>'}`)
  }
  const messages = Array.isArray(transcript.structured_messages) ? transcript.structured_messages : []
  const finalAssistant = messages.filter(message => message?.role === 'assistant'
    && message?.status === 'final'
    && Array.isArray(message.blocks)
    && message.blocks.some(block => textFromBlock(block).includes(nonce)))
  if (finalAssistant.length === 0) throw new Error(`no final assistant message contains nonce ${nonce}`)
  const blocks = messages.flatMap(message => Array.isArray(message?.blocks) ? message.blocks : [])
  const toolUseIds = blocks
    .filter(block => block?.type === 'tool_use' && typeof block.id === 'string' && block.id !== '')
    .map(block => block.id)
  const toolResultCallIds = blocks
    .filter(block => block?.type === 'tool_result'
      && typeof block.tool_call_id === 'string'
      && block.tool_call_id !== '')
    .map(block => block.tool_call_id)
  return {
    assistantMessageIds: finalAssistant.map(message => message.id),
    provider: session.provider,
    schemaVersion: transcript.schema_version,
    toolResultCallIds,
    toolResultCount: blocks.filter(block => block?.type === 'tool_result').length,
    toolUseIds,
    toolUseCount: blocks.filter(block => block?.type === 'tool_use').length,
  }
}

export function newCompletedToolCallIds(before, after) {
  const previousUses = new Set(before.toolUseIds)
  const previousResults = new Set(before.toolResultCallIds)
  const newResults = new Set(after.toolResultCallIds.filter(id => !previousResults.has(id)))
  return [...new Set(after.toolUseIds)]
    .filter(id => !previousUses.has(id) && newResults.has(id))
}

export async function closeRunOwnedSessions(sessionIds, api) {
  const errors = []
  const remainingSessionIds = []
  for (const id of [...new Set(sessionIds)]) {
    try {
      const before = await api.getSession(id)
      if (before?.state !== 'closed') await api.closeSession(id)
      const after = await api.getSession(id)
      if (after?.state !== 'closed') {
        throw new Error(`state is ${after?.state ?? '<missing>'} after close`)
      }
    } catch (error) {
      remainingSessionIds.push(id)
      errors.push(new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }))
    }
  }
  return { errors, remainingSessionIds }
}
