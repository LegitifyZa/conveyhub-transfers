import React, { useEffect } from 'react'
import { Calculator, TrendingUp, FileText } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Input } from '@/components/ui'
import { useTransfer, Financials, calculateSATransferCosts, formatCurrency } from './TransferForm'

const StepFinancials: React.FC = () => {
  const { state, dispatch } = useTransfer()
  const { financials } = state

  // Auto-calculate SA transfer costs when purchase price changes
  useEffect(() => {
    if (financials.purchasePrice) {
      const costs = calculateSATransferCosts(financials.purchasePrice)

      // Update all calculated fields
      dispatch({
        type: 'UPDATE_FINANCIALS',
        payload: {
          transferDuty: costs.transferDuty.toString(),
          conveyancingFees: costs.conveyancingFees.toString(),
          deedsOfficeFees: costs.deedsOfficeFees.toString(),
          vat: costs.vat.toString(),
          postPetty: costs.postPetty.toString(),
          clearanceCertificate: costs.clearanceCertificate.toString(),
          ratesClearance: costs.ratesClearance.toString()
        }
      })
    }
  }, [financials.purchasePrice, dispatch])

  // Auto-calculate loan amount when purchase price or deposit changes
  useEffect(() => {
    const purchasePrice = parseFloat(financials.purchasePrice)
    const depositAmount = parseFloat(financials.depositAmount)

    if (!isNaN(purchasePrice) && !isNaN(depositAmount)) {
      const loanAmount = Math.max(0, purchasePrice - depositAmount).toString()
      dispatch({
        type: 'UPDATE_FINANCIALS',
        payload: { loanAmount }
      })
    }
  }, [financials.purchasePrice, financials.depositAmount, dispatch])

  const updateFinancials = (field: keyof Financials, value: string) => {
    dispatch({
      type: 'UPDATE_FINANCIALS',
      payload: { [field]: value }
    })
  }

  const costs = calculateSATransferCosts(financials.purchasePrice)

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-5 duration-500">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Financial Information
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Enter the financial details for this property transfer
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Purchase Information */}
        <Card variant="premium" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span>Purchase Information</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Purchase Price *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                    R
                  </span>
                  <Input
                    variant="premium"
                    placeholder="2,500,000"
                    value={financials.purchasePrice}
                    onChange={(e) => updateFinancials('purchasePrice', e.target.value.replace(/[^0-9.]/g, ''))}
                    className="pl-8 transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Deposit Amount *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                    R
                  </span>
                  <Input
                    variant="premium"
                    placeholder="250,000"
                    value={financials.depositAmount}
                    onChange={(e) => updateFinancials('depositAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                    className="pl-8 transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Loan Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                    R
                  </span>
                  <Input
                    variant="premium"
                    placeholder="2,250,000"
                    value={financials.loanAmount}
                    onChange={(e) => updateFinancials('loanAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                    className="pl-8 transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Interest Rate (%)
                </label>
                <Input
                  variant="premium"
                  placeholder="11.75"
                  value={financials.interestRate}
                  onChange={(e) => updateFinancials('interestRate', e.target.value.replace(/[^0-9.]/g, ''))}
                  className="transition-all duration-200 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Loan Term (years)
                </label>
                <select
                  value={financials.loanTerm}
                  onChange={(e) => updateFinancials('loanTerm', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all duration-200"
                >
                  <option value="">Select term</option>
                  <option value="15">15 years</option>
                  <option value="20">20 years</option>
                  <option value="25">25 years</option>
                  <option value="30">30 years</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Summary */}
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Calculator className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              <span>Quick Summary</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Purchase Price</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {formatCurrency(financials.purchasePrice)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Deposit</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {formatCurrency(financials.depositAmount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Loan Amount</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {formatCurrency(financials.loanAmount)}
                </span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">LTV Ratio</span>
                  <span className="font-semibold text-teal-600 dark:text-teal-400">
                    {financials.purchasePrice && financials.loanAmount
                      ? `${((parseFloat(financials.loanAmount) / parseFloat(financials.purchasePrice)) * 100).toFixed(1)}%`
                      : '0%'}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SA Transfer Costs */}
      <Card variant="premium">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <span>South African Transfer Costs</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Transfer Duty
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  R
                </span>
                <Input
                  variant="premium"
                  placeholder="0"
                  value={financials.transferDuty}
                  readOnly
                  className="pl-8 bg-gray-50 dark:bg-navy-800/50 text-gray-900 dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-calculated</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Conveyancing Fees
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  R
                </span>
                <Input
                  variant="premium"
                  placeholder="0"
                  value={financials.conveyancingFees}
                  readOnly
                  className="pl-8 bg-gray-50 dark:bg-navy-800/50 text-gray-900 dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-calculated</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Deeds Office Fees
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  R
                </span>
                <Input
                  variant="premium"
                  placeholder="0"
                  value={financials.deedsOfficeFees}
                  readOnly
                  className="pl-8 bg-gray-50 dark:bg-navy-800/50 text-gray-900 dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-calculated</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                VAT (15%)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  R
                </span>
                <Input
                  variant="premium"
                  placeholder="0"
                  value={financials.vat}
                  readOnly
                  className="pl-8 bg-gray-50 dark:bg-navy-800/50 text-gray-900 dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Auto-calculated</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Post & Petties
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  R
                </span>
                <Input
                  variant="premium"
                  placeholder="0"
                  value={financials.postPetty}
                  readOnly
                  className="pl-8 bg-gray-50 dark:bg-navy-800/50 text-gray-900 dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Estimated</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Clearance Certificate
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  R
                </span>
                <Input
                  variant="premium"
                  placeholder="0"
                  value={financials.clearanceCertificate}
                  readOnly
                  className="pl-8 bg-gray-50 dark:bg-navy-800/50 text-gray-900 dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Estimated</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Rates Clearance
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  R
                </span>
                <Input
                  variant="premium"
                  placeholder="0"
                  value={financials.ratesClearance}
                  readOnly
                  className="pl-8 bg-gray-50 dark:bg-navy-800/50 text-gray-900 dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Estimated</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost Summary */}
      <Card variant="glass">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-navy-600 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Total Transfer Costs
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  All fees and taxes combined
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                {formatCurrency(costs.totalCosts.toString())}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {costs.effectiveRate.toFixed(2)}% of purchase price
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { StepFinancials }
