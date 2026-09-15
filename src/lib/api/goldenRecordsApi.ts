import { apiRequest, ApiRequestError } from './http'

export type GoldenRecordEntityType = 'person' | 'company' | 'trust'

export type GoldenRecordSearchStatus = 'matched' | 'not_found' | 'ambiguous'

export interface GoldenRecordCandidate {
  goldenRecordId: string
  entityType: GoldenRecordEntityType
  name: string | null
  idNumber: string | null
  email: string | null
  registrationNo?: string | null
  mastersOffice?: string | null
  isTrust?: boolean
}

export interface GoldenRecordSearchData {
  status: GoldenRecordSearchStatus
  entityType: GoldenRecordEntityType
  record?: GoldenRecordCandidate
  candidates?: GoldenRecordCandidate[]
}

interface GoldenRecordSearchEnvelope {
  message: string
  data: GoldenRecordSearchData
}

export interface GoldenRecordSearchRequest {
  entity_type: GoldenRecordEntityType
  query: string
}

export interface GoldenRecord {
  id: string
  goldenRecordId: string
  entityType: GoldenRecordEntityType
  name: string
  idNumber: string
  registrationNo?: string | null
  registrationNumber?: string
  mastersOffice?: string | null
  isTrust?: boolean
  email?: string
  phone?: string
  address?: string
  propertyAddress?: string
  propertyValue?: number
}

export function candidateToGoldenRecord(candidate: GoldenRecordCandidate): GoldenRecord {
  return {
    id: candidate.goldenRecordId,
    goldenRecordId: candidate.goldenRecordId,
    entityType: candidate.entityType,
    name: candidate.name ?? '',
    idNumber: candidate.idNumber ?? '',
    email: candidate.email ?? undefined,
    ...(candidate.entityType !== 'person' ? {
      registrationNo: candidate.registrationNo,
      registrationNumber: candidate.registrationNo ?? undefined,
      mastersOffice: candidate.mastersOffice,
      isTrust: candidate.isTrust
    } : {})
  }
}

export function goldenRecordCandidateDescription(candidate: GoldenRecordCandidate): string {
  return [
    candidate.entityType === 'person' ? 'Person' : candidate.entityType === 'trust' ? 'Trust' : 'Company',
    candidate.entityType === 'person'
      ? candidate.idNumber ?? 'No ID number'
      : `Registration: ${candidate.registrationNo ?? 'Not available'}`,
    ...(candidate.entityType === 'trust' ? [`Master’s Office: ${candidate.mastersOffice ?? 'Not available'}`] : []),
    candidate.email
  ].filter(Boolean).join(' · ')
}

export type GoldenRecordSearchErrorKind = 'invalid' | 'auth' | 'server'

export class GoldenRecordSearchError extends Error {
  constructor(public readonly kind: GoldenRecordSearchErrorKind) {
    super(kind === 'invalid'
      ? 'Enter a search query of 1–200 characters.'
      : kind === 'auth'
        ? 'Golden Record search requires an authorized session.'
        : 'Golden Record search is temporarily unavailable. Please try again later.')
    this.name = 'GoldenRecordSearchError'
  }
}

export type GoldenRecordRetrievalErrorKind = 'invalid' | 'auth' | 'not_visible' | 'server'

