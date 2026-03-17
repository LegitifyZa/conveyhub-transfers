import React from 'react'
import { FileText, Shield, RefreshCw } from 'lucide-react'
import { Button, ServiceCard } from '@/components/ui'

const Landing: React.FC = () => {
  const serviceCards = [
    {
      title: 'Transfers',
      description: 'Handle property transfers efficiently with automated workflows and document management.',
      icon: FileText,
      route: '/transfers'
    },
    {
      title: 'Bonds',
      description: 'Manage property bonds and surety agreements with comprehensive tracking.',
      icon: Shield,
      route: '/bonds'
    },
    {
      title: 'Cancellations',
      description: 'Process cancellations and reversals with proper documentation and compliance.',
      icon: RefreshCw,
      route: '/cancellations'
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-navy-900 dark:via-navy-800 dark:to-navy-900">
      {/* Navigation */}
      <nav className="nav-premium">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-y-0">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-teal-500 to-navy-600 flex items-center justify-center shadow-soft">
                <span className="text-white font-bold text-sm">L</span>
              </div>
              <span className="text-xl font-bold text-gray-900 dark:text-gray-100 ml-2">
                Legitify Convey Hub
              </span>
            </div>
            <Button variant="premium-secondary">
              Login
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative py-20 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <div className="max-w-4xl mx-auto space-y-6">
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Modern Conveyancing, Simplified
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl mx-auto">
              Manage transfers, bonds, and cancellations in one unified platform
            </p>
          </div>
        </div>
      </section>

      {/* Main Action Section */}
      <section className="pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {serviceCards.map((card) => (
              <ServiceCard
                key={card.title}
                title={card.title}
                description={card.description}
                icon={card.icon}
                route={card.route}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-navy-700 bg-white/80 dark:bg-navy-800/80 backdrop-blur-xs">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
            <div className="flex items-center space-y-0">
              <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-teal-500 to-navy-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">L</span>
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                Legitify Convey Hub
              </span>
            </div>
            
            <div className="flex space-x-8">
              <button className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors duration-200">
                Terms
              </button>
              <button className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors duration-200">
                Privacy
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export { Landing }
