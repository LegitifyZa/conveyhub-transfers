import { apiRequest } from './httpClient'

// Authenticated v1 document lane (BFF -> FastAPI). Envelope: { message, data }.
// Document readback is metadata-only by design — storage keys, file paths and
// uploader identity are never projected to the client.

export interface MatterDocument {
  id: string
  transferId: string
  catalogueDocumentId?: string | null
  name: string
  status: 'pending' | 'uploaded' | 'verified' | 'rejected' | 'not_required'
  notes?: string | null
  fileSize?: number | null
  fileType?: string | null
  originalFileName?: string | null
  requirementKey?: string | null
  scanStatus?: 'not_scanned' | 'pending' | 'clean' | 'infected' | 'error' | null
  uploadedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface DocumentRequirement {
  id: string
  requirementKey: string
  displayName: string
  source: 'baseline' | 'conditional'
  conditionKey?: string | null
  status: 'active' | 'withdrawn'
  satisfiedDocumentId?: string | null
  linkedDocumentId?: string | null
}

export interface UnevaluatedRule {
  ruleKey: string
  conditionKey?: string | null
}

export interface MatterDocumentsResult {
  documents: MatterDocument[]
  requirements: DocumentRequirement[]
  // Missing matter facts (e.g. the matter records no classification) and
  // active rules that could not be decided. When non-empty the requirement
  // list is visibly incomplete — never a confirmed "no requirements".
  unevaluatedFacts: string[]
  unevaluatedRules: UnevaluatedRule[]
}

interface Envelope<T> {
  message: string
  data: T
}

export async function fetchMatterDocuments(transferId: string): Promise<MatterDocumentsResult> {
  const response = await apiRequest<Envelope<MatterDocumentsResult>>(
    `/api/v1/transfers/${transferId}/documents`
  )
  return {
    documents: response.data.documents,
    requirements: response.data.requirements,
    unevaluatedFacts: response.data.unevaluatedFacts ?? [],
    unevaluatedRules: response.data.unevaluatedRules ?? [],
  }
}

export async function createMatterDocument(
  transferId: string,
  payload: { name: string; requirementKey?: string; notes?: string; clientRequestId: string }
): Promise<MatterDocument> {
  const response = await apiRequest<Envelope<MatterDocument>>(
    `/api/v1/transfers/${transferId}/documents`,
    {
      method: 'POST',
      body: {
        name: payload.name,
        requirement_key: payload.requirementKey,
        notes: payload.notes,
        client_request_id: payload.clientRequestId,
      },
    }
  )
  return response.data
}

export async function uploadMatterDocumentFile(
  transferId: string,
  documentId: string,
  file: File
): Promise<{ document: MatterDocument; outcome: string }> {
  const form = new FormData()
  form.append('file', file)
  const response = await apiRequest<Envelope<{ document: MatterDocument; outcome: string }>>(
    `/api/v1/transfers/${transferId}/documents/${documentId}/file`,
    { method: 'POST', body: form }
  )
  return response.data
}

// Re-scan the stored object without re-uploading — the recovery path when a
// scan did not complete (scanStatus 'pending'/'error'). Clean/infected
// verdicts are final and replay unchanged.
export async function rescanMatterDocumentFile(
  transferId: string,
  documentId: string
): Promise<{ document: MatterDocument; outcome: string }> {
  const response = await apiRequest<Envelope<{ document: MatterDocument; outcome: string }>>(
    `/api/v1/transfers/${transferId}/documents/${documentId}/rescan`,
    { method: 'POST', body: {} }
  )
  return response.data
}

export async function recalculateDocumentRequirements(
  transferId: string
): Promise<Pick<MatterDocumentsResult, 'requirements' | 'unevaluatedFacts' | 'unevaluatedRules'>> {
  const response = await apiRequest<
    Envelope<Pick<MatterDocumentsResult, 'requirements' | 'unevaluatedFacts' | 'unevaluatedRules'>>
  >(
    `/api/v1/transfers/${transferId}/documents/requirements/recalculate`,
    { method: 'POST', body: {} }
  )
  return {
    requirements: response.data.requirements,
    unevaluatedFacts: response.data.unevaluatedFacts ?? [],
    unevaluatedRules: response.data.unevaluatedRules ?? [],
  }
}

export async function issueDocumentDownloadLink(
  transferId: string,
  documentId: string
): Promise<{ downloadUrl: string; expires: number }> {
  const response = await apiRequest<Envelope<{ downloadUrl: string; expires: number }>>(
    `/api/v1/transfers/${transferId}/documents/${documentId}/download-link`,
    { method: 'POST', body: {} }
  )
  return response.data
}
