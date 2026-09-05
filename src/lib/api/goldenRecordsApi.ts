import { apiRequest } from './http'

export type GoldenRecordEntityType = 'person' | 'company' | 'trust'

export type GoldenRecordSearchStatus = 'matched' | 'not_found' | 'ambiguous' | 'unsupported'

export interface GoldenRecordCandidate {
  goldenRecordId: string
  entityType: GoldenRecordEntityType
  name: string | null
  idNumber: string | null
  email: string | null
}

export interface GoldenRecordSearchData {
  status: GoldenRecordSearchStatus
  entityType: GoldenRecordEntityType
  record?: GoldenRecordCandidate
  candidates?: GoldenRecordCandidate[]
  detail?: string
}

interface GoldenRecordSearchEnvelope {
  message: string
  data: GoldenRecordSearchData
}

export type GoldenRecordSearchRequest =
  | { entity_type: 'person'; id_number: string }
  | { entity_type: 'person'; passport_number: string; passport_country: string }
  | { entity_type: 'company' | 'trust' }

export class GoldenRecordsApi {
  static async search(request: GoldenRecordSearchRequest): Promise<GoldenRecordSearchData> {
    const response = await apiRequest<GoldenRecordSearchEnvelope>(
      '/api/v1/golden-records/search',
      { method: 'POST', body: request }
    )
    return response.data
  }
}
