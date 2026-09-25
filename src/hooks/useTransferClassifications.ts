import { useCallback, useEffect, useState } from 'react'
import { TransferApi, type TransferClassification } from '@/lib/api/transferApi'

export function useTransferClassifications() {
  const [classifications, setClassifications] = useState<TransferClassification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setClassifications([])
    TransferApi.getClassifications()
      .then(options => { if (!cancelled) setClassifications(options) })
      .catch(failure => {
        if (!cancelled) setError(failure instanceof Error ? failure : new Error('Classification data unavailable'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attempt])

  return { classifications, loading, error, retry }
}
