import React from 'react'
import { Building, FileText } from 'lucide-react'
import { Button } from '@/components/ui'
import { useNavigate } from 'react-router-dom'

const Bonds: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-navy-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-6">
            <Building className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Bonds Management
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Track and manage all property bonds and financing applications
          </p>
        </div>

        {/* Coming Soon Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center max-w-2xl mx-auto">
          <div className="flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mx-auto mb-4">
            <FileText className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-semibold text-blue-800 mb-2">Coming Soon</h2>
          <p className="text-blue-600 max-w-md mx-auto mb-6">
            Bond management features are currently under development. 
            This will include bond applications, approval tracking, and integration with your transfer workflow.
          </p>
          <div className="mt-6">
            <Button onClick={() => navigate('/dashboard')} className="bg-blue-600 text-white hover:bg-blue-700">
              Return to Dashboard
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { Bonds }
