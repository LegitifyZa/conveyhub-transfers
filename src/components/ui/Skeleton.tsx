import React from 'react'
import { cn } from '@/utils/cn'

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded'
  width?: string | number
  height?: string | number
  lines?: number
  animation?: 'pulse' | 'wave' | 'none'
}

const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = 'text',
  width,
  height,
  lines = 1,
  animation = 'pulse'
}) => {
  const getVariantClasses = () => {
    switch (variant) {
      case 'circular':
        return 'rounded-full'
      case 'rectangular':
        return 'rounded-none'
      case 'rounded':
        return 'rounded-lg'
      case 'text':
      default:
        return 'rounded'
    }
  }

  const getAnimationClasses = () => {
    switch (animation) {
      case 'pulse':
        return 'animate-pulse'
      case 'wave':
        return 'animate-shimmer'
      case 'none':
        return ''
      default:
        return 'animate-pulse'
    }
  }

  const skeletonClasses = cn(
    'bg-gray-200 dark:bg-gray-700',
    getVariantClasses(),
    getAnimationClasses(),
    className
  )

  const style = {
    width: width || (variant === 'text' ? '100%' : '40px'),
    height: height || (variant === 'text' ? '1rem' : '40px')
  }

  if (variant === 'text' && lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={cn(
              skeletonClasses,
              index === lines - 1 ? 'w-3/4' : 'w-full'
            )}
            style={{
              height: height || '1rem',
              width: index === lines - 1 ? '75%' : '100%'
            }}
          />
        ))}
      </div>
    )
  }

  return <div className={skeletonClasses} style={style} />
}

// Predefined skeleton components
export const CardSkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('bg-white dark:bg-navy-800 rounded-lg border border-gray-200 dark:border-navy-700 p-4 space-y-3', className)}>
    <Skeleton variant="text" width="60%" height="1.5rem" />
    <Skeleton variant="text" lines={2} height="1rem" />
    <div className="flex justify-between items-center pt-2">
      <Skeleton variant="circular" width="2rem" height="2rem" />
      <Skeleton variant="rectangular" width="5rem" height="2rem" />
    </div>
  </div>
)

export const TableSkeleton: React.FC<{ rows?: number; className?: string }> = ({ rows = 5, className }) => (
  <div className={cn('space-y-3', className)}>
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="flex items-center space-x-4 p-3 bg-white dark:bg-navy-800 rounded-lg border border-gray-200 dark:border-navy-700">
        <Skeleton variant="circular" width="2rem" height="2rem" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="40%" height="1rem" />
          <Skeleton variant="text" width="60%" height="0.75rem" />
        </div>
        <Skeleton variant="rectangular" width="4rem" height="1.5rem" />
      </div>
    ))}
  </div>
)

export const FormSkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('space-y-6', className)}>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton variant="text" width="30%" height="0.875rem" />
          <Skeleton variant="rounded" height="2.5rem" />
        </div>
      ))}
    </div>
    <div className="flex justify-end space-x-3 pt-4">
      <Skeleton variant="rectangular" width="6rem" height="2.5rem" />
      <Skeleton variant="rectangular" width="8rem" height="2.5rem" />
    </div>
  </div>
)

export const DocumentSkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('bg-white dark:bg-navy-800 rounded-lg border border-gray-200 dark:border-navy-700 p-4', className)}>
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center space-x-3">
        <Skeleton variant="circular" width="2.5rem" height="2.5rem" />
        <div className="space-y-1">
          <Skeleton variant="text" width="8rem" height="1rem" />
          <Skeleton variant="text" width="5rem" height="0.75rem" />
        </div>
      </div>
      <Skeleton variant="circular" width="1.5rem" height="1.5rem" />
    </div>
    <div className="space-y-2">
      <Skeleton variant="text" width="100%" height="0.5rem" />
      <Skeleton variant="text" width="80%" height="0.5rem" />
    </div>
  </div>
)

export const PartySkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('bg-white dark:bg-navy-800 rounded-lg border border-gray-200 dark:border-navy-700 p-4', className)}>
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center space-x-3">
        <Skeleton variant="circular" width="2.5rem" height="2.5rem" />
        <div className="space-y-1">
          <Skeleton variant="text" width="6rem" height="1rem" />
          <Skeleton variant="text" width="4rem" height="0.75rem" />
        </div>
      </div>
      <Skeleton variant="circular" width="1.5rem" height="1.5rem" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-1">
          <Skeleton variant="text" width="30%" height="0.75rem" />
          <Skeleton variant="rounded" height="2rem" />
        </div>
      ))}
    </div>
  </div>
)

export { Skeleton }
