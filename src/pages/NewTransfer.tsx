import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button, Input } from '@/components/ui'
import { Search, User, Building, ArrowRight, AlertCircle, CheckCircle } from 'lucide-react'

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

const mockGoldenRecords: GoldenRecord[] = [
  {
    id: '1',
    name: 'John Smith',
    idNumber: '8001015009087',
    registrationNumber: '2020/123456',
    email: 'john.smith@email.com',
    phone: '+27 12 345 6789',
    address: '123 Main Street, Cape Town, 8001',
    propertyAddress: '123 Main Street, Cape Town, 8001',
    propertyValue: 2500000
  },
  {
    id: '2',
    name: 'Sarah Johnson',
    idNumber: '8502155030081',
    registrationNumber: '2019/789012',
    email: 'sarah.j@email.com',
    phone: '+27 11 234 5678',
    address: '456 Oak Avenue, Johannesburg, 2001',
    propertyAddress: '456 Oak Avenue, Johannesburg, 2001',
    propertyValue: 1800000
  },
  {
    id: '3',
    name: 'Michael Brown',
    idNumber: '9003304809154',
    registrationNumber: '2021/345678',
    email: 'michael.b@email.com',
    phone: '+27 21 345 6789',
    address: '789 Pine Road, Durban, 4001',
    propertyAddress: '789 Pine Road, Durban, 4001',
    propertyValue: 3200000
  }
]

type SearchType = 'id' | 'name' | 'registration'

const NewTransfer: React.FC = () => {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [searchType, setSearchType] = useState<SearchType>('id')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<GoldenRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setError('Please enter a search term')
      setSearchResult(null)
      return
    }

    setIsSearching(true)
    setError(null)
    setSearchResult(null)

    try {
      // Simulate API call to golden records
      await new Promise(resolve => setTimeout(resolve, 800))

      const term = searchTerm.trim().toLowerCase()
      let foundRecord: GoldenRecord | null = null

      switch (searchType) {
        case 'id':
          foundRecord = mockGoldenRecords.find(record =>
            record.idNumber.toLowerCase().includes(term)
          ) || null
          break
        case 'name':
          foundRecord = mockGoldenRecords.find(record =>
            record.name.toLowerCase().includes(term)
          ) || null
          break
        case 'registration':
          foundRecord = mockGoldenRecords.find(record =>
            record.registrationNumber?.toLowerCase().includes(term)
          ) || null
          break
      }

      if (foundRecord) {
        setSearchResult(foundRecord)
      } else {
        setError('No record found in golden records')
      }
    } catch (err) {
      setError('Failed to search golden records')
    } finally {
      setIsSearching(false)
    }
  }

  const handleContinueWithRecord = () => {
    if (searchResult) {
      navigate('/transfers/workflow', {
        state: { goldenRecord: searchResult }
      })
    }
  }

  const handleContinueWithoutRecord = () => {
    navigate('/transfers/workflow', {
      state: {
        goldenRecordSearch: {
          searchType,
          searchTerm: searchTerm.trim()
        }
      }
    })
  }

  const getPlaceholder = () => {
    switch (searchType) {
      case 'id':
        return 'Enter ID number...'
      case 'name':
        return 'Enter full name...'
      case 'registration':
        return 'Enter registration number...'
    }
  }

  const getSearchTypeLabel = () => {
    switch (searchType) {
      case 'id':
        return 'ID Number'
      case 'name':
        return 'Name'
      case 'registration':
        return 'Registration Number'
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
            Create New Transfer
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Search Golden Records by ID number, name, or registration number.
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
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
                  {(['id', 'name', 'registration'] as SearchType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setSearchType(type)
                        setSearchResult(null)
                        setError(null)
                      }}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        searchType === type
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-300 dark:hover:bg-navy-600'
                      }`}
                    >
                      {type === 'id' && 'ID Number'}
                      {type === 'name' && 'Name'}
                      {type === 'registration' && 'Registration Number'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {getSearchTypeLabel()}
                </label>
                <Input
                  type="text"
                  placeholder={getPlaceholder()}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-full"
                />
              </div>

              {/* Search / Create Button */}
              <Button
                onClick={handleSearch}
                disabled={isSearching}
                className="w-full flex items-center justify-center space-x-2"
              >
                <User className="w-5 h-5" />
                <span>{isSearching ? 'Searching...' : 'Create New Transfer'}</span>
              </Button>

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
                        <span>Continue to Create Transfer</span>
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
        </div>
      </div>
    </div>
  )
}

export { NewTransfer }
