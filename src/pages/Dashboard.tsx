import React, { useEffect, useMemo, useState } from 'react'
import { 
  TrendingUp, 
  Users, 
  FileText, 
  Clock, 
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Building,
  Mail
} from 'lucide-react'
import { formatZAR } from '@/utils/transferCalculations'
import { Card, CardHeader, CardTitle, CardContent, EmailModal } from '@/components/ui'
import { Button } from '@/components/ui'
import { useTransfers } from '@/hooks/useTransfers'

const Dashboard: React.FC = () => {
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false)
  const { transfers, isLoading, fetchTransfers } = useTransfers()

  useEffect(() => {
    fetchTransfers({ limit: 50 })
  }, [fetchTransfers])

  const handleSendEmail = (emailData: any) => {
    console.log('Email sent:', emailData)
    // Here you would integrate with your email service
    // For now, we'll just log it
    alert(`Email sent to ${emailData.clientName} at ${emailData.to}`)
  }

  const activeCount = useMemo(() => transfers.filter(t => t.status === 'in_progress').length, [transfers])
  const draftCount = useMemo(() => transfers.filter(t => t.status === 'draft').length, [transfers])
  const totalRevenue = useMemo(() => transfers.reduce((sum, t) => sum + (parseFloat(t.financials?.purchasePrice || '0') || 0), 0), [transfers])
  const uniqueParties = useMemo(() => {
    const names = new Set<string>()
    transfers.forEach(t => t.parties?.forEach(p => { if (p.name) names.add(p.name) }))
    return names.size
  }, [transfers])

  const stats = [
    {
      title: 'Active Cases',
      value: String(activeCount),
      change: '',
      changeType: 'positive' as const,
      icon: FileText,
      description: 'In progress'
    },
    {
      title: 'Total Clients',
      value: String(uniqueParties),
      change: '',
      changeType: 'positive' as const,
      icon: Users,
      description: 'Unique parties'
    },
    {
      title: 'Revenue',
      value: formatZAR(totalRevenue),
      change: '',
      changeType: 'positive' as const,
      icon: TrendingUp,
      description: 'Total purchase prices'
    },
    {
      title: 'Draft Transfers',
      value: String(draftCount),
      change: '',
      changeType: 'negative' as const,
      icon: Clock,
      description: 'Awaiting action'
    }
  ]

  const recentCases = useMemo(() => {
    return transfers.slice(0, 5).map(t => {
      const buyer = t.parties?.find(p => p.type === 'buyer')
      return {
        id: t.transfer_id || t.id || '—',
        client: buyer?.name || 'Unknown',
        property: t.propertyDetails?.address || '—',
        status: t.status || 'draft',
        value: formatZAR(parseFloat(t.financials?.purchasePrice || '0') || 0),
        dueDate: t.next_due_date ? new Date(t.next_due_date).toLocaleString('en-ZA', { dateStyle: 'medium' }) : '—'
      }
    })
  }, [transfers])

  const upcomingEvents = [
    {
      title: 'Property Closing - Smith',
      time: '10:00 AM',
      type: 'closing'
    },
    {
      title: 'Document Review - Johnson',
      time: '2:00 PM',
      type: 'review'
    },
    {
      title: 'Client Meeting - Brown',
      time: '4:30 PM',
      type: 'meeting'
    }
  ]

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400">Welcome back, John. Here's what's happening today.</p>
        </div>
        <div className="flex space-x-3">
          <Button variant="premium-primary" onClick={() => setIsEmailModalOpen(true)}>
            <Mail className="h-4 w-4 mr-2" />
            Send Email
          </Button>
          <Button variant="premium-primary">
            <Calendar className="h-4 w-4 mr-2" />
            Schedule Meeting
          </Button>
        </div>
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
              <div className="stats-value">{isLoading ? '—' : stat.value}</div>
              <div className="flex items-center space-x-2">
                {stat.change && (stat.changeType === 'positive' ? (
                  <ArrowUpRight className="h-3 w-3 text-green-500" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-red-500" />
                ))}
                {stat.change && (
                  <span className={stat.changeType === 'positive' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                    {stat.change}
                  </span>
                )}
                <span className="text-gray-500 text-xs">{stat.description}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Cases */}
        <Card variant="premium" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Recent Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentCases.map((case_) => (
                <div key={case_.id} className="flex items-center justify-between p-4 border border-gray-200 dark:border-navy-700 rounded-xl hover:bg-gray-50 dark:hover:bg-navy-800/50 transition-colors duration-200">
                  <div className="flex items-center space-x-4">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-teal-500 to-navy-600 flex items-center justify-center shadow-soft">
                      <Building className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{case_.client}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{case_.property}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{case_.value}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{case_.dueDate}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Events */}
        <Card variant="premium">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Today's Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {upcomingEvents.map((event, index) => (
                <div key={index} className="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-navy-800/50 transition-colors duration-200">
                  <div className="h-2 w-2 bg-teal-500 rounded-full mt-2"></div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{event.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{event.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Email Modal */}
      <EmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        onSendEmail={handleSendEmail}
      />
    </div>
  )
}

export { Dashboard }
