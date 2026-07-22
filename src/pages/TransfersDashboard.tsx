import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Calendar, User, Building, FileText, TrendingUp } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { Badge } from '@/components/ui'
import { useTransfers, TransferAggregate } from '@/hooks/useTransfers'

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
  }).format(amount || 0)
}

const getTransferDisplay = (transfer: TransferAggregate) => {
  const id = transfer.transfer_id || transfer.id || '—'
  const propertyAddress = transfer.propertyDetails?.address || '—'
  const buyer = transfer.parties?.find(p => p.type === 'buyer')
  const buyerName = buyer?.name || 'Unknown buyer'
  const purchasePrice = parseFloat(transfer.financials?.purchasePrice || '0') || 0
  const createdDate = transfer.created_at
    ? new Date(transfer.created_at).toISOString().split('T')[0]
    : '—'
  const currentStep = transfer.currentStep || 1
  const progress = Math.min(100, Math.round((currentStep / 5) * 100))

  return {
    id,
    propertyAddress,
    buyerName,
    purchasePrice,
    status: transfer.status || 'draft',
    createdDate,
    currentStep,
    totalSteps: 5,
    progress
  }
}

const TransfersDashboard: React.FC = () => {
  const navigate = useNavigate()
  const { transfers, isLoading, error, fetchTransfers } = useTransfers()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => {
    fetchTransfers(filterStatus === 'all' ? {} : { status: filterStatus })
  }, [fetchTransfers, filterStatus])

  const filteredTransfers = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    if (!term) return transfers
    return transfers.filter(transfer => {
      const display = getTransferDisplay(transfer)
      return (
        display.propertyAddress.toLowerCase().includes(term) ||
        display.buyerName.toLowerCase().includes(term) ||
        display.id.toLowerCase().includes(term)
      )
    })
  }, [transfers, searchTerm])

  const stats = useMemo(() => {
    const counts = {
      total: transfers.length,
      completed: transfers.filter(t => t.status === 'completed').length,
      inProgress: transfers.filter(t => t.status === 'in_progress').length,
      draft: transfers.filter(t => t.status === 'draft').length
    }
    return counts
  }, [transfers])

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

        {/* Status Messages */}
        {isLoading && (
          <div className="text-center py-8 text-gray-600 dark:text-gray-400">
            Loading transfers...
          </div>
        )}
        {error && !isLoading && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Transfers List */}
        {!isLoading && (
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
                  {filteredTransfers.map((transfer) => {
                    const display = getTransferDisplay(transfer)
                    return (
                      <div key={display.id} className="border border-gray-200 dark:border-navy-700 rounded-lg p-3 hover:shadow-md transition-shadow">
                        <div className="flex flex-col md:flex-row md:items-center gap-3">
                          <div className="flex items-center gap-2 min-w-0 md:w-48">
                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {display.id}
                            </h3>
                            <Badge className={getStatusColor(display.status)} size="sm">
                              {getStatusText(display.status)}
                            </Badge>
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-gray-600 dark:text-gray-400">
                            <span className="flex items-center gap-1.5 truncate" title={display.propertyAddress}>
                              <Building className="w-4 h-4 flex-shrink-0 text-gray-400" />
                              <span className="truncate">{display.propertyAddress}</span>
                            </span>
                            <span className="flex items-center gap-1.5 truncate" title={display.buyerName}>
                              <User className="w-4 h-4 flex-shrink-0 text-gray-400" />
                              <span className="truncate">{display.buyerName}</span>
                            </span>
                            <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                              {formatCurrency(display.purchasePrice)}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-24 hidden sm:block">
                              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                                <span>Progress</span>
                                <span>{display.progress}%</span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                                <div
                                  className="bg-teal-600 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${display.progress}%` }}
                                />
                              </div>
                            </div>

                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                if (display.status === 'in_progress') {
                                  navigate(`/transfers/${display.id}/milestones`)
                                } else {
                                  navigate('/transfers/workflow', { state: { transferId: display.id } })
                                }
                              }}
                            >
                              {display.status === 'in_progress' ? 'Milestones' : 'Details'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export { TransfersDashboard }
