import React, { useState, useRef } from 'react'
import { FileText, Upload, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { Button } from '@/components/ui'
import { Badge } from '@/components/ui'
import { useTransfer, Document } from './TransferForm'

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

const StepDocuments: React.FC = () => {
  const { state, dispatch } = useTransfer()
  const { documents } = state
  const [selectedType, setSelectedType] = useState('')
  const [description, setDescription] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files))
    }
  }

  const handleUpload = () => {
    if (selectedFiles.length === 0 || !selectedType) return

    selectedFiles.forEach(file => {
      const newDoc: Document = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 9),
        name: file.name,
        type: selectedType,
        status: 'uploaded',
        uploadDate: new Date().toISOString(),
        file,
        description
      }
      dispatch({ type: 'ADD_DOCUMENT', payload: newDoc })
    })

    setSelectedFiles([])
    setSelectedType('')
    setDescription('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const updateDocument = (id: string, updates: Partial<Document>) => {
    dispatch({ type: 'UPDATE_DOCUMENT', payload: { id, updates } })
  }

  const removeDocument = (id: string) => {
    dispatch({ type: 'REMOVE_DOCUMENT', payload: id })
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-5 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Documents
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Upload and categorize all required documents for this transfer
        </p>
      </div>

      <Card variant="premium">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <span>Upload Documents</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Document Type *
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
            >
              <option value="">Select document type</option>
              {DOCUMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description for these documents..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Files *
            </label>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 dark:file:bg-teal-900/20 dark:file:text-teal-300"
            />
            {selectedFiles.length > 0 && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {selectedFiles.length} file(s) selected
              </p>
            )}
          </div>

          <Button
            variant="premium-primary"
            onClick={handleUpload}
            disabled={selectedFiles.length === 0 || !selectedType}
            className="w-full transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="h-4 w-4 mr-2" />
            Add {selectedFiles.length > 1 ? `${selectedFiles.length} Documents` : 'Document'}
          </Button>
        </CardContent>
      </Card>

      {documents.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Uploaded Documents ({documents.length})
          </h3>
          {documents.map((doc) => (
            <Card key={doc.id} variant="glass" className="hover:shadow-premium transition-all duration-200">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                      <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {doc.name}
                      </span>
                      <Badge variant="primary" size="sm">
                        {getDocumentTypeLabel(doc.type)}
                      </Badge>
                      <Badge
                        variant={doc.status === 'verified' ? 'success' : doc.status === 'uploaded' ? 'warning' : 'default'}
                        size="sm"
                      >
                        {doc.status}
                      </Badge>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Document Type
                      </label>
                      <select
                        value={doc.type}
                        onChange={(e) => updateDocument(doc.id, { type: e.target.value })}
                        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-navy-600 rounded bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                      >
                        {DOCUMENT_TYPES.map(type => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Description
                      </label>
                      <textarea
                        value={doc.description || ''}
                        onChange={(e) => updateDocument(doc.id, { description: e.target.value })}
                        placeholder="Add a description for this document..."
                        rows={2}
                        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-navy-600 rounded bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                      />
                    </div>

                    {doc.uploadDate && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Uploaded {new Date(doc.uploadDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => removeDocument(doc.id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0"
                    title="Remove document"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="glass">
          <CardContent className="p-6 text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              No documents uploaded yet
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Select files above and choose a document type
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export { StepDocuments }
