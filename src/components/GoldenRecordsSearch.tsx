import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { Search, User, AlertCircle, CheckCircle } from 'lucide-react'
import { Modal, Button, Input } from './ui'
import { GoldenRecordsApi, GoldenRecordSearchError, GoldenRecordRetrievalError, goldenRecordCandidateDescription } from '@/lib/api/goldenRecordsApi'
import type { GoldenRecord, GoldenRecordCandidate, GoldenRecordEntityType } from '@/lib/api/goldenRecordsApi'

interface GoldenRecordsSearchProps {
  isOpen: boolean
  onClose: () => void
  onRecordFound: (record: GoldenRecord) => void
}

export const GoldenRecordCandidateDetails: React.FC<{ candidate: GoldenRecordCandidate }> = ({ candidate }) => (
  <>
    <div className="font-medium text-gray-900">
      {candidate.name ?? 'Unnamed record'}
    </div>
    <div className="text-sm text-gray-600">
      {goldenRecordCandidateDescription(candidate)}
    </div>
  </>
)

export const GoldenRecordDetails: React.FC<{ record: GoldenRecord }> = ({ record }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
    <div>
      <span className="font-medium text-gray-700">Full Name:</span>
      <p className="text-gray-900">{record.name}</p>
    </div>
    <div>
      <span className="font-medium text-gray-700">ID Number:</span>
      <p className="text-gray-900">{record.idNumber}</p>
    </div>
    <div>
      <span className="font-medium text-gray-700">Entity Type:</span>
      <p className="text-gray-900 capitalize">{record.entityType}</p>
    </div>
    {record.entityType === 'trust' && (
      <div>
        <span className="font-medium text-gray-700">Master’s Office:</span>
        <p className="text-gray-900">{record.mastersOffice ?? 'Not available'}</p>
      </div>
    )}
    {record.registrationNumber && (
      <div>
        <span className="font-medium text-gray-700">Registration Number:</span>
        <p className="text-gray-900">{record.registrationNumber}</p>
      </div>
    )}
    {record.email && (
      <div>
        <span className="font-medium text-gray-700">Email:</span>
        <p className="text-gray-900">{record.email}</p>
      </div>
    )}
    {record.phone && (
      <div>
        <span className="font-medium text-gray-700">Phone:</span>
        <p className="text-gray-900">{record.phone}</p>
      </div>
    )}
    {record.address && (
      <div className="md:col-span-2">
        <span className="font-medium text-gray-700">Address:</span>
        <p className="text-gray-900">{record.address}</p>
      </div>
    )}
    {record.propertyAddress && (
      <div className="md:col-span-2">
        <span className="font-medium text-gray-700">Property Address:</span>
        <p className="text-gray-900">{record.propertyAddress}</p>
      </div>
    )}
    {record.propertyValue && (
      <div>
        <span className="font-medium text-gray-700">Property Value:</span>
        <p className="text-gray-900">R {record.propertyValue.toLocaleString('en-ZA')}</p>
      </div>
    )}
  </div>
)

interface GoldenRecordSearchState {
  searchTerm: string
  searchType: GoldenRecordEntityType
  isSearching: boolean
  isRetrieving: boolean
  searchResult: GoldenRecord | null
  candidates: GoldenRecordCandidate[]
  error: string | null
  notFound: boolean
  retrievalTarget: Pick<GoldenRecordCandidate, 'goldenRecordId' | 'entityType'> | null
}

export function createGoldenRecordSearchSession() {
  const emptySelection = () => ({
    isSearching: false, isRetrieving: false, searchResult: null,
    candidates: [] as GoldenRecordCandidate[], error: null, notFound: false, retrievalTarget: null
  })
  let state: GoldenRecordSearchState = { searchTerm: '', searchType: 'person', ...emptySelection() }
  let active = false
  let requestVersion = 0
  let pending = false
  const listeners = new Set<() => void>()
  const update = (values: Partial<GoldenRecordSearchState>) => {
    state = { ...state, ...values }
    listeners.forEach(listener => listener())
  }
  const current = (version: number) => active && requestVersion === version
  const resetSearch = () => {
    requestVersion += 1
    pending = false
    update(emptySelection())
  }
  const setActive = (value: boolean) => {
    active = value
    if (!active) resetSearch()
  }
  const setSearchTerm = (value: string) => {
    resetSearch()
    update({ searchTerm: value })
  }
  const setSearchType = (value: GoldenRecordEntityType) => {
    resetSearch()
    update({ searchType: value })
  }

  const retrieve = async (reference: NonNullable<GoldenRecordSearchState['retrievalTarget']>, version: number) => {
    if (!current(version)) return
    pending = true
    update({ ...emptySelection(), isRetrieving: true, retrievalTarget: reference })
    try {
      const record = await GoldenRecordsApi.retrieve(reference.goldenRecordId, reference.entityType)
      if (current(version)) update({ searchResult: record, retrievalTarget: null })
    } catch (error) {
      if (current(version)) update({
        error: error instanceof GoldenRecordRetrievalError ? error.message : new GoldenRecordRetrievalError('server').message
      })
    } finally {
      if (current(version)) {
        pending = false
        update({ isRetrieving: false })
      }
    }
  }

  const handleSearch = async () => {
    if (!active || pending) return
    resetSearch()
    const version = requestVersion
    pending = true
    update({ isSearching: true })
    try {
      const result = await GoldenRecordsApi.search({ entity_type: state.searchType, query: state.searchTerm })
      if (!current(version)) return
      switch (result.status) {
        case 'matched':
          await retrieve({ goldenRecordId: result.record!.goldenRecordId, entityType: result.record!.entityType }, version)
          break
        case 'ambiguous':
          update({ candidates: result.candidates ?? [] })
          break
        case 'not_found':
          update({ notFound: true, error: 'No matching record was found in Golden Records.' })
          break
      }
    } catch (error) {
      if (current(version)) update({ error: error instanceof GoldenRecordSearchError ? error.message : new GoldenRecordSearchError('server').message })
    } finally {
      if (current(version)) {
        pending = false
        update({ isSearching: false })
      }
    }
  }

  const handleSelectCandidate = async (candidate: GoldenRecordCandidate) => {
    if (!active || pending || !state.candidates.includes(candidate)) return
    resetSearch()
    await retrieve({ goldenRecordId: candidate.goldenRecordId, entityType: candidate.entityType }, requestVersion)
  }
  const retryRetrieval = async () => {
    if (!active || pending || !state.retrievalTarget) return
    const reference = state.retrievalTarget
    resetSearch()
    await retrieve(reference, requestVersion)
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    setActive, setSearchTerm, setSearchType, resetSearch, handleSearch, handleSelectCandidate, retryRetrieval,
    setError: (error: string | null) => update({ error })
  }
}

