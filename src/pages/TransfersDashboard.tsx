import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Calendar, User, Building, FileText, TrendingUp, MoreVertical } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { Badge } from '@/components/ui'

// Mock transfer data
const mockTransfers = [
  {
    id: 'TRF-001',
    propertyAddress: '123 Main Street, Cape Town',
    buyerName: 'John Smith',
    sellerName: 'Jane Doe',
    purchasePrice: 2500000,
    status: 'in_progress',
    createdDate: '2024-03-15',
    currentStep: 2,
    totalSteps: 5,
    progress: 40
  },
  {
    id: 'TRF-002',
    propertyAddress: '456 Oak Avenue, Johannesburg',
    buyerName: 'Michael Johnson',
    sellerName: 'Sarah Williams',
    purchasePrice: 1800000,
    status: 'completed',
    createdDate: '2024-03-10',
    currentStep: 5,
    totalSteps: 5,
    progress: 100
  },
  {
    id: 'TRF-003',
    propertyAddress: '789 Pine Road, Durban',
    buyerName: 'David Brown',
    sellerName: 'Emily Davis',
    purchasePrice: 3200000,
    status: 'draft',
    createdDate: '2024-03-18',
    currentStep: 1,
    totalSteps: 5,
    progress: 20
  },
  {
    id: 'TRF-004',
    propertyAddress: '321 Elm Street, Pretoria',
    buyerName: 'Robert Wilson',
    sellerName: 'Lisa Anderson',
    purchasePrice: 1500000,
    status: 'in_progress',
    createdDate: '2024-03-12',
    currentStep: 3,
    totalSteps: 5,
    progress: 60
  }
]

const TransfersDashboard: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
      case 'draft':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Completed'
      case 'in_progress':
        return 'In Progress'
      case 'draft':
        return 'Draft'
      default:
        return 'Unknown'
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  const filteredTransfers = mockTransfers.filter(transfer => {
    const matchesSearch = transfer.propertyAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         transfer.buyerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         transfer.sellerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         transfer.id.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesFilter = filterStatus === 'all' || transfer.status === filterStatus
    
    return matchesSearch && matchesFilter
  })

  const stats = {
    total: mockTransfers.length,
    completed: mockTransfers.filter(t => t.status === 'completed').length,
    inProgress: mockTransfers.filter(t => t.status === 'in_progress').length,
    draft: mockTransfers.filter(t => t.status === 'draft').length
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                Property Transfers
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Manage and track all property transfer applications
              </p>
            </div>
            <Link to="/transfers/new">
              <Button variant="premium-primary" className="flex items-center space-x-2">
                <Plus className="w-4 h-4" />
                <span>New Transfer</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Total Transfers</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Completed</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.completed}</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">In Progress</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.inProgress}</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Draft</p>
                  <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{stats.draft}</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-900/20 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search transfers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={filterStatus === 'all' ? 'primary' : 'secondary'}
                  onClick={() => setFilterStatus('all')}
                  size="sm"
                >
                  All
                </Button>
                <Button
                  variant={filterStatus === 'in_progress' ? 'primary' : 'secondary'}
                  onClick={() => setFilterStatus('in_progress')}
                  size="sm"
                >
                  In Progress
                </Button>
                <Button
                  variant={filterStatus === 'completed' ? 'primary' : 'secondary'}
                  onClick={() => setFilterStatus('completed')}
                  size="sm"
                >
                  Completed
                </Button>
                <Button
                  variant={filterStatus === 'draft' ? 'primary' : 'secondary'}
                  onClick={() => setFilterStatus('draft')}
                  size="sm"
                >
                  Draft
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transfers List */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Transfers</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredTransfers.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-900/20 flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                  No transfers found
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {searchTerm ? 'Try adjusting your search terms' : 'Get started by creating your first transfer'}
                </p>
                {!searchTerm && (
                  <Link to="/transfers/new">
                    <Button variant="premium-primary">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Transfer
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredTransfers.map((transfer) => (
                  <div key={transfer.id} className="border border-gray-200 dark:border-navy-700 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3 mb-2">
                          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 truncate">
                            {transfer.id}
                          </h3>
                          <Badge className={getStatusColor(transfer.status)}>
                            {getStatusText(transfer.status)}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                          <div className="flex items-center space-x-2">
                            <Building className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                              {transfer.propertyAddress}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {transfer.buyerName}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {formatCurrency(transfer.purchasePrice)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                            <span>Created {transfer.createdDate}</span>
                            <span>Step {transfer.currentStep} of {transfer.totalSteps}</span>
                          </div>
                          
                          <div className="flex items-center space-x-3">
                            <div className="w-32">
                              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                                <span>Progress</span>
                                <span>{transfer.progress}%</span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                <div
                                  className="bg-teal-600 h-2 rounded-full transition-all duration-300"
                                  style={{ width: `${transfer.progress}%` }}
                                />
                              </div>
                            </div>
                            
                            <Link to={`/transfers/${transfer.id}`}>
                              <Button variant="secondary" size="sm">
                                View Details
                              </Button>
                            </Link>
                            
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { TransfersDashboard }
