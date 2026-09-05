import React, { useState } from 'react'
import { Search, User, AlertCircle, CheckCircle } from 'lucide-react'
import { Modal, Button, Input } from './ui'
import { GoldenRecordsApi } from '@/lib/api/goldenRecordsApi'
import type { GoldenRecordCandidate } from '@/lib/api/goldenRecordsApi'

interface GoldenRecord {
  id: string
  name: string
  idNumber: string
  registrationNumber?: string
  email?: string
  phone?: string
  address?: string
  propertyAddress?: string
  propertyValue?: number
}

interface GoldenRecordsSearchProps {
  isOpen: boolean
  onClose: () => void
  onRecordFound: (record: GoldenRecord) => void
}

function candidateToGoldenRecord(candidate: GoldenRecordCandidate): GoldenRecord {
  return {
    id: candidate.goldenRecordId,
    name: candidate.name ?? '',
    idNumber: candidate.idNumber ?? '',
    email: candidate.email ?? undefined
  }
}

export const GoldenRecordsSearch: React.FC<GoldenRecordsSearchProps> = ({
  isOpen,
  onClose,
  onRecordFound
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchType, setSearchType] = useState<'id' | 'passport'>('id')
  const [passportCountry, setPassportCountry] = useState('ZA')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<GoldenRecord | null>(null)
  const [candidates, setCandidates] = useState<GoldenRecordCandidate[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setError('Please enter a search term')
      return
    }
    if (searchType === 'passport' && !passportCountry.trim()) {
      setError('Please enter a passport country')
      return
    }

    setIsSearching(true)
    setError(null)
    setSearchResult(null)
    setCandidates([])

    try {
      const result = await GoldenRecordsApi.search(
        searchType === 'id'
          ? { entity_type: 'person', id_number: searchTerm.trim() }
          : {
              entity_type: 'person',
              passport_number: searchTerm.trim(),
              passport_country: passportCountry.trim().toUpperCase()
            }
      )

      switch (result.status) {
        case 'matched':
          if (result.record) {
            setSearchResult(candidateToGoldenRecord(result.record))
          } else {
            setError('No record found in golden records')
          }
          break
        case 'ambiguous':
          setCandidates(result.candidates ?? [])
          break
        case 'unsupported':
          setError(result.detail ?? 'This search type is not yet available')
          break
        case 'not_found':
        default:
          setError('No record found in golden records')
          break
      }
    } catch (err) {
      setError('Failed to search golden records')
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectCandidate = (candidate: GoldenRecordCandidate) => {
    setSearchResult(candidateToGoldenRecord(candidate))
    setCandidates([])
  }

  const handleUseRecord = () => {
    if (searchResult) {
      onRecordFound(searchResult)
      onClose()
    }
  }

  const handleSkip = () => {
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
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
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              ×
            </button>
          </div>

          {/* Search Type Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Search By</label>
            <div className="flex space-x-4">
              <button
                onClick={() => setSearchType('id')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  searchType === 'id'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                ID Number
              </button>
              <button
                onClick={() => setSearchType('passport')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  searchType === 'passport'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Passport
              </button>
            </div>
          </div>

          {/* Passport Country */}
          {searchType === 'passport' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Passport Country
              </label>
              <Input
                type="text"
                placeholder="e.g. ZA"
                value={passportCountry}
                onChange={(e) => setPassportCountry(e.target.value)}
                className="w-full"
              />
            </div>
          )}

          {/* Search Input */}
          <div className="mb-6">
            <Input
              type="text"
              placeholder={
                searchType === 'id' ? 'Enter ID number...' : 'Enter passport number...'
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
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
                    <div className="font-medium text-gray-900">
                      {candidate.name ?? 'Unnamed record'}
                    </div>
                    <div className="text-sm text-gray-600">
                      {candidate.idNumber ?? 'No ID number'}
                      {candidate.email ? ` · ${candidate.email}` : ''}
                    </div>
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
