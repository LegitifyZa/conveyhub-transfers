import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Search, User, AlertCircle, CheckCircle } from 'lucide-react'
import { Modal, Button, Input } from './ui'
import { GoldenRecordsApi, GoldenRecordSearchError, candidateToGoldenRecord, goldenRecordCandidateDescription } from '@/lib/api/goldenRecordsApi'
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

export function useGoldenRecordSearch(active: boolean) {
  const [searchTerm, updateSearchTerm] = useState('')
  const [searchType, updateSearchType] = useState<GoldenRecordEntityType>('person')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<GoldenRecord | null>(null)
  const [candidates, setCandidates] = useState<GoldenRecordCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const requestVersion = useRef(0)
  const pending = useRef(false)

  const resetSearch = useCallback(() => {
    requestVersion.current += 1
    pending.current = false
    setIsSearching(false)
    setSearchResult(null)
    setCandidates([])
    setError(null)
    setNotFound(false)
  }, [])

  useEffect(() => {
    if (!active) resetSearch()
    return () => {
      requestVersion.current += 1
      pending.current = false
    }
  }, [active, resetSearch])

  const setSearchTerm = (value: string) => {
    resetSearch()
    updateSearchTerm(value)
  }

  const setSearchType = (value: GoldenRecordEntityType) => {
    resetSearch()
    updateSearchType(value)
  }

  const handleSearch = async () => {
    if (!active || pending.current) return
    resetSearch()
    const version = requestVersion.current
    pending.current = true
    setIsSearching(true)
    try {
      const result = await GoldenRecordsApi.search({ entity_type: searchType, query: searchTerm })
      if (requestVersion.current !== version) return
      switch (result.status) {
        case 'matched':
          setSearchResult(candidateToGoldenRecord(result.record!))
          break
        case 'ambiguous':
          setCandidates(result.candidates ?? [])
          break
        case 'not_found':
          setNotFound(true)
          setError('No matching record was found in Golden Records.')
          break
      }
    } catch (err) {
      if (requestVersion.current !== version) return
      setError(err instanceof GoldenRecordSearchError ? err.message : new GoldenRecordSearchError('server').message)
    } finally {
      if (requestVersion.current === version) {
        pending.current = false
        setIsSearching(false)
      }
    }
  }

  const handleSelectCandidate = (candidate: GoldenRecordCandidate) => {
    if (!active || pending.current || !candidates.includes(candidate)) return
    setSearchResult(candidateToGoldenRecord(candidate))
    setCandidates([])
  }

  return {
    searchTerm, setSearchTerm, searchType, setSearchType, isSearching,
    searchResult, candidates, error, setError, notFound, resetSearch,
    handleSearch, handleSelectCandidate
  }
}

export const GoldenRecordsSearch: React.FC<GoldenRecordsSearchProps> = ({
  isOpen,
  onClose,
  onRecordFound
}) => {
  const {
    searchTerm, setSearchTerm, searchType, setSearchType, isSearching,
    searchResult, candidates, error, resetSearch, handleSearch, handleSelectCandidate
  } = useGoldenRecordSearch(isOpen)

  const handleClose = () => {
    resetSearch()
    onClose()
  }

  const handleUseRecord = () => {
    if (searchResult) {
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
              disabled={isSearching}
              className="w-full flex items-center justify-center space-x-2"
            >
              <Search className="w-4 h-4" />
              <span>{isSearching ? 'Searching...' : 'Search Golden Records'}</span>
            </Button>
          </div>

          {/* Search Results */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <span className="text-red-800">{error}</span>
              </div>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">Full Name:</span>
                  <p className="text-gray-900">{searchResult.name}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">ID Number:</span>
                  <p className="text-gray-900">{searchResult.idNumber}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Entity Type:</span>
                  <p className="text-gray-900 capitalize">{searchResult.entityType}</p>
                </div>
                {searchResult.entityType === 'trust' && (
                  <div>
                    <span className="font-medium text-gray-700">Master’s Office:</span>
                    <p className="text-gray-900">{searchResult.mastersOffice ?? 'Not available'}</p>
                  </div>
                )}
                {searchResult.registrationNumber && (
                  <div>
                    <span className="font-medium text-gray-700">Registration Number:</span>
                    <p className="text-gray-900">{searchResult.registrationNumber}</p>
                  </div>
                )}
                {searchResult.email && (
                  <div>
                    <span className="font-medium text-gray-700">Email:</span>
                    <p className="text-gray-900">{searchResult.email}</p>
                  </div>
                )}
                {searchResult.phone && (
                  <div>
                    <span className="font-medium text-gray-700">Phone:</span>
                    <p className="text-gray-900">{searchResult.phone}</p>
                  </div>
                )}
                {searchResult.address && (
                  <div className="md:col-span-2">
                    <span className="font-medium text-gray-700">Address:</span>
                    <p className="text-gray-900">{searchResult.address}</p>
                  </div>
                )}
                {searchResult.propertyAddress && (
                  <div className="md:col-span-2">
                    <span className="font-medium text-gray-700">Property Address:</span>
                    <p className="text-gray-900">{searchResult.propertyAddress}</p>
                  </div>
                )}
                {searchResult.propertyValue && (
                  <div>
                    <span className="font-medium text-gray-700">Property Value:</span>
                    <p className="text-gray-900">
                      R {searchResult.propertyValue.toLocaleString('en-ZA')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {searchResult && (
            <div className="flex space-x-3">
              <Button
                onClick={handleUseRecord}
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
