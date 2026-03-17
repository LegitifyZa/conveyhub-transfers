import React from 'react'
import { 
  TrendingUp, 
  Users, 
  FileText, 
  Clock, 
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Building
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'

const Dashboard: React.FC = () => {
  const stats = [
    {
      title: 'Active Cases',
      value: '47',
      change: '+12%',
      changeType: 'positive' as const,
      icon: FileText,
      description: 'From last month'
    },
    {
      title: 'Total Clients',
      value: '238',
      change: '+8%',
      changeType: 'positive' as const,
      icon: Users,
      description: 'From last month'
    },
    {
      title: 'Revenue',
      value: '$124,500',
      change: '+23%',
      changeType: 'positive' as const,
      icon: TrendingUp,
      description: 'From last month'
    },
    {
      title: 'Pending Tasks',
      value: '19',
      change: '-5%',
      changeType: 'negative' as const,
      icon: Clock,
      description: 'From last month'
    }
  ]

  const recentCases = [
    {
      id: 'CASE-001',
      client: 'John Smith',
      property: '123 Oak Street',
      status: 'In Progress',
      value: '$450,000',
      dueDate: '2024-03-25'
    },
    {
      id: 'CASE-002',
      client: 'Sarah Johnson',
      property: '456 Elm Avenue',
      status: 'Review',
      value: '$325,000',
      dueDate: '2024-03-28'
    },
    {
      id: 'CASE-003',
      client: 'Michael Brown',
      property: '789 Pine Road',
      status: 'Pending',
      value: '$580,000',
      dueDate: '2024-04-01'
    }
  ]

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
        <Button variant="premium-primary">
          <Calendar className="h-4 w-4 mr-2" />
          Schedule Meeting
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
    </div>
  )
}

export { Dashboard }
