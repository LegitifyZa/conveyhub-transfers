import React, { useState, useRef, useEffect } from 'react'
import { cn } from '@/utils/cn'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  className?: string
  variant?: 'dark' | 'light'
  size?: 'sm' | 'md' | 'lg'
}

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  delay = 200,
  className,
  variant = 'dark',
  size = 'md'
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<number>()

  const getPositionClasses = () => {
    const baseClasses = 'absolute z-50 pointer-events-none transition-all duration-200'
    
    const positionClasses = {
      top: 'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
      bottom: 'top-full left-1/2 transform -translate-x-1/2 mt-2',
      left: 'right-full top-1/2 transform -translate-y-1/2 mr-2',
      right: 'left-full top-1/2 transform -translate-y-1/2 ml-2'
    }

    const arrowClasses = {
      top: 'top-full left-1/2 transform -translate-x-1/2 -mt-1',
      bottom: 'bottom-full left-1/2 transform -translate-x-1/2 -mb-1',
      left: 'left-full top-1/2 transform -translate-y-1/2 -ml-1',
      right: 'right-full top-1/2 transform -translate-y-1/2 -mr-1'
    }

    return {
      tooltip: cn(baseClasses, positionClasses[position]),
      arrow: cn('absolute w-2 h-2 rotate-45', arrowClasses[position])
    }
  }

  const getVariantClasses = () => {
    const baseClasses = 'rounded-lg shadow-lg border'
    
    const variantClasses = {
      dark: 'bg-gray-900 text-white border-gray-700',
      light: 'bg-white text-gray-900 border-gray-200'
    }

    const sizeClasses = {
      sm: 'px-2 py-1 text-xs max-w-xs',
      md: 'px-3 py-2 text-sm max-w-sm',
      lg: 'px-4 py-3 text-base max-w-md'
    }

    return cn(
      baseClasses,
      variantClasses[variant],
      sizeClasses[size],
      className
    )
  }

  const getArrowVariantClasses = () => {
    return variant === 'dark' 
      ? 'bg-gray-900 border-gray-700' 
      : 'bg-white border-gray-200'
  }

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        setIsVisible(true)
      }
    }, delay)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const positionClasses = getPositionClasses()

  return (
    <div
      ref={triggerRef}
      className="inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      
      {isVisible && (
        <div className={positionClasses.tooltip}>
          <div className={cn('relative', getVariantClasses())}>
            {content}
            <div className={cn('border', getArrowVariantClasses(), positionClasses.arrow)} />
          </div>
        </div>
      )}
    </div>
  )
}

// Helper tooltip components for common use cases
export const InfoTooltip: React.FC<{
  content: string
  className?: string
}> = ({ content, className }) => (
  <Tooltip content={content} position="top" className={className}>
    <div className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-help">
      <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">?</span>
    </div>
  </Tooltip>
)

export const HelpTooltip: React.FC<{
  content: string
  className?: string
}> = ({ content, className }) => (
  <Tooltip content={content} position="top" className={className}>
    <div className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/20 hover:bg-blue-200 dark:hover:bg-blue-900/30 transition-colors cursor-help">
      <svg className="w-2 h-2 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 111-1 1 1 0 011.867-.5A3 3 0 0111 5a3 3 0 012 2.83V8z" clipRule="evenodd" />
      </svg>
    </div>
  </Tooltip>
)

export const WarningTooltip: React.FC<{
  content: string
  className?: string
}> = ({ content, className }) => (
  <Tooltip content={content} position="top" className={className}>
    <div className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-100 dark:bg-yellow-900/20 hover:bg-yellow-200 dark:hover:bg-yellow-900/30 transition-colors cursor-help">
      <svg className="w-2 h-2 text-yellow-600 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    </div>
  </Tooltip>
)

// Field-specific tooltips
export const FieldTooltip: React.FC<{
  field: string
  description: string
  example?: string
  className?: string
}> = ({ field, description, example, className }) => (
  <Tooltip 
    content={
      <div className="space-y-2">
        <div className="font-medium">{field}</div>
        <div className="text-xs opacity-90">{description}</div>
        {example && (
          <div className="text-xs opacity-75 italic">
            Example: {example}
          </div>
        )}
      </div>
    } 
    position="top" 
    className={className}
  >
    <div className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-help">
      <span className="text-xs text-gray-500 dark:text-gray-400">i</span>
    </div>
  </Tooltip>
)

// Status tooltips
export const StatusTooltip: React.FC<{
  status: 'pending' | 'active' | 'complete' | 'error'
  message: string
  details?: string
  className?: string
}> = ({ status, message, details, className }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'complete':
        return 'bg-green-100 dark:bg-green-900/20 hover:bg-green-200 dark:hover:bg-green-900/30'
      case 'active':
        return 'bg-blue-100 dark:bg-blue-900/20 hover:bg-blue-200 dark:hover:bg-blue-900/30'
      case 'error':
        return 'bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/30'
      case 'pending':
      default:
        return 'bg-gray-100 dark:bg-gray-900/20 hover:bg-gray-200 dark:hover:bg-gray-900/30'
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'complete':
        return '✓'
      case 'active':
        return '⟳'
      case 'error':
        return '!'
      case 'pending':
      default:
        return '○'
    }
  }

  return (
    <Tooltip 
      content={
        <div className="space-y-1">
          <div className="font-medium">{message}</div>
          {details && (
            <div className="text-xs opacity-90">{details}</div>
          )}
        </div>
      } 
      position="top" 
      className={className}
    >
      <div className={cn(
        'inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors cursor-help',
        getStatusColor()
      )}>
        <span className="text-xs font-medium">{getStatusIcon()}</span>
      </div>
    </Tooltip>
  )
}

export { Tooltip }
