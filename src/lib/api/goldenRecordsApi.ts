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
        ? 'Golden Record search requires an authorized session. Authentication is not connected in this application yet.'
        : 'Golden Record search is temporarily unavailable. Please try again later.')
    this.name = 'GoldenRecordSearchError'
  }
}

export class GoldenRecordsApi {
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
        || (response.data.status === 'matched' && !response.data.record)
        || (response.data.status === 'ambiguous' && !response.data.candidates?.length)) {
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
