import React, { useEffect, useMemo, useState } from 'react'
import { 
  Search, 
  Filter, 
  Plus, 
  MoreVertical,
  Building,
  User,
  Calendar
} from 'lucide-react'
import { formatZAR } from '@/utils/transferCalculations'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { useTransfers } from '@/hooks/useTransfers'

const Cases: React.FC = () => {
  const { transfers, fetchTransfers } = useTransfers()
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchTransfers({ limit: 50 })
  }, [fetchTransfers])

  const cases = useMemo(() => {
    return transfers
      .filter(t => {
        if (!searchTerm) return true
        const term = searchTerm.toLowerCase()
        const buyer = t.parties?.find(p => p.type === 'buyer')
        return (
          (t.transfer_id || '').toLowerCase().includes(term) ||
          (buyer?.name || '').toLowerCase().includes(term) ||
          (t.propertyDetails?.address || '').toLowerCase().includes(term)
        )
      })
      .map(t => {
        const buyer = t.parties?.find(p => p.type === 'buyer')
        const statusMap: Record<string, string> = { draft: 'Pending', in_progress: 'In Progress', completed: 'Completed' }
        return {
          id: t.transfer_id || t.id || '—',
          client: buyer?.name || 'Unknown',
          property: t.propertyDetails?.address || '—',
          type: t.propertyDetails?.propertyType || 'Residential',
          status: statusMap[t.status || 'draft'] || 'Pending',
          value: formatZAR(parseFloat(t.financials?.purchasePrice || '0') || 0),
          assignedTo: '—',
          dueDate: t.created_at ? new Date(t.created_at).toISOString().split('T')[0] : '—',
          priority: t.status === 'in_progress' ? 'high' : t.status === 'draft' ? 'medium' : 'low'
        }
      })
  }, [transfers, searchTerm])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'In Progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
      case 'Review':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
      case 'Pending':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
      case 'Completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cases</h1>
          <p className="text-gray-600 dark:text-gray-400">Manage and track all conveyancing cases</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Case
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search cases..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                Filter
              </Button>
              <Button variant="outline" size="sm">
                Export
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cases Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Cases</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-navy-700">
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Case ID</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Client</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Property</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Type</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Value</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Assigned To</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Due Date</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300">Priority</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700 dark:text-gray-300"></th>
                </tr>
              </thead>
              <tbody>
                {cases.map((case_) => (
                  <tr key={case_.id} className="border-b border-gray-100 dark:border-navy-800 hover:bg-gray-50 dark:hover:bg-navy-800/50">
                    <td className="py-3 px-4">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{case_.id}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{case_.client}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300 text-sm">{case_.property}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-700 dark:text-gray-300">{case_.type}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(case_.status)}`}>
                        {case_.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{case_.value}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-700 dark:text-gray-300">{case_.assignedTo}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700 dark:text-gray-300">{case_.dueDate}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(case_.priority)}`}>
                        {case_.priority}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { Cases }
