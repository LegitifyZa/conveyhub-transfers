import React from 'react'
import { 
  RefreshCw, 
  Plus, 
  Search, 
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  User,
  Building,
  FileText,
  AlertTriangle
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'

const Cancellations: React.FC = () => {
  const stats = [
    {
      title: 'Pending Cancellations',
      value: '8',
      change: '+25%',
      changeType: 'positive' as const,
      icon: RefreshCw,
      description: 'From last month'
    },
    {
      title: 'Completed This Month',
      value: '12',
      change: '+15%',
      changeType: 'positive' as const,
      icon: ArrowUpRight,
      description: 'From last month'
    },
    {
      title: 'Under Review',
      value: '5',
      change: '-10%',
      changeType: 'negative' as const,
      icon: AlertTriangle,
      description: 'From last month'
    },
    {
      title: 'Total Processed',
      value: '$450K',
      change: '+18%',
      changeType: 'positive' as const,
      icon: Building,
      description: 'From last month'
    }
  ]

  const recentCancellations = [
    {
      id: 'CAN-001',
      client: 'John Smith',
      property: '123 Oak Street',
      originalTransferId: 'TRF-001',
      reason: 'Buyer financing fell through',
      status: 'Pending',
      refundAmount: '$15,000',
      requestedDate: '2024-03-10',
      assignedTo: 'Sarah Johnson',
      priority: 'High'
    },
    {
      id: 'CAN-002',
      client: 'Emily Davis',
      property: '456 Elm Avenue',
      originalTransferId: 'TRF-005',
      reason: 'Property inspection issues',
      status: 'Review',
      refundAmount: '$8,500',
      requestedDate: '2024-03-08',
      assignedTo: 'Michael Brown',
      priority: 'Medium'
    },
    {
      id: 'CAN-003',
      client: 'Robert Wilson',
      property: '789 Pine Road',
      originalTransferId: 'TRF-008',
      reason: 'Mutual agreement',
      status: 'Approved',
      refundAmount: '$22,000',
      requestedDate: '2024-03-05',
      assignedTo: 'Lisa Anderson',
      priority: 'Low'
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'badge-warning'
      case 'Review':
        return 'badge-primary'
      case 'Approved':
        return 'badge-success'
      case 'Rejected':
        return 'badge-danger'
      case 'Completed':
        return 'badge-success'
      default:
        return 'badge-secondary'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
      case 'Medium':
        return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
      case 'Low':
        return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
      default:
        return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20'
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Cancellations & Reversals</h1>
          <p className="text-gray-600 dark:text-gray-400">Process and track transfer cancellations and reversals</p>
        </div>
        <Button variant="premium-primary">
          <Plus className="h-4 w-4 mr-2" />
          New Cancellation
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <Card key={stat.title} variant="premium" className="stats-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="stats-value">{stat.value}</div>
              <div className="flex items-center space-x-2">
                {stat.changeType === 'positive' ? (
                  <ArrowUpRight className="h-3 w-3 text-green-500" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-red-500" />
                )}
                <span className={stat.changeType === 'positive' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                  {stat.change}
                </span>
                <span className="text-gray-500 text-xs">{stat.description}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card variant="premium">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search cancellations..."
                  className="pl-10"
                  variant="premium"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="premium-secondary" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                Filter
              </Button>
              <Button variant="premium-secondary" size="sm">
                Export
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cancellations Table */}
      <Card variant="premium">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">All Cancellations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-premium">
              <thead>
                <tr>
                  <th className="table-header">Cancellation ID</th>
                  <th className="table-header">Client</th>
                  <th className="table-header">Property</th>
                  <th className="table-header">Original Transfer</th>
                  <th className="table-header">Reason</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Priority</th>
                  <th className="table-header">Refund Amount</th>
                  <th className="table-header">Requested</th>
                  <th className="table-header">Assigned To</th>
                </tr>
              </thead>
              <tbody>
                {recentCancellations.map((cancellation) => (
                  <tr key={cancellation.id} className="table-row">
                    <td className="table-cell">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{cancellation.id}</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{cancellation.client}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300 text-sm">{cancellation.property}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <FileText className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{cancellation.originalTransferId}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className="text-gray-700 dark:text-gray-300 text-sm">{cancellation.reason}</span>
                    </td>
                    <td className="table-cell">
                      <span className={getStatusColor(cancellation.status)}>
                        {cancellation.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(cancellation.priority)}`}>
                        {cancellation.priority}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-1">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{cancellation.refundAmount}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{cancellation.requestedDate}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{cancellation.assignedTo}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Placeholder for future features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400">
                This section will contain quick action buttons for common cancellation operations.
              </p>
              <div className="space-y-2">
                <Button variant="premium-secondary" className="w-full justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Cancellation Notice
                </Button>
                <Button variant="premium-secondary" className="w-full justify-start">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Process Refund
                </Button>
                <Button variant="premium-secondary" className="w-full justify-start">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Flag for Review
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">High Priority Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400">
                This section will display high-priority cancellations requiring immediate attention.
              </p>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">CAN-001 - High Priority</p>
                  </div>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">Buyer financing issue - $15,000 refund</p>
                </div>
                <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4 text-yellow-500" />
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">CAN-002 - Review Required</p>
                  </div>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">Property inspection issues - $8,500 refund</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-navy-800/50">
                  <div className="flex items-center space-x-2">
                    <RefreshCw className="h-4 w-4 text-gray-500" />
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">CAN-003 - Approved</p>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Mutual agreement - $22,000 refund</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { Cancellations }
