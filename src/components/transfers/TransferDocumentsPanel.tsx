import React from 'react'
import { FileText } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { MatterDocumentsSection } from './MatterDocumentsSection'

interface TransferDocumentsPanelProps {
  transferId: string
}

// Authenticated v1 document lane: requirements, gated upload, scan states and
// short-lived download links. The legacy quarantined document endpoints and
// local status editing are intentionally gone — lifecycle and scan state are
// server-owned, and human review (verified/rejected) is outside this slice.
const TransferDocumentsPanel: React.FC<TransferDocumentsPanelProps> = ({ transferId }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <span>Transfer Documents</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <MatterDocumentsSection transferId={transferId} />
      </CardContent>
    </Card>
  )
}

export { TransferDocumentsPanel }
