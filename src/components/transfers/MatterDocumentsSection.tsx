import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Download, FileText, RefreshCw, ShieldAlert, Upload } from 'lucide-react'
import { Card, CardContent, UnavailableNotice } from '@/components/ui'
import { Badge } from '@/components/ui'
import {
  DocumentRequirement,
  MatterDocument,
  UnevaluatedRule,
  createMatterDocument,
  fetchMatterDocuments,
  issueDocumentDownloadLink,
  recalculateDocumentRequirements,
  rescanMatterDocumentFile,
  uploadMatterDocumentFile,
} from '@/lib/api/matterDocuments'
import { cn } from '@/utils/cn'

const formatFileSize = (bytes?: number | null) => {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function scanBadge(doc: MatterDocument) {
  switch (doc.scanStatus) {
    case 'clean':
      return null
    case 'infected':
      return <Badge variant="error" size="sm">Blocked by security scan</Badge>
    case 'error':
      return <Badge variant="warning" size="sm">Scan unavailable — retry scan</Badge>
    case 'pending':
      return <Badge variant="warning" size="sm">Awaiting security scan</Badge>
    default:
      return null
  }
}

interface Props {
  transferId: string
  onDocumentsChange?: (documents: MatterDocument[]) => void
}

export const MatterDocumentsSection: React.FC<Props> = ({ transferId, onDocumentsChange }) => {
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([])
  const [unevaluatedFacts, setUnevaluatedFacts] = useState<string[]>([])
  const [unevaluatedRules, setUnevaluatedRules] = useState<UnevaluatedRule[]>([])
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [addingFree, setAddingFree] = useState(false)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})
  const uploadTarget = useRef<{ documentId?: string; requirementKey?: string; name?: string } | null>(null)

  const setRowError = (key: string, message: string) =>
    setRowErrors(prev => ({ ...prev, [key]: message }))

  const refresh = useCallback(async () => {
    const result = await fetchMatterDocuments(transferId)
    setDocuments(result.documents)
    setRequirements(result.requirements)
    setUnevaluatedFacts(result.unevaluatedFacts)
    setUnevaluatedRules(result.unevaluatedRules)
    onDocumentsChange?.(result.documents)
  }, [transferId, onDocumentsChange])

  useEffect(() => {
    refresh()
      .then(() => setLoaded(true))
      .catch(err => {
        setLoaded(true)
        setLoadError(err instanceof Error ? err : new Error('Document service unavailable'))
      })
  }, [refresh])

  const handleRecalculate = async () => {
    setBusyKey('recalculate')
    setRowError('recalculate', '')
    try {
      const updated = await recalculateDocumentRequirements(transferId)
      setRequirements(updated.requirements)
      setUnevaluatedFacts(updated.unevaluatedFacts)
      setUnevaluatedRules(updated.unevaluatedRules)
      await refresh()
    } catch (err) {
      setRowError('recalculate', err instanceof Error ? err.message : 'Could not evaluate requirements')
    } finally {
      setBusyKey(null)
    }
  }

  // Picking a file for an existing document row.
  const pickFileForDocument = (documentId: string) => {
    uploadTarget.current = { documentId }
    fileInputs.current[documentId]?.click()
  }

  // Picking a file for a requirement creates the document row first.
  const pickFileForRequirement = (requirement: DocumentRequirement) => {
    uploadTarget.current = { requirementKey: requirement.requirementKey, name: requirement.displayName }
    fileInputs.current[`req:${requirement.requirementKey}`]?.click()
  }

  const handleFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const target = uploadTarget.current
    uploadTarget.current = null
    if (!file || !target) return

    const errorKey = target.documentId ?? `req:${target.requirementKey}`
    setBusyKey(errorKey)
    setRowError(errorKey, '')
    try {
      let documentId = target.documentId
      if (!documentId) {
        const created = await createMatterDocument(transferId, {
          name: target.name ?? file.name,
          requirementKey: target.requirementKey,
          clientRequestId: crypto.randomUUID(),
        })
        documentId = created.id
      }
      const result = await uploadMatterDocumentFile(transferId, documentId, file)
      if (result.outcome === 'quarantined') {
        setRowError(errorKey, 'The file failed the security scan and cannot be used')
      } else if (result.outcome === 'scan_pending') {
        setRowError(errorKey, 'Security scan is unavailable — the file is stored but not yet downloadable')
      }
      await refresh()
    } catch (err) {
      setRowError(errorKey, err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusyKey(null)
    }
  }

  const handleAddFreeform = async () => {
    if (!newName.trim()) return
    setAddingFree(true)
    setRowError('add', '')
    try {
      await createMatterDocument(transferId, { name: newName.trim(), clientRequestId: crypto.randomUUID() })
      setNewName('')
      await refresh()
    } catch (err) {
      setRowError('add', err instanceof Error ? err.message : 'Could not add document')
    } finally {
      setAddingFree(false)
    }
  }

  // Re-scan the already-stored bytes — no re-upload needed when the earlier
  // scan did not complete.
  const handleRescan = async (doc: MatterDocument) => {
    setBusyKey(doc.id)
    setRowError(doc.id, '')
    try {
      const result = await rescanMatterDocumentFile(transferId, doc.id)
      if (result.outcome === 'quarantined') {
        setRowError(doc.id, 'The file failed the security scan and cannot be used')
      } else if (result.outcome === 'scan_pending') {
        setRowError(doc.id, 'Security scan is unavailable — the file is stored but not yet downloadable')
      }
      await refresh()
    } catch (err) {
      setRowError(doc.id, err instanceof Error ? err.message : 'Scan retry failed')
    } finally {
      setBusyKey(null)
    }
  }

  const handleDownload = async (doc: MatterDocument) => {
    const key = `dl:${doc.id}`
    setBusyKey(key)
    setRowError(key, '')
    try {
      const link = await issueDocumentDownloadLink(transferId, doc.id)
      window.open(link.downloadUrl, '_blank', 'noopener')
    } catch (err) {
      setRowError(key, err instanceof Error ? err.message : 'Could not create a download link')
    } finally {
      setBusyKey(null)
    }
  }

  const downloadable = (doc: MatterDocument) =>
    doc.status === 'uploaded' && doc.scanStatus === 'clean'

  // A missing matter fact (e.g. no recorded classification) or a rule whose
  // condition cannot be decided means the requirement list is visibly
  // incomplete — never presented as a confirmed "no requirements".
  const FACT_LABELS: Record<string, string> = {
    classification_code: 'matter classification',
    has_bond: 'bond/financing status',
  }
  const evaluationIncomplete = unevaluatedFacts.length > 0 || unevaluatedRules.length > 0

  const hiddenInput = (key: string) => (
    <input
      type="file"
      className="hidden"
      data-upload-key={key}
      accept=".pdf,.docx,.jpg,.jpeg,.png"
      ref={el => { fileInputs.current[key] = el }}
      onChange={handleFileChosen}
    />
  )

  if (!loaded) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading documents…</p>
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <UnavailableNotice
          message="The document service is unavailable"
          detail="Documents cannot be listed, uploaded or downloaded for this matter right now."
        />
      )}

      {evaluationIncomplete && (
        <div
          data-testid="requirements-unevaluated-notice"
          className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2"
        >
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Requirement evaluation is incomplete
            {unevaluatedFacts.length > 0 && (
              <>: no {unevaluatedFacts.map(f => FACT_LABELS[f] ?? f).join(' or ')} is recorded for this matter</>
            )}
            . {unevaluatedRules.length > 0
              ? `${unevaluatedRules.length} rule${unevaluatedRules.length === 1 ? '' : 's'} could not be evaluated — `
              : ''}
            the requirement list may be missing items.
          </p>
        </div>
      )}

      {requirements.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Required documents</h3>
          {requirements.map(req => {
            const linked = documents.find(d => d.id === req.linkedDocumentId)
            const satisfied = req.status === 'active' && Boolean(req.satisfiedDocumentId)
            const key = `req:${req.requirementKey}`
            return (
              <Card key={req.id} variant="glass">
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {req.displayName}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {req.status === 'withdrawn' ? (
                        <Badge variant="secondary" size="sm">No longer required</Badge>
                      ) : satisfied ? (
                        <Badge variant="success" size="sm">Provided</Badge>
                      ) : (
                        <Badge variant="warning" size="sm">Required</Badge>
                      )}
                      {req.source === 'conditional' && (
                        <span className="text-xs text-gray-500">Conditional</span>
                      )}
                    </div>
                  </div>
                  {req.status === 'active' && !satisfied && (
                    <label
                      className={cn(
                        'inline-flex items-center px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer btn-secondary-premium',
                        busyKey === key && 'opacity-50 pointer-events-none'
                      )}
                      onClick={() => pickFileForRequirement(req)}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      {busyKey === key ? 'Uploading…' : linked ? 'Upload file' : 'Upload'}
                    </label>
                  )}
                  {hiddenInput(key)}
                  {rowErrors[key] && (
                    <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {rowErrors[key]}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Documents</h3>
        <button
          onClick={handleRecalculate}
          disabled={busyKey === 'recalculate'}
          className="inline-flex items-center text-xs text-teal-600 dark:text-teal-400 hover:underline disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1', busyKey === 'recalculate' && 'animate-spin')} />
          Re-check requirements
        </button>
      </div>
      {rowErrors.recalculate && (
        <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {rowErrors.recalculate}
        </p>
      )}

      {documents.length === 0 && requirements.length === 0 && !loadError && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            No documents or requirements yet. Add a document below or re-check requirements.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {documents.map(doc => {
          const isBusy = busyKey === doc.id || busyKey === `dl:${doc.id}`
          return (
            <Card key={doc.id} variant="glass">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center flex-shrink-0">
                      {doc.scanStatus === 'infected' ? (
                        <ShieldAlert className="h-5 w-5 text-red-500" />
                      ) : (
                        <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{doc.name}</p>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <Badge
                          variant={doc.status === 'uploaded' ? 'success' : doc.status === 'verified' ? 'success' : doc.status === 'rejected' ? 'error' : 'default'}
                          size="sm"
                        >
                          {doc.status}
                        </Badge>
                        {scanBadge(doc)}
                        {doc.originalFileName && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {doc.originalFileName}
                            {doc.fileSize ? ` · ${formatFileSize(doc.fileSize)}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!doc.originalFileName && (
                      <label
                        className={cn(
                          'inline-flex items-center px-3 py-1.5 text-xs rounded-lg font-medium cursor-pointer btn-secondary-premium',
                          isBusy && 'opacity-50 pointer-events-none'
                        )}
                        onClick={() => pickFileForDocument(doc.id)}
                      >
                        <Upload className="h-3.5 w-3.5 mr-1" />
                        {busyKey === doc.id ? 'Uploading…' : 'Upload file'}
                      </label>
                    )}
                    {(doc.scanStatus === 'error' || doc.scanStatus === 'pending') && doc.originalFileName && (
                      <button
                        onClick={() => handleRescan(doc)}
                        disabled={isBusy}
                        className="inline-flex items-center px-3 py-1.5 text-xs rounded-lg font-medium btn-secondary-premium disabled:opacity-50"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5 mr-1', busyKey === doc.id && 'animate-spin')} />
                        Retry scan
                      </button>
                    )}
                    {downloadable(doc) && (
                      <button
                        onClick={() => handleDownload(doc)}
                        disabled={isBusy}
                        className="inline-flex items-center px-3 py-1.5 text-xs rounded-lg font-medium btn-secondary-premium disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {busyKey === `dl:${doc.id}` ? 'Preparing…' : 'Download'}
                      </button>
                    )}
                  </div>
                </div>
                {doc.status === 'uploaded' && doc.scanStatus === 'clean' && (
                  <div className="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300">
                    <CheckCircle className="h-3.5 w-3.5" />
                    Security scan passed — available for download
                  </div>
                )}
                {hiddenInput(doc.id)}
                {(rowErrors[doc.id] || rowErrors[`dl:${doc.id}`]) && (
                  <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {rowErrors[doc.id] || rowErrors[`dl:${doc.id}`]}
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card variant="premium">
        <CardContent className="p-4 space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Add a document
          </label>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Document name"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
            <button
              onClick={handleAddFreeform}
              disabled={!newName.trim() || addingFree}
              className="inline-flex items-center px-4 py-2 text-sm rounded-lg font-medium btn-primary-premium disabled:opacity-50"
            >
              <Upload className="h-4 w-4 mr-2" />
              {addingFree ? 'Adding…' : 'Add'}
            </button>
          </div>
          {rowErrors.add && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {rowErrors.add}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Accepted: PDF, DOCX, JPG, PNG — up to 25 MB. Files are security-scanned before they can be downloaded.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default MatterDocumentsSection
