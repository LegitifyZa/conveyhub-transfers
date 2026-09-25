import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button, Input } from '@/components/ui'
import { Search, Building, Folder, ArrowRight, AlertCircle, CheckCircle } from 'lucide-react'
import type { GoldenRecordEntityType } from '@/lib/api/goldenRecordsApi'
import { GoldenRecordCandidateDetails, GoldenRecordDetails, useGoldenRecordSearch } from '@/components/GoldenRecordsSearch'
import { useTransferClassifications } from '@/hooks/useTransferClassifications'
import { MatterClassificationSelect } from '@/components/transfers/MatterClassificationSelect'

interface MatterDetails {
  fileReference: string
  classificationCode: string
}

const NewTransfer: React.FC = () => {
  const navigate = useNavigate()

  const [step, setStep] = useState<'matter' | 'search'>('matter')
  const [fileReference, setFileReference] = useState('')
  const [classificationCode, setClassificationCode] = useState('')
  const classificationData = useTransferClassifications()

  const {
    searchTerm, setSearchTerm, searchType, setSearchType, isSearching, isRetrieving,
    searchResult, candidates, error, setError, notFound, resetSearch,
    handleSearch, handleSelectCandidate, retryRetrieval, canRetryRetrieval
  } = useGoldenRecordSearch(step === 'search')

  const canContinueToSearch = Boolean(fileReference.trim()) && !classificationData.loading && !classificationData.error
    && classificationData.classifications.some(option => option.canonicalCode === classificationCode)

  const buildMatterDetails = (): MatterDetails => ({
    fileReference: fileReference.trim(),
    classificationCode
  })

  const handleContinueToSearch = () => {
    if (!canContinueToSearch) {
      setError('Please enter a matter reference number and select an available transfer classification')
      return
    }
    setError(null)
    setStep('search')
  }

  const handleContinueWithRecord = () => {
    if (searchResult && !isSearching && !isRetrieving) {
      resetSearch()
      navigate('/transfers/workflow', {
        state: {
          goldenRecord: searchResult,
          matterDetails: buildMatterDetails()
        }
      })
    }
  }

  // Manual capture is a peer path, not a fallback: it stays available whether
  // the user never searched, found no match, or the search failed.
  const handleContinueWithoutRecord = () => {
    resetSearch()
    navigate('/transfers/workflow', {
      state: {
        goldenRecordSearch: {
          entityType: searchType,
          query: searchTerm.trim()
        },
        matterDetails: buildMatterDetails()
      }
    })
  }

  const getPlaceholder = () => searchType === 'person'
    ? 'Enter name, ID, passport or email...'
    : 'Enter name or registration number...'

  const getSearchTypeLabel = () => searchType === 'person'
    ? 'Name, ID number, passport number or email'
    : 'Name or registration number'

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

                <MatterClassificationSelect
                  value={classificationCode}
                  options={classificationData.classifications}
                  loading={classificationData.loading}
                  error={classificationData.error}
                  onChange={setClassificationCode}
                  onRetry={classificationData.retry}
                />

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
                    Entity Type
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {(['person', 'company', 'trust'] as GoldenRecordEntityType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => setSearchType(type)}
                        aria-pressed={searchType === type}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          searchType === type
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-300 dark:hover:bg-navy-600'
                        }`}
                      >
                        {type === 'person' ? 'Person' : type === 'company' ? 'Company' : 'Trust'}
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
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch() } }}
                      aria-label="Golden Record search query"
                      className="flex-1"
                    />
                    <Button
                      onClick={handleSearch}
                      disabled={isSearching || isRetrieving}
                      aria-label="Search"
                      className="!p-0 h-10 w-10 flex items-center justify-center"
                    >
                      <Search className="w-5 h-5" />
                    </Button>
                  </div>
                </div>

                {/* Search Guidance */}
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Enter a search query of up to 200 characters.
                  {isSearching && ' Searching Golden Records...'}
                </p>

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
                          disabled={isSearching || isRetrieving}
                          className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-400 transition-colors"
                        >
                          <GoldenRecordCandidateDetails candidate={candidate} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error / Not Found */}
                {isRetrieving && <p role="status" className="text-sm text-gray-600">Retrieving selected Golden Record...</p>}
                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start space-x-3">
                      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="font-medium text-red-800">{notFound ? 'No record found' : canRetryRetrieval ? 'Record could not be retrieved' : 'Search could not be completed'}</h3>
                        <p className="text-sm text-red-600 mb-4">
                          {error}
                        </p>
                        {canRetryRetrieval && <Button onClick={retryRetrieval} variant="outline">Retry retrieval</Button>}
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

                    <div className="mb-4"><GoldenRecordDetails record={searchResult} /></div>

                    <Button
                      onClick={handleContinueWithRecord}
                      disabled={isSearching || isRetrieving}
                      className="w-full flex items-center justify-center space-x-2"
                    >
                      <span>Continue with Record</span>
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {/* Independent manual path — always offered, search or not */}
                <div className="pt-4 border-t border-gray-200 dark:border-navy-700">
                  <Button
                    onClick={handleContinueWithoutRecord}
                    variant="outline"
                    className="w-full flex items-center justify-center space-x-2"
                  >
                    <span>Add parties manually instead</span>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export { NewTransfer }
