import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { useNavigate } from 'react-router-dom'

const Cancellations: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-orange-100 rounded-full mb-6">
            <RefreshCw className="w-10 h-10 text-orange-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Cancellations Management
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Track and manage all transfer cancellations and refunds
          </p>
        </div>

        {/* Coming Soon Banner */}
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-8 text-center max-w-2xl mx-auto">
          <div className="flex items-center justify-center w-16 h-16 bg-orange-100 rounded-full mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-orange-600" />
          </div>
          <h2 className="text-2xl font-semibold text-orange-800 mb-2">Coming Soon</h2>
          <p className="text-orange-600 max-w-md mx-auto mb-6">
            Cancellation management features are currently under development. 
            This will include cancellation tracking, refund processing, and audit trail integration.
          </p>
          <div className="mt-6">
            <Button onClick={() => navigate('/dashboard')} className="bg-orange-600 text-white hover:bg-orange-700">
              Return to Dashboard
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { Cancellations }
