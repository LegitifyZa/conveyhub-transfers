import React, { useEffect, useState } from 'react'
import { FileText, Upload, AlertCircle, Plus } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'

import { apiRequest } from '@/lib/api/http'
import { TransferApi } from '@/lib/api/transferApi'
import { Document as TransferDocument } from './TransferForm'
import { cn } from '@/utils/cn'

interface CatalogueItem {
  id: string
  name: string
  module: string
  status: string
}

interface TransferDocumentsPanelProps {
  transferId: string
}

const formatFileSize = (bytes?: number) => {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TransferDocumentsPanel: React.FC<TransferDocumentsPanelProps> = ({ transferId }) => {
  const [documents, setDocuments] = useState<TransferDocument[]>([])
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [catalogueLoading, setCatalogueLoading] = useState(true)
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selectedCatalogueId, setSelectedCatalogueId] = useState('')
  const [adding, setAdding] = useState(false)

  const loadDocuments = async () => {
    try {
      const response = await apiRequest<{ success: boolean; data: Record<string, unknown>[] }>(`/api/transfers/${transferId}/documents`)
      if (response.success && response.data) {
        setDocuments(response.data.map(doc => ({
          id: String(doc.id || ''),
          name: String(doc.name || ''),
          type: String(doc.type || doc.category || ''),
          catalogueDocumentId: doc.catalogueDocumentId ? String(doc.catalogueDocumentId) : undefined,
          status: (doc.status as TransferDocument['status']) || 'pending',
          uploadDate: doc.uploadDate ? String(doc.uploadDate) : undefined,
          description: doc.description ? String(doc.description) : undefined,
          notes: doc.notes ? String(doc.notes) : undefined,
          filePath: doc.filePath ? String(doc.filePath) : undefined,
          fileSize: typeof doc.fileSize === 'number' ? doc.fileSize : undefined,
          fileType: doc.fileType ? String(doc.fileType) : undefined,
          originalFileName: doc.originalFileName ? String(doc.originalFileName) : undefined
        })))
      }
    } catch (err) {
      console.error('Failed to load transfer documents:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadCatalogue = async () => {
    try {
      const response = await apiRequest<CatalogueItem[]>('/api/catalogue?status=Active')
      setCatalogue(response || [])
    } catch (err) {
      console.error('Failed to load document catalogue:', err)
      setCatalogue([])
    } finally {
      setCatalogueLoading(false)
    }
  }

  useEffect(() => {
    loadDocuments()
    loadCatalogue()
  }, [transferId])

  const availableCatalogue = catalogue.filter(item =>
    item.status === 'Active' && !documents.some(doc => doc.catalogueDocumentId === item.id)
  )

  const updateLocalDocument = (id: string, updates: Partial<TransferDocument>) => {
    setDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, ...updates } : doc))
  }

  const handleFileSelect = async (doc: TransferDocument, file: File) => {
    setUploadingIds(prev => {
      const next = new Set(prev)
      next.add(doc.id)
      return next
    })
    setErrors(prev => ({ ...prev, [doc.id]: '' }))

    try {
      const response = await TransferApi.uploadTransferDocument(transferId, doc.id, file)
      if (response.success && response.data) {
        updateLocalDocument(doc.id, { ...response.data, file })
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

  const persistDocumentUpdate = async (docId: string, updates: { status?: TransferDocument['status']; notes?: string }) => {
    setSavingIds(prev => {
      const next = new Set(prev)
      next.add(docId)
      return next
    })
    setErrors(prev => ({ ...prev, [docId]: '' }))

    try {
      const response = await TransferApi.updateTransferDocument(transferId, docId, updates)
      if (response.success && response.data) {
        updateLocalDocument(docId, response.data)
      } else {
        setErrors(prev => ({ ...prev, [docId]: response.error || 'Update failed' }))
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, [docId]: err instanceof Error ? err.message : 'Update failed' }))
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev)
        next.delete(docId)
        return next
      })
    }
  }

  const handleStatusChange = (docId: string, status: TransferDocument['status']) => {
    updateLocalDocument(docId, { status })
    persistDocumentUpdate(docId, { status })
  }

  const handleNotesChange = (docId: string, notes: string) => {
    updateLocalDocument(docId, { notes, description: notes })
  }

  const handleNotesBlur = (docId: string, notes: string) => {
    persistDocumentUpdate(docId, { notes })
  }

  const handleAddDocument = async () => {
    if (!selectedCatalogueId) return
    setAdding(true)
    setErrors(prev => ({ ...prev, add: '' }))

    try {
      const response = await TransferApi.addTransferDocument(transferId, selectedCatalogueId)
      if (response.success && response.data) {
        setDocuments(prev => [...prev, response.data!])
        setSelectedCatalogueId('')
      } else {
        setErrors(prev => ({ ...prev, add: response.error || 'Failed to add document' }))
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, add: err instanceof Error ? err.message : 'Failed to add document' }))
    } finally {
      setAdding(false)
    }
  }

  if (isLoading || catalogueLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading documents...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <span>Transfer Documents</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {availableCatalogue.length > 0 && (
          <div className="p-4 bg-gray-50 dark:bg-navy-800 rounded-lg space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Add a document from the catalogue
            </label>
            <div className="flex items-center gap-3">
              <select
                value={selectedCatalogueId}
                onChange={(e) => setSelectedCatalogueId(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
              >
                <option value="">Select a document</option>
                {availableCatalogue.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <button
                onClick={handleAddDocument}
                disabled={!selectedCatalogueId || adding}
                className={cn(
                  'inline-flex items-center px-4 py-2 text-sm rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 btn-primary-premium',
                  (!selectedCatalogueId || adding) && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Plus className="h-4 w-4 mr-2" />
                {adding ? 'Adding...' : 'Add'}
              </button>
            </div>
            {errors.add && (
              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {errors.add}
              </p>
            )}
          </div>
        )}

        {documents.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No documents have been added to this transfer. Use the catalogue selector above to add one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-navy-800 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wide">
                <tr>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 w-[30%]">Notes</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3 text-right">Upload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-700">
            {documents.map((doc) => {
              const isUploading = uploadingIds.has(doc.id)
              const isSaving = savingIds.has(doc.id)
              const docError = errors[doc.id]

              return (
                <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-navy-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{doc.name}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {doc.type || doc.fileType || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={doc.status}
                      onChange={(e) => handleStatusChange(doc.id, e.target.value as TransferDocument['status'])}
                      disabled={isSaving}
                      className="px-2 py-1 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200 disabled:opacity-50"
                    >
                      <option value="pending">Pending</option>
                      <option value="uploaded">Uploaded</option>
                      <option value="verified">Verified</option>
                      <option value="not_required">Not Required</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    {docError && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {docError}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      value={doc.notes || doc.description || ''}
                      onChange={(e) => handleNotesChange(doc.id, e.target.value)}
                      onBlur={(e) => handleNotesBlur(doc.id, e.target.value)}
                      placeholder="Add notes..."
                      className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {doc.status === 'uploaded' || doc.status === 'verified' ? (
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {doc.originalFileName || doc.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {doc.fileType} {doc.fileSize ? `· ${formatFileSize(doc.fileSize)}` : ''}
                          {doc.uploadDate && ` · ${new Date(doc.uploadDate).toLocaleDateString()}`}
                        </p>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {doc.status === 'uploaded' || doc.status === 'verified' ? (
                      <label className={cn('cursor-pointer inline-flex items-center text-xs text-teal-600 dark:text-teal-400 hover:underline', isUploading && 'opacity-50 pointer-events-none')}>
                        <input
                          type="file"
                          className="hidden"
                          disabled={isUploading}
                          onChange={(e) => e.target.files && e.target.files[0] && handleFileSelect(doc, e.target.files[0])}
                        />
                        <Upload className="h-4 w-4 mr-1" />
                        {isUploading ? '...' : 'Replace'}
                      </label>
                    ) : (
                      <label className={cn(
                        'inline-flex items-center justify-center px-3 py-1 text-xs rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer btn-secondary-premium',
                        isUploading && 'opacity-50 cursor-not-allowed'
                      )}>
                        <input
                          type="file"
                          className="hidden"
                          disabled={isUploading}
                          onChange={(e) => e.target.files && e.target.files[0] && handleFileSelect(doc, e.target.files[0])}
                        />
                        <Upload className="h-4 w-4 mr-1" />
                        {isUploading ? '...' : 'Upload'}
                      </label>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody></table></div>
        )}
      </CardContent>
    </Card>
  )
}

export { TransferDocumentsPanel }
