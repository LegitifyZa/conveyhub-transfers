import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button, Input } from '@/components/ui'
import { Search, Building, Folder, ArrowRight, AlertCircle, CheckCircle } from 'lucide-react'
import { GoldenRecordsApi } from '@/lib/api/goldenRecordsApi'
import type { GoldenRecordCandidate } from '@/lib/api/goldenRecordsApi'

interface GoldenRecord {
  id: string
  name: string
  idNumber: string
  registrationNumber?: string
  passport?: string
  email?: string
  phone?: string
  address?: string
  propertyAddress?: string
  propertyValue?: number
}

function candidateToGoldenRecord(candidate: GoldenRecordCandidate): GoldenRecord {
  return {
    id: candidate.goldenRecordId,
    name: candidate.name ?? '',
    idNumber: candidate.idNumber ?? '',
    email: candidate.email ?? undefined
  }
}

type SearchType = 'id' | 'passport'
type MatterCategory = 'transfer' | 'development'

const transferOptions = [
  'Private Treaty',
  'Auction',
  'Sale in Execution',
  'Property in Possession',
  'Deceased Estate - Inheritance',
  'Endorsement - Section 45',
  'Donation',
  'Not Applicable'
]

const developmentOptions = [
  'New Sectional Title Register',
  'New Township Register/Establishment',
  'Scheme Extension (Sections)',
  'Subdivision'
]

const transferFromOptions = [
  'Sectional Title Register',
  'Township Register',
  'Extension of Scheme',
  'Subdivision',
  'Bulk Transfer'
]

interface MatterDetails {
  fileReference: string
  matterCategory: MatterCategory
  matterType: string
  transferFrom: string
}

const NewTransfer: React.FC = () => {
  const navigate = useNavigate()

  const [step, setStep] = useState<'matter' | 'search'>('matter')
  const [fileReference, setFileReference] = useState('')
  const [matterCategory, setMatterCategory] = useState<MatterCategory>('transfer')
  const [matterType, setMatterType] = useState('')
  const [transferFrom, setTransferFrom] = useState('')

  const [searchTerm, setSearchTerm] = useState('')
  const [searchType, setSearchType] = useState<SearchType>('id')
  const [passportCountry, setPassportCountry] = useState('ZA')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<GoldenRecord | null>(null)
  const [candidates, setCandidates] = useState<GoldenRecordCandidate[]>([])
  const [error, setError] = useState<string | null>(null)

  const canContinueToSearch = !!(fileReference.trim() && matterType.trim())

  const buildMatterDetails = (): MatterDetails => ({
    fileReference: fileReference.trim(),
    matterCategory,
    matterType,
    transferFrom
  })

  const handleContinueToSearch = () => {
    if (!canContinueToSearch) {
      setError('Please enter a matter reference number and select a matter type')
      return
    }
    setError(null)
    setStep('search')
  }

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setError('Please enter a search term')
      setSearchResult(null)
      setCandidates([])
      return
    }
    if (searchType === 'passport' && !passportCountry.trim()) {
      setError('Please enter a passport country')
      setSearchResult(null)
      setCandidates([])
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

  const handleContinueWithRecord = () => {
    if (searchResult) {
      navigate('/transfers/workflow', {
        state: {
          goldenRecord: searchResult,
          matterDetails: buildMatterDetails()
        }
      })
    }
  }

  const handleContinueWithoutRecord = () => {
    navigate('/transfers/workflow', {
      state: {
        goldenRecordSearch: {
          searchType,
          searchTerm: searchTerm.trim()
        },
        matterDetails: buildMatterDetails()
      }
    })
  }

  const getPlaceholder = () => {
    switch (searchType) {
      case 'id':
        return 'Enter ID number...'
      case 'passport':
        return 'Enter passport number...'
    }
  }

  const getSearchTypeLabel = () => {
    switch (searchType) {
      case 'id':
        return 'ID Number'
      case 'passport':
        return 'Passport Number'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-teal-100 rounded-full mb-6">
            <Building className="w-10 h-10 text-teal-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Create New Matter
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            {step === 'matter'
              ? 'Enter the matter details before searching Golden Records.'
              : 'Search Golden Records'}
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
          {step === 'matter' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Folder className="w-5 h-5 text-navy-600" />
                  <span>Matter Reference</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Matter Reference Number
                  </label>
                  <Input
                    type="text"
                    placeholder="Enter matter reference number..."
                    value={fileReference}
                    onChange={(e) => setFileReference(e.target.value)}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Matter Type
                  </label>
                  <select
                    value={matterCategory}
                    onChange={(e) => {
                      setMatterCategory(e.target.value as MatterCategory)
                      setMatterType('')
                    }}
                    className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="transfer">Transfer</option>
                    <option value="development">Development</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {matterCategory === 'transfer' ? 'Transfer Type' : 'Development Type'}
                  </label>
                  <select
                    value={matterType}
                    onChange={(e) => setMatterType(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select {matterCategory === 'transfer' ? 'a transfer' : 'a development'} type...</option>
                    {(matterCategory === 'transfer' ? transferOptions : developmentOptions).map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>

                {matterCategory === 'development' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Transfer From
                    </label>
                    <select
                      value={transferFrom}
                      onChange={(e) => setTransferFrom(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Select transfer from...</option>
                      {transferFromOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                )}

                {error && step === 'matter' && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleContinueToSearch}
                  disabled={!canContinueToSearch}
                  className="w-full flex items-center justify-center space-x-2"
                >
                  <span>Continue to Golden Records</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Search className="w-5 h-5 text-yellow-600" />
                  <span>Golden Records Search</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {/* Search Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Search By
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {(['id', 'passport'] as SearchType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => {
                          setSearchType(type)
                          setSearchResult(null)
                          setCandidates([])
                          setError(null)
                        }}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          searchType === type
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-300 dark:hover:bg-navy-600'
                        }`}
                      >
                        {type === 'id' && 'ID Number'}
                        {type === 'passport' && 'Passport'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Search Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {getSearchTypeLabel()}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder={getPlaceholder()}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                      className="flex-1"
                    />
                    <Button
                      onClick={handleSearch}
                      disabled={isSearching}
                      aria-label="Search"
                      className="!p-0 h-10 w-10 flex items-center justify-center"
                    >
                      <Search className="w-5 h-5" />
                    </Button>
                  </div>
                </div>

                {/* Passport Country */}
                {searchType === 'passport' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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

                {/* Ambiguous candidates */}
                {candidates.length > 0 && (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-start space-x-3 mb-4">
                      <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                      <div>
                        <h3 className="font-medium text-yellow-800">Multiple records found</h3>
                        <p className="text-sm text-yellow-700">
                          Select the correct record to continue.
                        </p>
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

                {/* Error / Not Found */}
                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start space-x-3">
                      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="font-medium text-red-800">No record found</h3>
                        <p className="text-sm text-red-600 mb-4">
                          We could not find a matching record in Golden Records.
                        </p>
                        <Button
                          onClick={handleContinueWithoutRecord}
                          variant="outline"
                          className="w-full flex items-center justify-center space-x-2"
                        >
                          <span>Continue to Create Matter</span>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Search Result */}
                {searchResult && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-start space-x-3 mb-4">
                      <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                      <div>
                        <h3 className="font-medium text-green-800">Record found in Golden Records</h3>
                        <p className="text-sm text-green-600">
                          We found a matching record. We can pre-fill the transfer details.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
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

                    <Button
                      onClick={handleContinueWithRecord}
                      className="w-full flex items-center justify-center space-x-2"
                    >
                      <span>Continue with Record</span>
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export { NewTransfer }
