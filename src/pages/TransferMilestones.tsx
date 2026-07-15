import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Clock, Circle, AlertCircle, Calendar, Building, User, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Badge } from '@/components/ui'

export type MilestoneStatus = 'not_started' | 'in_progress' | 'completed' | 'overdue'

export interface Milestone {
  id: string
  name: string
  statusLabel: string
  status: MilestoneStatus
  completedDate?: string
  dueDate?: string
  notes?: string
}

const INITIAL_MILESTONES: Milestone[] = [
  { id: '1', name: 'Transferor', statusLabel: 'FICA Received', status: 'not_started' },
  { id: '2', name: 'Transferee', statusLabel: 'FICA Received', status: 'not_started' },
  { id: '3', name: 'Guarantees', statusLabel: 'Guarantee/s Due Date', status: 'not_started' },
  { id: '4', name: 'Transfer Duty', statusLabel: 'Applied', status: 'not_started' },
  { id: '5', name: 'Rates', statusLabel: 'Figures Requested', status: 'not_started' },
  { id: '6', name: 'Levies', statusLabel: 'Figures Requested', status: 'not_started' },
  { id: '7', name: 'Home Owners', statusLabel: 'Consent Requested', status: 'not_started' },
  { id: '8', name: 'Electrical', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '9', name: 'Entomologist', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '10', name: 'Electric Fence', statusLabel: 'Certificate Received', status: 'not_started' },
  { id: '11', name: 'Gas Conformity', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '12', name: 'Plumbing', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '13', name: 'Instruction', statusLabel: 'Instruction received', status: 'not_started' },
  { id: '14', name: 'Deposit', statusLabel: 'Deposit Due', status: 'not_started' },
  { id: '15', name: 'New Bond', statusLabel: 'Bond Grant Due', status: 'not_started' },
  { id: '16', name: 'Subject to Sale', statusLabel: 'Due Date', status: 'not_started' },
  { id: '17', name: "Suspensive Cond's", statusLabel: 'All Conditions met', status: 'not_started' },
  { id: '18', name: 'Bond Cancellation', statusLabel: 'Figures Requested', status: 'not_started' },
  { id: '19', name: 'Title Deed', statusLabel: 'Title Deed Requested', status: 'not_started' },
  { id: '20', name: 'Transfer Costs', statusLabel: 'Proforma Sent', status: 'not_started' },
  { id: '21', name: 'FICA', statusLabel: 'Certified', status: 'not_started' },
  { id: '22', name: 'Pool', statusLabel: 'Certificate Requested', status: 'not_started' },
  { id: '23', name: 'Transfer Registration Complete', statusLabel: '5 days after reg', status: 'not_started' }
]

// Mock transfer data (would come from backend)
const getTransferData = (id: string) => ({
  id,
  propertyAddress: id === 'TRF-001' ? '123 Main Street, Cape Town' : '321 Elm Street, Pretoria',
  buyerName: id === 'TRF-001' ? 'John Smith' : 'Robert Wilson',
  sellerName: id === 'TRF-001' ? 'Jane Doe' : 'Lisa Anderson',
  purchasePrice: id === 'TRF-001' ? 2500000 : 1500000,
  createdDate: id === 'TRF-001' ? '2024-03-15' : '2024-03-12'
})

