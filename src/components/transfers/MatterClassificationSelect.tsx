import { Button, UnavailableNotice } from '@/components/ui'
import { classificationLabel, type TransferClassification } from '@/lib/api/transferApi'
import { serviceUnavailableMessage } from '@/lib/api/serviceStatus'

interface Props {
  value?: string | null
  options: TransferClassification[]
  loading: boolean
  error: Error | null
  onChange: (value: string) => void
  onRetry: () => void
  readOnly?: boolean
  disabled?: boolean
}

export function MatterClassificationSelect({ value, options, loading, error, onChange, onRetry, readOnly = false, disabled = false }: Props) {
  const selected = options.find(option => option.canonicalCode === value)
  if (readOnly) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Saved transfer classification</p>
        <p data-testid="saved-classification" className="text-sm text-gray-900 dark:text-gray-100">
          {value === undefined ? 'Classification not loaded' : value === null || value === ''
            ? 'Unclassified — no classification was recorded for this matter'
            : selected ? classificationLabel(selected) : value}
        </p>
        {value && <p className="text-xs text-gray-500"><code>{value}</code></p>}
        <p className="text-xs text-gray-500">Saved classifications cannot be changed in this workflow.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label htmlFor="transfer-classification" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Transfer classification
      </label>
      <select
        id="transfer-classification"
        value={value ?? ''}
        onChange={event => onChange(event.target.value)}
        disabled={disabled || loading || Boolean(error) || options.length === 0}
        className="flex h-10 w-full rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50"
      >
        <option value="">Select a transfer classification...</option>
        {options.map(option => <option key={option.canonicalCode} value={option.canonicalCode}>{classificationLabel(option)}</option>)}
      </select>
      {loading && <p role="status" className="text-sm text-gray-500">Loading transfer classifications...</p>}
      {error && <UnavailableNotice message={serviceUnavailableMessage('Transfer classifications', error)} detail="New matters cannot be saved until a valid classification is available." />}
      {!loading && !error && options.length === 0 && <p role="alert" className="text-sm text-amber-700">No active transfer classifications are configured.</p>}
      {!loading && !error && value && !selected && <p role="alert" className="text-sm text-amber-700">The selected classification is unavailable. Choose an available classification.</p>}
      {!loading && (error || options.length === 0) && <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onRetry}>Retry classifications</Button>}
      <p className="text-xs text-gray-500">Classification records the matter type; it does not certify document readiness or completion of a specialist workflow.</p>
    </div>
  )
}
