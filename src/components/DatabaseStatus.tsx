import React from 'react'
import { useDatabase } from '../hooks/useDatabase'
import { Card, CardHeader, CardTitle, CardContent } from './ui'
import { Badge } from './ui'
import { CheckCircle, AlertCircle, Database } from 'lucide-react'

export const DatabaseStatus: React.FC = () => {
  const { isConnected, isLoading, error, stats, testConnection, refreshStats } = useDatabase()

  const handleTestConnection = async () => {
    await testConnection()
  }

  const handleRefreshStats = async () => {
    await refreshStats()
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center space-x-3">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-600">Connecting to database...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Database className="w-5 h-5" />
          <span>Database Status</span>
          <Badge variant={isConnected ? 'success' : 'error'}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Connection Error</span>
            </div>
            <p className="text-sm text-gray-600">{error}</p>
            <button
              onClick={handleTestConnection}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Successfully Connected</span>
            </div>
            
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{stats.transfers}</div>
                  <div className="text-sm text-gray-600">Transfers</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{stats.parties}</div>
                  <div className="text-sm text-gray-600">Parties</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{stats.documents}</div>
                  <div className="text-sm text-gray-600">Documents</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{stats.users}</div>
                  <div className="text-sm text-gray-600">Users</div>
                </div>
              </div>
            )}

            <div className="flex space-x-2">
              <button
                onClick={handleTestConnection}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Test Connection
              </button>
              <button
                onClick={handleRefreshStats}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Refresh Stats
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
