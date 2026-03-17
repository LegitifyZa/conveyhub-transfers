import React from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useNavigate } from 'react-router-dom'

export interface ServiceCardProps {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  route: string
  className?: string
}

const ServiceCard: React.FC<ServiceCardProps> = ({
  title,
  description,
  icon: Icon,
  route,
  className
}) => {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(route)
  }

  return (
    <div
      onClick={handleClick}
      className={cn(
        'card-glow group cursor-pointer p-8',
        className
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      aria-label={`Navigate to ${title}`}
    >
      <div className="space-y-6">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-teal-500 to-navy-600 flex items-center justify-center shadow-soft group-hover:shadow-premium transition-all duration-250 group-hover:scale-110">
          <Icon className="h-8 w-8 text-white" />
        </div>
        
        <div className="space-y-4">
          <h3 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {title}
          </h3>
          
          <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
            {description}
          </p>
        </div>
        
        <div className="flex items-center text-teal-600 dark:text-teal-400 font-semibold transition-all duration-250 group-hover:text-teal-700 dark:group-hover:text-teal-300">
          <span>Get Started</span>
          <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-250 group-hover:translate-x-1" />
        </div>
      </div>
    </div>
  )
}

export { ServiceCard }