const TransferMilestones: React.FC = () => {
  const { transferId } = useParams<{ transferId: string }>()
  const navigate = useNavigate()
  const [milestones, setMilestones] = useState<Milestone[]>(INITIAL_MILESTONES)
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null)

  const transfer = getTransferData(transferId || 'TRF-001')

  const completedCount = milestones.filter(m => m.status === 'completed').length
  const inProgressCount = milestones.filter(m => m.status === 'in_progress').length
  const progress = Math.round((completedCount / milestones.length) * 100)

  const updateMilestoneStatus = (id: string, newStatus: MilestoneStatus) => {
    setMilestones(prev => prev.map(m =>
      m.id === id
        ? {
            ...m,
            status: newStatus,
            completedDate: newStatus === 'completed' ? new Date().toISOString().split('T')[0] : m.completedDate
          }
        : m
    ))
  }

  const updateMilestoneNotes = (id: string, notes: string) => {
    setMilestones(prev => prev.map(m =>
      m.id === id ? { ...m, notes } : m
    ))
  }

  const updateMilestoneDueDate = (id: string, dueDate: string) => {
    setMilestones(prev => prev.map(m =>
      m.id === id ? { ...m, dueDate } : m
    ))
  }

  const getStatusIcon = (status: MilestoneStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
      case 'in_progress':
        return <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
      case 'overdue':
        return <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
      default:
        return <Circle className="h-5 w-5 text-gray-400 dark:text-gray-500" />
    }
  }

  const getStatusBadgeVariant = (status: MilestoneStatus): 'success' | 'primary' | 'error' | 'default' => {
    switch (status) {
      case 'completed': return 'success'
      case 'in_progress': return 'primary'
      case 'overdue': return 'error'
      default: return 'default'
    }
  }

  const getStatusText = (status: MilestoneStatus) => {
    switch (status) {
      case 'completed': return 'Completed'
      case 'in_progress': return 'In Progress'
      case 'overdue': return 'Overdue'
      default: return 'Not Started'
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/transfers')}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Transfers
          </Button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                Transfer Milestones
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Track progress for {transfer.id}
              </p>
            </div>
          </div>
        </div>

        {/* Transfer Summary */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex items-center space-x-2">
                <Building className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Property</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transfer.propertyAddress}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <User className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Buyer</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transfer.buyerName}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <User className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Seller</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transfer.sellerName}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Purchase Price</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatCurrency(transfer.purchasePrice)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{progress}%</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Overall Progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{completedCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{inProgressCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">In Progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{milestones.length - completedCount - inProgressCount}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Remaining</p>
            </CardContent>
          </Card>
        </div>

        {/* Progress Bar */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Milestone Progress</span>
              <span className="text-sm text-gray-600 dark:text-gray-400">{completedCount} of {milestones.length} completed</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
              <div
                className="bg-teal-600 h-3 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Milestones List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Calendar className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>Milestones</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {milestones.map((milestone, index) => (
                <div
                  key={milestone.id}
                  className="border border-gray-200 dark:border-navy-700 rounded-lg transition-all duration-200 hover:shadow-sm"
                >
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer"
                    onClick={() => setExpandedMilestone(expandedMilestone === milestone.id ? null : milestone.id)}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-navy-700 text-sm font-medium text-gray-600 dark:text-gray-400">
                        {index + 1}
                      </div>
                      {getStatusIcon(milestone.status)}
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">{milestone.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{milestone.statusLabel}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <Badge variant={getStatusBadgeVariant(milestone.status)} size="sm">
                        {getStatusText(milestone.status)}
                      </Badge>
                      {milestone.dueDate && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Due: {milestone.dueDate}
                        </span>
                      )}
                      {expandedMilestone === milestone.id ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedMilestone === milestone.id && (
                    <div className="px-4 pb-4 border-t border-gray-200 dark:border-navy-700 pt-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Status
                          </label>
                          <select
                            value={milestone.status}
                            onChange={(e) => updateMilestoneStatus(milestone.id, e.target.value as MilestoneStatus)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                          >
                            <option value="not_started">Not Started</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Completed</option>
                            <option value="overdue">Overdue</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Due Date
                          </label>
                          <input
                            type="date"
                            value={milestone.dueDate || ''}
                            onChange={(e) => updateMilestoneDueDate(milestone.id, e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Notes
                        </label>
                        <textarea
                          value={milestone.notes || ''}
                          onChange={(e) => updateMilestoneNotes(milestone.id, e.target.value)}
                          placeholder="Add notes for this milestone..."
                          rows={2}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                        />
                      </div>
                      {milestone.completedDate && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Completed on {milestone.completedDate}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { TransferMilestones }
