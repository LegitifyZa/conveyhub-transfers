import React from 'react'
import { 
  Shield, 
  Plus, 
  Search, 
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  User,
  Building,
  FileText
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'

const Bonds: React.FC = () => {
  const stats = [
    {
      title: 'Active Bonds',
      value: '15',
      change: '+8%',
      changeType: 'positive' as const,
      icon: Shield,
      description: 'From last month'
    },
    {
      title: 'Total Bond Value',
      value: '$1.2M',
      change: '+12%',
      changeType: 'positive' as const,
      icon: ArrowUpRight,
      description: 'From last month'
    },
    {
      title: 'Pending Approval',
      value: '3',
      change: '-25%',
      changeType: 'negative' as const,
      icon: Calendar,
      description: 'From last month'
    },
    {
      title: 'Expiring Soon',
      value: '4',
      change: '+0%',
      changeType: 'positive' as const,
      icon: Building,
      description: 'Next 30 days'
    }
  ]

  const recentBonds = [
    {
      id: 'BND-001',
      client: 'ABC Corporation',
      property: '789 Business Park',
      type: 'Performance Bond',
      amount: '$250,000',
      status: 'Active',
      issuedDate: '2024-01-15',
      expiryDate: '2025-01-15',
      assignedTo: 'Sarah Johnson'
    },
    {
      id: 'BND-002',
      client: 'XYZ Properties',
      property: '456 Commercial Plaza',
      type: 'Surety Bond',
      amount: '$180,000',
      status: 'Pending',
      issuedDate: '2024-03-01',
      expiryDate: '2025-03-01',
      assignedTo: 'Michael Brown'
    },
    {
      id: 'BND-003',
      client: 'DEF Investments',
      property: '123 Industrial Estate',
      type: 'Maintenance Bond',
      amount: '$95,000',
      status: 'Active',
      issuedDate: '2023-12-01',
      expiryDate: '2024-12-01',
      assignedTo: 'Lisa Anderson'
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active':
        return 'badge-success'
      case 'Pending':
        return 'badge-warning'
      case 'Expired':
        return 'badge-danger'
      case 'Cancelled':
        return 'badge-secondary'
      default:
        return 'badge-secondary'
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Property Bonds</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage performance, surety, and maintenance bonds</p>
        </div>
        <Button variant="premium-primary">
          <Plus className="h-4 w-4 mr-2" />
          New Bond
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
                  placeholder="Search bonds..."
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

      {/* Bonds Table */}
      <Card variant="premium">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">All Bonds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-premium">
              <thead>
                <tr>
                  <th className="table-header">Bond ID</th>
                  <th className="table-header">Client</th>
                  <th className="table-header">Property</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Issued</th>
                  <th className="table-header">Expiry</th>
                  <th className="table-header">Assigned To</th>
                </tr>
              </thead>
              <tbody>
                {recentBonds.map((bond) => (
                  <tr key={bond.id} className="table-row">
                    <td className="table-cell">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{bond.id}</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{bond.client}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300 text-sm">{bond.property}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className="text-gray-700 dark:text-gray-300">{bond.type}</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-1">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{bond.amount}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className={getStatusColor(bond.status)}>
                        {bond.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{bond.issuedDate}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{bond.expiryDate}</span>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{bond.assignedTo}</span>
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
                This section will contain quick action buttons for common bond operations.
              </p>
              <div className="space-y-2">
                <Button variant="premium-secondary" className="w-full justify-start">
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Bond Certificate
                </Button>
                <Button variant="premium-secondary" className="w-full justify-start">
                  <Calendar className="h-4 w-4 mr-2" />
                  Schedule Bond Renewal
                </Button>
                <Button variant="premium-secondary" className="w-full justify-start">
                  <Shield className="h-4 w-4 mr-2" />
                  Update Bond Status
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Upcoming Expirations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400">
                This section will display bonds expiring soon and renewal notifications.
              </p>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">BND-003 expiring in 30 days</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">DEF Investments - $95,000</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-navy-800/50">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">BND-001 renewal due in 90 days</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">ABC Corporation - $250,000</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-navy-800/50">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">BND-002 approval pending</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">XYZ Properties - $180,000</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { Bonds }