export class GoldenRecordRetrievalError extends Error {
  constructor(public readonly kind: GoldenRecordRetrievalErrorKind) {
    super({
      invalid: 'Select a valid Golden Record and entity type.',
      auth: 'Golden Record retrieval requires an authorized session.',
      not_visible: 'Unknown or inaccessible Golden Record.',
      server: 'Golden Record details are temporarily unavailable. Please try again later.'
    }[kind])
    this.name = 'GoldenRecordRetrievalError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isCandidate(value: unknown, entityType: GoldenRecordEntityType): value is GoldenRecordCandidate & Record<string, unknown> {
  if (!isObject(value) || typeof value.goldenRecordId !== 'string' || !UUID_PATTERN.test(value.goldenRecordId)
    || value.entityType !== entityType || !['name', 'idNumber', 'email'].every(key => isNullableText(value[key]))) return false
  return entityType === 'person'
    ? value.isTrust === undefined && value.registrationNo === undefined && value.mastersOffice === undefined
    : value.isTrust === (entityType === 'trust') && isNullableText(value.registrationNo) && isNullableText(value.mastersOffice)
}

export class GoldenRecordsApi {
  static async retrieve(
    goldenRecordId: string,
    entityType: GoldenRecordEntityType,
    options: { bearerToken?: string } = {}
  ): Promise<GoldenRecord> {
    if (typeof goldenRecordId !== 'string' || !UUID_PATTERN.test(goldenRecordId)
      || !['person', 'company', 'trust'].includes(entityType)) {
      throw new GoldenRecordRetrievalError('invalid')
    }
    const id = goldenRecordId.toLowerCase()
    try {
      const response = await apiRequest<unknown>(`/api/v1/golden-records/${id}?entity_type=${entityType}`, {
        method: 'GET',
        cache: 'no-store',
        ...(options.bearerToken ? { headers: { Authorization: `Bearer ${options.bearerToken}` } } : {})
      })
      if (!isObject(response) || !isCandidate(response.data, entityType)
        || response.data.goldenRecordId.toLowerCase() !== id
        || !isNullableText(response.data.phone) || !isNullableText(response.data.address)) {
        throw new GoldenRecordRetrievalError('server')
      }
      return {
        ...candidateToGoldenRecord(response.data),
        id,
        goldenRecordId: id,
        phone: response.data.phone?.trim() || undefined,
        address: response.data.address?.trim() || undefined
      }
    } catch (error) {
      if (error instanceof GoldenRecordRetrievalError) throw error
      if (error instanceof ApiRequestError) {
        if (error.status === 400 || error.status === 404) throw new GoldenRecordRetrievalError('not_visible')
        if (error.status === 422) throw new GoldenRecordRetrievalError('invalid')
        if (error.status === 401 || error.status === 403) throw new GoldenRecordRetrievalError('auth')
      }
      throw new GoldenRecordRetrievalError('server')
    }
  }

  static async search(
    request: GoldenRecordSearchRequest,
    options: { bearerToken?: string } = {}
  ): Promise<GoldenRecordSearchData> {
    const query = typeof request.query === 'string' ? request.query.trim() : ''
    if (!query || Array.from(query).length > 200 || !['person', 'company', 'trust'].includes(request.entity_type)) {
      throw new GoldenRecordSearchError('invalid')
    }
    try {
      const response = await apiRequest<GoldenRecordSearchEnvelope>(
        '/api/v1/golden-records/search',
        {
          method: 'POST',
          body: { entity_type: request.entity_type, query },
          ...(options.bearerToken ? { headers: { Authorization: `Bearer ${options.bearerToken}` } } : {})
        }
      )
      if (!response.data || !['matched', 'not_found', 'ambiguous'].includes(response.data.status)
        || response.data.entityType !== request.entity_type
        || (response.data.status === 'matched' && !isCandidate(response.data.record, request.entity_type))
        || (response.data.status === 'ambiguous' && (!Array.isArray(response.data.candidates)
          || !response.data.candidates.length || !response.data.candidates.every(candidate => isCandidate(candidate, request.entity_type))))) {
        throw new GoldenRecordSearchError('server')
      }
      return response.data
    } catch (error) {
      if (error instanceof GoldenRecordSearchError) throw error
      if (error instanceof ApiRequestError) {
        if (error.status === 400 || error.status === 422) throw new GoldenRecordSearchError('invalid')
        if (error.status === 401 || error.status === 403) throw new GoldenRecordSearchError('auth')
      }
      throw new GoldenRecordSearchError('server')
    }
  }
}
