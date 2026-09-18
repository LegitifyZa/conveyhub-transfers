import React, { useCallback } from 'react'
import { UnavailableNotice } from '@/components/ui'
import { useTransfer, Document } from './TransferForm'
import { MatterDocumentsSection } from './MatterDocumentsSection'
import { MatterDocument } from '@/lib/api/matterDocuments'

export const DOCUMENT_TYPES = [
  { value: 'identification', label: 'Identification Document' },
  { value: 'title_deed', label: 'Title Deed' },
  { value: 'sale_agreement', label: 'Sale Agreement' },
  { value: 'transfer_duty_receipt', label: 'Transfer Duty Receipt' },
  { value: 'rates_clearance', label: 'Rates Clearance Certificate' },
  { value: 'bond_documents', label: 'Bond Documents' },
  { value: 'power_of_attorney', label: 'Power of Attorney' },
  { value: 'proof_of_residence', label: 'Proof of Residence' },
  { value: 'marriage_certificate', label: 'Marriage Certificate' },
  { value: 'fica_documentation', label: 'FICA Documentation' },
  { value: 'other', label: 'Other' }
] as const

const getDocumentTypeLabel = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type)?.label || type
}

// Map server document state onto the wizard's local projection so the
// existing step gate (every document uploaded/not_required) stays honest:
// only a clean, scanned upload counts as 'uploaded'; anything else — no
// file, pending/failed scan, quarantined — remains 'pending'.
function toLocalDocument(doc: MatterDocument): Document {
  return {
    id: doc.id,
    name: doc.name,
    type: 'other',
    catalogueDocumentId: doc.catalogueDocumentId ?? undefined,
    status: doc.status === 'uploaded' && doc.scanStatus === 'clean' ? 'uploaded' : 'pending',
    uploadDate: doc.uploadedAt ?? undefined,
    notes: doc.notes ?? undefined,
    fileSize: doc.fileSize ?? undefined,
    fileType: doc.fileType ?? undefined,
    originalFileName: doc.originalFileName ?? undefined,
  }
}

const StepDocuments: React.FC = () => {
  const { state, dispatch } = useTransfer()
  const transferId = state.transfer_id || state.id

  const syncDocuments = useCallback(
    (documents: MatterDocument[]) => {
      dispatch({ type: 'SET_DOCUMENTS', payload: documents.map(toLocalDocument) })
    },
    [dispatch]
  )

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-5 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Documents
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Upload and manage the required documents for this transfer
        </p>
      </div>

      {!transferId ? (
        <UnavailableNotice
          message="Save the transfer first"
          detail="The matter must be saved before documents can be uploaded."
        />
      ) : (
        <MatterDocumentsSection transferId={transferId} onDocumentsChange={syncDocuments} />
      )}
    </div>
  )
}

export { StepDocuments, getDocumentTypeLabel }
