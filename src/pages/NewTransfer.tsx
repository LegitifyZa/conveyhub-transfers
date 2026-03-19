import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { GoldenRecordsSearch } from '@/components/GoldenRecordsSearch'
import { Search, User, Building, ArrowRight } from 'lucide-react'

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

const NewTransfer: React.FC = () => {
  const navigate = useNavigate()
  const [showGoldenRecordsSearch, setShowGoldenRecordsSearch] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<GoldenRecord | null>(null)

  const handleSearchGoldenRecords = () => {
    setShowGoldenRecordsSearch(true)
  }

  const handleCreateNewTransfer = () => {
    navigate('/transfers/workflow')
  }

  const handleUseGoldenRecord = (record: GoldenRecord) => {
    setSelectedRecord(record)
    setShowGoldenRecordsSearch(false)
    
    // Navigate to transfer creation with pre-filled data
    navigate('/transfers/new', { 
      state: { 
        goldenRecord: record 
      } 
    })
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
            Would you like to search for existing information in Golden Records?
          </p>
        </div>

        {/* Golden Records Search Prompt */}
        <div className="max-w-4xl mx-auto">
          <Card className="mb-8">
            <CardContent className="p-8">
              <div className="text-center">
                <div className="flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mx-auto mb-6">
                  <Search className="w-8 h-8 text-yellow-600" />
                </div>
                
                <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Search Golden Records
                </h2>
                
                <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-lg mx-auto">
                  Search for existing user information in the Golden Records database. 
                  If found, we can pre-fill the transfer details with existing information.
                </p>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    onClick={handleSearchGoldenRecords}
                    className="flex-1 flex items-center justify-center space-x-2"
                  >
                    <Search className="w-5 h-5" />
                    <span>Search Golden Records</span>
                  </Button>
                  
                  <Button
                    onClick={handleCreateNewTransfer}
                    variant="outline"
                    className="flex-1 flex items-center justify-center space-x-2"
                  >
                    <User className="w-5 h-5" />
                    <span>Create New Transfer</span>
                  </Button>
                </div>

                {/* Selected Record Display */}
                {selectedRecord && (
                  <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-green-600 rounded-full"></div>
                        <span className="font-medium text-green-800">Record Selected</span>
                      </div>
                      <Button
                        onClick={() => navigate('/transfers/new', { state: { goldenRecord: selectedRecord } })}
                        size="sm"
                        className="flex items-center space-x-1"
                      >
                        Continue
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium text-gray-700">Name:</span>
                        <p className="text-gray-900">{selectedRecord.name}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">ID Number:</span>
                        <p className="text-gray-900">{selectedRecord.idNumber}</p>
                      </div>
                      {selectedRecord.email && (
                        <div>
                          <span className="font-medium text-gray-700">Email:</span>
                          <p className="text-gray-900">{selectedRecord.email}</p>
                        </div>
                      )}
                      {selectedRecord.phone && (
                        <div>
                          <span className="font-medium text-gray-700">Phone:</span>
                          <p className="text-gray-900">{selectedRecord.phone}</p>
                        </div>
                      )}
                      {selectedRecord.address && (
                        <div className="md:col-span-2">
                          <span className="font-medium text-gray-700">Address:</span>
                          <p className="text-gray-900">{selectedRecord.address}</p>
                        </div>
                      )}
                      {selectedRecord.propertyAddress && (
                        <div className="md:col-span-2">
                          <span className="font-medium text-gray-700">Property Address:</span>
                          <p className="text-gray-900">{selectedRecord.propertyAddress}</p>
                        </div>
                      )}
                      {selectedRecord.propertyValue && (
                        <div>
                          <span className="font-medium text-gray-700">Property Value:</span>
                          <p className="text-gray-900">
                            R {selectedRecord.propertyValue.toLocaleString('en-ZA')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Help Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <User className="w-5 h-5" />
                <span>How it works</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-semibold text-sm">1</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">Search Records</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Search by ID number, name, or registration number to find existing user information.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-semibold text-sm">2</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">Review Results</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Review the found information and decide whether to use it or create a new transfer.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-semibold text-sm">3</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">Complete Transfer</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Proceed with the transfer workflow using either the found information or new details.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Golden Records Search Modal */}
      <GoldenRecordsSearch
        isOpen={showGoldenRecordsSearch}
        onClose={() => setShowGoldenRecordsSearch(false)}
        onRecordFound={handleUseGoldenRecord}
      />
    </div>
  )
}

export { NewTransfer }
