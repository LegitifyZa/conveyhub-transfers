import React from 'react'
import { AlertCircle } from 'lucide-react'

interface UnavailableNoticeProps {
  message: string
  detail?: string
}

export const UnavailableNotice: React.FC<UnavailableNoticeProps> = ({ message, detail }) => (
  <div
    role="alert"
    className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20"
  >
    <div className="flex items-start gap-3">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{message}</p>
        {detail && (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{detail}</p>
        )}
      </div>
    </div>
  </div>
)
