import React, { useState } from 'react'
import { Search, User, AlertCircle, CheckCircle } from 'lucide-react'
import { Modal, Button, Input } from './ui'

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

export const GoldenRecordsSearch: React.FC<GoldenRecordsSearchProps> = ({
  isOpen,
  onClose,
  onRecordFound
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchType, setSearchType] = useState<'id' | 'name' | 'registration'>('id')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<GoldenRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Mock golden records data
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

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setError('Please enter a search term')
      return
    }

    setIsSearching(true)
    setError(null)
    setSearchResult(null)

    try {
      // Simulate API call to golden records
      await new Promise(resolve => setTimeout(resolve, 1500))

      let foundRecord: GoldenRecord | null = null

      switch (searchType) {
        case 'id':
          foundRecord = mockGoldenRecords.find(record => 
            record.idNumber.toLowerCase().includes(searchTerm.toLowerCase())
          ) || null
          break
        case 'name':
          foundRecord = mockGoldenRecords.find(record => 
            record.name.toLowerCase().includes(searchTerm.toLowerCase())
          ) || null
          break
        case 'registration':
          foundRecord = mockGoldenRecords.find(record => 
            record.registrationNumber?.toLowerCase().includes(searchTerm.toLowerCase())
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
                onClick={() => setSearchType('name')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  searchType === 'name'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Name
              </button>
              <button
                onClick={() => setSearchType('registration')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  searchType === 'registration'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Registration Number
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="mb-6">
            <Input
              type="text"
              placeholder={
                searchType === 'id' ? 'Enter ID number...' :
                searchType === 'name' ? 'Enter full name...' :
                'Enter registration number...'
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
