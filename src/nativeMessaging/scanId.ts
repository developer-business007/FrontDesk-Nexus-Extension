import type { ParsedIdFields } from '../shared/pms-types'

const ID_KEYS: (keyof ParsedIdFields)[] = [
  'fullName',
  'dateOfBirth',
  'idNumber',
  'idType',
  'issueDate',
  'expiryDate',
  'address',
]

const emptyParsed: ParsedIdFields = {
  fullName: null,
  dateOfBirth: null,
  idNumber: null,
  idType: null,
  issueDate: null,
  expiryDate: null,
  address: null,
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\r/g, '\n').split('\n')[0].trim()
  return t.length ? t : null
}

/**
 * Host sends the same field names as the side panel (`ParsedIdFields`, camelCase).
 * Values may live in `ocr_data` and/or on the `SCAN_RESULT` object; top-level wins.
 */
export function parsedFieldsFromHost(root: Record<string, unknown>): ParsedIdFields {
  const nested =
    root.ocr_data != null && typeof root.ocr_data === 'object' && !Array.isArray(root.ocr_data)
      ? (root.ocr_data as Record<string, unknown>)
      : {}
  const doc =
    root.document_data != null && typeof root.document_data === 'object' && !Array.isArray(root.document_data)
      ? (root.document_data as Record<string, unknown>)
      : {}
  const out: ParsedIdFields = { ...emptyParsed }
  const aliases: Record<keyof ParsedIdFields, string[]> = {
    fullName: ['fullName', 'full_name'],
    dateOfBirth: ['dateOfBirth', 'date_of_birth'],
    idNumber: ['idNumber', 'document_number', 'id_number'],
    idType: ['idType', 'document_type'],
    issueDate: ['issueDate', 'issue_date'],
    expiryDate: ['expiryDate', 'expiry_date'],
    address: ['address'],
  }
  for (const k of ID_KEYS) {
    for (const key of aliases[k]) {
      out[k] = stringOrNull(root[key]) ?? stringOrNull(doc[key]) ?? stringOrNull(nested[key])
      if (out[k]) break
    }
  }
  return out
}
