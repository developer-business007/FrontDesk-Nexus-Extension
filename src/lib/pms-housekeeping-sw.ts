import {
  FunctionsFetchError,
  FunctionsHttpError,
  type SupabaseClient,
} from '@supabase/supabase-js'

export type PmsHousekeepingStatus = 'clean' | 'dirty'

async function readErrorPayload(error: FunctionsHttpError): Promise<string | null> {
  const response = error.context as Response | undefined
  if (!response) return null
  try {
    const body = (await response.json()) as Record<string, unknown>
    if (typeof body.error === 'string' && body.error.trim()) return body.error
    if (typeof body.message === 'string' && body.message.trim()) return body.message
  } catch {
    // ignore
  }
  return null
}

export async function requestPmsHousekeeping(
  client: SupabaseClient,
  input: { roomNumbers: string[]; status: PmsHousekeepingStatus },
): Promise<{ ok: boolean; error: string | null; message: string | null }> {
  const { data, error } = await client.functions.invoke('request-pms-housekeeping', {
    body: {
      roomNumbers: input.roomNumbers,
      status: input.status,
    },
  })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const msg = await readErrorPayload(error)
      if (msg) return { ok: false, error: msg, message: null }
    }
    if (error instanceof FunctionsFetchError || error.message.includes('Failed to send')) {
      return {
        ok: false,
        error: 'Housekeeping function not reachable. Deploy request-pms-housekeeping to Supabase.',
        message: null,
      }
    }
    return { ok: false, error: error.message, message: null }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Invalid server response', message: null }
  }

  const row = data as Record<string, unknown>
  if (typeof row.error === 'string' && row.error.trim()) {
    return { ok: false, error: row.error, message: null }
  }
  if (row.ok !== true) {
    return { ok: false, error: 'Request failed', message: null }
  }

  const message =
    typeof row.message === 'string' && row.message.trim()
      ? row.message
      : `Queued ${input.roomNumbers.length} room(s) to mark ${input.status}.`

  const warnings = Array.isArray(row.warnings)
    ? row.warnings.filter((w): w is string => typeof w === 'string')
    : []
  const fullMessage =
    warnings.length > 0 ? `${message} (${warnings.join('; ')})` : message

  return { ok: true, error: null, message: fullMessage }
}
