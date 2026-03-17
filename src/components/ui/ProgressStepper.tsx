import React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface Step {
  id: number
  title: string
  description?: string
  status: 'completed' | 'current' | 'upcoming'
}

export interface ProgressStepperProps {
  steps: Step[]
  className?: string
}

const ProgressStepper: React.FC<ProgressStepperProps> = ({ steps, className }) => {
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center flex-1">
            {/* Step Circle */}
            <div className="relative flex items-center justify-center">
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300',
                  step.status === 'completed' && 'bg-teal-600 text-white shadow-premium',
                  step.status === 'current' && 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-premium ring-4 ring-teal-100 dark:ring-teal-900/20',
                  step.status === 'upcoming' && 'bg-gray-200 dark:bg-navy-700 text-gray-500 dark:text-gray-400'
                )}
              >
                {step.status === 'completed' ? (
                  <Check className="w-5 h-5" />
                ) : (
                  step.id
                )}
              </div>
              
              {/* Step Label */}
              <div className="absolute top-12 left-1/2 transform -translate-x-1/2 text-center whitespace-nowrap">
                <div
                  className={cn(
                    'text-sm font-medium transition-colors duration-300',
                    step.status === 'completed' && 'text-teal-600 dark:text-teal-400',
                    step.status === 'current' && 'text-gray-900 dark:text-gray-100',
                    step.status === 'upcoming' && 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  {step.title}
                </div>
                {step.description && (
                  <div
                    className={cn(
                      'text-xs mt-1 transition-colors duration-300',
                      step.status === 'completed' && 'text-teal-600/70 dark:text-teal-400/70',
                      step.status === 'current' && 'text-gray-600 dark:text-gray-400',
                      step.status === 'upcoming' && 'text-gray-400 dark:text-gray-500'
                    )}
                  >
                    {step.description}
                  </div>
                )}
              </div>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-4 transition-colors duration-300',
                  step.status === 'completed' ? 'bg-teal-600' : 'bg-gray-200 dark:bg-navy-700'
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export { ProgressStepper }