export function useGoldenRecordSearch(active: boolean) {
  const [session] = useState(createGoldenRecordSearchSession)
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => {
    session.setActive(active)
    return () => session.setActive(false)
  }, [active, session])
  return {
    ...state,
    setSearchTerm: session.setSearchTerm, setSearchType: session.setSearchType, setError: session.setError,
    resetSearch: session.resetSearch, handleSearch: session.handleSearch, handleSelectCandidate: session.handleSelectCandidate,
    retryRetrieval: session.retryRetrieval,
    canRetryRetrieval: !!state.error && !!state.retrievalTarget && !state.isRetrieving
  }
}

export const GoldenRecordsSearch: React.FC<GoldenRecordsSearchProps> = ({
  isOpen,
  onClose,
  onRecordFound
}) => {
  const {
    searchTerm, setSearchTerm, searchType, setSearchType, isSearching, isRetrieving,
    searchResult, candidates, error, resetSearch, handleSearch, handleSelectCandidate, retryRetrieval, canRetryRetrieval
  } = useGoldenRecordSearch(isOpen)

  const handleClose = () => {
    resetSearch()
    onClose()
  }

  const handleUseRecord = () => {
    if (searchResult && !isSearching && !isRetrieving) {
      onRecordFound(searchResult)
      handleClose()
    }
  }

  const handleSkip = () => {
    handleClose()
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Search className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Golden Records Search</h2>
                <p className="text-sm text-gray-600">Search for existing user information</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              ×
            </button>
          </div>

          {/* Search Type Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Entity Type</label>
            <div className="flex space-x-4">
              {(['person', 'company', 'trust'] as GoldenRecordEntityType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setSearchType(type)}
                  aria-pressed={searchType === type}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    searchType === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {type === 'person' ? 'Person' : type === 'company' ? 'Company' : 'Trust'}
                </button>
              ))}
            </div>
          </div>

          {/* Search Guidance */}
          <p className="mb-4 text-sm text-gray-600">
            {searchType === 'person'
              ? 'Search by name, ID number, passport number or email.'
              : 'Search by name or registration number.'}
          </p>

          {/* Search Input */}
          <div className="mb-6">
            <Input
              type="text"
              placeholder={
                searchType === 'person' ? 'Enter name, ID, passport or email...' : 'Enter name or registration number...'
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch() } }}
              aria-label="Golden Record search query"
              className="w-full"
            />
          </div>

          {/* Search Button */}
          <div className="mb-6">
            <Button
              onClick={handleSearch}
              disabled={isSearching || isRetrieving}
              className="w-full flex items-center justify-center space-x-2"
            >
              <Search className="w-4 h-4" />
              <span>{isSearching ? 'Searching...' : 'Search Golden Records'}</span>
            </Button>
          </div>

          {/* Search Results */}
          {isRetrieving && <p role="status" className="mb-4 text-sm text-gray-600">Retrieving selected Golden Record...</p>}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <span className="text-red-800">{error}</span>
              </div>
              {canRetryRetrieval && <Button onClick={retryRetrieval} variant="outline" className="mt-3">Retry retrieval</Button>}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start space-x-3 mb-4">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <h3 className="font-medium text-yellow-800">Multiple records found</h3>
                  <p className="text-sm text-yellow-700">Select the correct record to continue.</p>
                </div>
              </div>
              <div className="space-y-2">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.goldenRecordId}
                    onClick={() => handleSelectCandidate(candidate)}
                    disabled={isSearching || isRetrieving}
                    className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-400 transition-colors"
                  >
                    <GoldenRecordCandidateDetails candidate={candidate} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {searchResult && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start space-x-3 mb-4">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h3 className="font-medium text-green-800">Record Found</h3>
                  <p className="text-sm text-green-600">User found in golden records</p>
                </div>
              </div>

              {/* Record Details */}
              <GoldenRecordDetails record={searchResult} />
            </div>
          )}

          {/* Action Buttons */}
          {searchResult && (
            <div className="flex space-x-3">
              <Button
                onClick={handleUseRecord}
                disabled={isSearching || isRetrieving}
                className="flex-1 flex items-center justify-center space-x-2"
              >
                <User className="w-4 h-4" />
                <span>Use This Record</span>
              </Button>
              <Button
                onClick={handleSkip}
                variant="outline"
                className="flex-1"
              >
                Skip and Continue
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
