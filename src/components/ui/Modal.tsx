import React, { useEffect, useRef } from 'react'
import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { cn } from '@/utils/cn'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  variant?: 'default' | 'danger' | 'warning' | 'success' | 'info'
  showCloseButton?: boolean
  closeOnOverlayClick?: boolean
  closeOnEscape?: boolean
  className?: string
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  variant = 'default',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className
}) => {
  const modalRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, closeOnEscape, onClose])

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'max-w-md'
      case 'lg':
        return 'max-w-4xl'
      case 'xl':
        return 'max-w-6xl'
      case 'full':
        return 'max-w-full mx-4'
      case 'md':
      default:
        return 'max-w-2xl'
    }
  }

  const getVariantClasses = () => {
    switch (variant) {
      case 'danger':
        return 'border-red-200 dark:border-red-800'
      case 'warning':
        return 'border-yellow-200 dark:border-yellow-800'
      case 'success':
        return 'border-green-200 dark:border-green-800'
      case 'info':
        return 'border-blue-200 dark:border-blue-800'
      case 'default':
      default:
        return 'border-gray-200 dark:border-gray-700'
    }
  }

  const getIcon = () => {
    switch (variant) {
      case 'danger':
        return <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
      case 'warning':
        return <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
      case 'success':
        return <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
      case 'info':
        return <Info className="w-6 h-6 text-blue-600 dark:text-blue-400" />
      case 'default':
      default:
        return null
    }
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && closeOnOverlayClick) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleOverlayClick}
    >
      <div
        ref={modalRef}
        className={cn(
          'w-full bg-white dark:bg-navy-800 rounded-xl shadow-2xl border animate-in slide-in-from-bottom-4 duration-300',
          getSizeClasses(),
          getVariantClasses(),
          className
        )}
      >
        {/* Header */}
        {(title || description || showCloseButton) && (
          <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-navy-700">
            <div className="flex items-start space-x-3 flex-1 min-w-0">
              {getIcon() && (
                <div className="flex-shrink-0">
                  {getIcon()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                {title && (
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {description}
                  </p>
                )}
              </div>
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="flex-shrink-0 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-700 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  )
}

// Confirmation Modal Component
interface ConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'danger' | 'warning'
  isLoading?: boolean
  icon?: React.ReactNode
  details?: React.ReactNode
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  isLoading = false,
  icon,
  details
}) => {
  const getConfirmButtonVariant = () => {
    switch (variant) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700 text-white'
      case 'warning':
        return 'bg-yellow-600 hover:bg-yellow-700 text-white'
      case 'default':
      default:
        return 'bg-teal-600 hover:bg-teal-700 text-white'
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      variant={variant}
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-start space-x-3">
          {icon && (
            <div className="flex-shrink-0">
              {icon}
            </div>
          )}
          <div className="flex-1">
            <p className="text-gray-700 dark:text-gray-300">
              {message}
            </p>
            {details && (
              <div className="mt-3">
                {details}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-navy-700">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={isLoading}
            className={getConfirmButtonVariant()}
          >
            {isLoading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Processing...</span>
              </div>
            ) : (
              confirmText
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Transfer Submission Confirmation Modal
interface TransferSubmissionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  transferData: {
    propertyAddress: string
    parties: Array<{ name: string; type: string }>
    purchasePrice: string
    documentCount: number
  }
  isLoading?: boolean
}

const TransferSubmissionModal: React.FC<TransferSubmissionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  transferData,
  isLoading = false
}) => {
  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Submit Transfer Application"
      message="Are you sure you want to submit this transfer application? Please review the details below before confirming."
      confirmText="Submit Transfer"
      cancelText="Review Again"
      variant="default"
      isLoading={isLoading}
      icon={
        <div className="w-12 h-12 rounded-full bg-teal-100 dark:bg-teal-900/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      }
      details={
        <Card variant="glass" className="mt-4">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Property:</span>
                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                  {transferData.propertyAddress}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Purchase Price:</span>
                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                  {transferData.purchasePrice}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Parties:</span>
                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                  {transferData.parties.length} total
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Documents:</span>
                <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
                  {transferData.documentCount} files
                </span>
              </div>
            </div>
            
            <div className="pt-3 border-t border-gray-200 dark:border-navy-700">
              <div className="text-xs text-gray-600 dark:text-gray-400">
                <div className="font-medium mb-1">Submission Summary:</div>
                <ul className="space-y-1">
                  <li>• Transfer will be submitted for processing</li>
                  <li>• You will receive email confirmation</li>
                  <li>• Status updates will be available in your dashboard</li>
                  <li>• Processing typically takes 7-10 business days</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      }
    />
  )
}

// Success Modal Component
interface SuccessModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string
  action?: {
    label: string
    onClick: () => void
  }
}

const SuccessModal: React.FC<SuccessModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  action
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    variant="success"
    size="md"
  >
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
          <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
        </div>
        <p className="text-gray-700 dark:text-gray-300">
          {message}
        </p>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        {action ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={action.onClick}>
              {action.label}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        )}
      </div>
    </div>
  </Modal>
)

export { Modal, ConfirmationModal, TransferSubmissionModal, SuccessModal }
