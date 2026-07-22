import React, { useState } from 'react'
import { FileText, Upload, CheckCircle, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui'
import { Badge } from '@/components/ui'
import { useTransfer, Document } from './TransferForm'
import { TransferApi } from '@/lib/api/transferApi'
import { cn } from '@/utils/cn'

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

const formatFileSize = (bytes?: number) => {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const StepDocuments: React.FC = () => {
  const { state, dispatch } = useTransfer()
  const { documents, id, transfer_id } = state
  const transferId = transfer_id || id
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateDocument = (id: string, updates: Partial<Document>) => {
    dispatch({ type: 'UPDATE_DOCUMENT', payload: { id, updates } })
  }

  const handleFileSelect = async (doc: Document, file: File) => {
    if (!transferId) {
      setErrors(prev => ({ ...prev, [doc.id]: 'Save the transfer before uploading documents' }))
      return
    }

    setUploadingIds(prev => {
      const next = new Set(prev)
      next.add(doc.id)
      return next
    })
    setErrors(prev => ({ ...prev, [doc.id]: '' }))

    try {
      const response = await TransferApi.uploadTransferDocument(transferId, doc.id, file)
      if (response.success && response.data) {
        updateDocument(doc.id, { ...response.data, file })
      } else {
        setErrors(prev => ({ ...prev, [doc.id]: response.error || 'Upload failed' }))
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, [doc.id]: err instanceof Error ? err.message : 'Upload failed' }))
    } finally {
      setUploadingIds(prev => {
        const next = new Set(prev)
        next.delete(doc.id)
        return next
      })
    }
  }

  const handleStatusChange = (docId: string, status: Document['status']) => {
    updateDocument(docId, { status })
  }

  const handleNotesChange = (docId: string, notes: string) => {
    updateDocument(docId, { notes, description: notes })
  }

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

      {documents.length === 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            No documents have been added to this transfer yet. Save the transfer to generate the document list from the catalogue.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {documents.map((doc) => {
          const isUploading = uploadingIds.has(doc.id)
          const docError = errors[doc.id]

          return (
            <Card key={doc.id} variant="glass" className="hover:shadow-premium transition-all duration-200">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center flex-shrink-0">
                      <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {doc.name}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <Badge
                          variant={
                            doc.status === 'verified'
                              ? 'success'
                              : doc.status === 'uploaded'
                                ? 'warning'
                                : doc.status === 'not_required'
                                  ? 'secondary'
                                  : 'default'
                          }
                          size="sm"
                        >
                          {doc.status}
                        </Badge>
                        {doc.catalogueDocumentId && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {getDocumentTypeLabel(doc.type)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <select
                    value={doc.status}
                    onChange={(e) => handleStatusChange(doc.id, e.target.value as Document['status'])}
                    className="px-2 py-1 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                  >
                    <option value="pending">Pending</option>
                    <option value="uploaded">Uploaded</option>
                    <option value="verified">Verified</option>
                    <option value="not_required">Not Required</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={doc.notes || doc.description || ''}
                    onChange={(e) => handleNotesChange(doc.id, e.target.value)}
                    placeholder="Add notes for this document..."
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                  />
                </div>

                {doc.status === 'uploaded' || doc.status === 'verified' ? (
                  <div className="flex items-center gap-3 p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {doc.originalFileName || doc.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {doc.fileType} {doc.fileSize ? `· ${formatFileSize(doc.fileSize)}` : ''}
                        {doc.uploadDate && ` · Uploaded ${new Date(doc.uploadDate).toLocaleDateString()}`}
                      </p>
                    </div>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => e.target.files && e.target.files[0] && handleFileSelect(doc, e.target.files[0])}
                      />
                      <span className="text-xs text-teal-600 dark:text-teal-400 hover:underline">
                        Replace
                      </span>
                    </label>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      Upload File
                    </label>
                    <div className="flex items-center gap-3">
                      <label
                        className={cn(
                          'inline-flex items-center justify-center px-4 py-2 text-sm rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer btn-secondary-premium',
                          isUploading && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <input
                          type="file"
                          className="hidden"
                          disabled={isUploading}
                          onChange={(e) => e.target.files && e.target.files[0] && handleFileSelect(doc, e.target.files[0])}
                        />
                        <Upload className="h-4 w-4 mr-2" />
                        {isUploading ? 'Uploading...' : 'Choose File'}
                      </label>
                    </div>
                  </div>
                )}

                {docError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <span>{docError}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export { StepDocuments }
