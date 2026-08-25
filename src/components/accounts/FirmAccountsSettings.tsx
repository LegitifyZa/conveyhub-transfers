import React, { useState, useEffect } from 'react'
import { 
  ShieldCheck, 
  Receipt, 
  Coins, 
  Plus, 
  Trash2, 
  Save, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle,
  Percent,
  Layers
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { Badge } from '@/components/ui'
import { 
  FirmAccountSettings, 
  TariffSchedule, 
  DisbursementItem, 
  TariffBracket,
  formatZAR,
  calculateConveyancingFee
} from '@/utils/conveyancingAccounts'
import { AccountsApi } from '@/lib/api/accountsApi'

export const FirmAccountsSettings: React.FC = () => {
  const [settings, setSettings] = useState<FirmAccountSettings | null>(null)
  const [tariffs, setTariffs] = useState<TariffSchedule[]>([])
  const [activeTariff, setActiveTariff] = useState<TariffSchedule | null>(null)
  const [selectedTariffId, setSelectedTariffId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tariff tester state
  const [testAmount, setTestAmount] = useState<string>('2500000')
  const [testResult, setTestResult] = useState<{ fee: number; explanation: string } | null>(null)

  // New disbursement item state
  const [newDisbName, setNewDisbName] = useState('')
  const [newDisbAmount, setNewDisbAmount] = useState('')
  const [newDisbVat, setNewDisbVat] = useState(true)
  const [newDisbCategory, setNewDisbCategory] = useState<DisbursementItem['category']>('admin')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [fetchedSettings, fetchedTariffs] = await Promise.all([
        AccountsApi.getFirmSettings(),
        AccountsApi.getTariffSchedules()
      ])
      setSettings(fetchedSettings)
      setTariffs(fetchedTariffs)
      setSelectedTariffId(fetchedSettings.activeTariffScheduleId)
      
      const currentTariff = fetchedTariffs.find(t => t.id === fetchedSettings.activeTariffScheduleId) || fetchedTariffs[0]
      setActiveTariff(currentTariff)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  // Update test fee calculation whenever testAmount or activeTariff changes
  useEffect(() => {
    if (activeTariff && testAmount) {
      const num = parseFloat(testAmount.replace(/[^0-9.]/g, '')) || 0
      const mult = settings?.tariffMultiplier || 1.0
      const res = calculateConveyancingFee(num, activeTariff, mult)
      setTestResult({
        fee: res.feeExclVat,
        explanation: res.calculationExplanation
      })
    }
  }, [testAmount, activeTariff, settings?.tariffMultiplier])

  const handleSaveSettings = async () => {
    if (!settings) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await AccountsApi.updateFirmSettings({
        ...settings,
        activeTariffScheduleId: selectedTariffId
      })
      if (activeTariff) {
        await AccountsApi.saveTariffSchedule(activeTariff)
      }
      setSettings(updated)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTariffChange = (tariffId: string) => {
    setSelectedTariffId(tariffId)
    const selected = tariffs.find(t => t.id === tariffId)
    if (selected) {
      setActiveTariff(selected)
    }
  }

  const handleBracketChange = (index: number, field: keyof TariffBracket, value: any) => {
    if (!activeTariff) return
    const updatedBrackets = [...activeTariff.brackets]
    updatedBrackets[index] = {
      ...updatedBrackets[index],
      [field]: value
    }
    setActiveTariff({
      ...activeTariff,
      brackets: updatedBrackets
    })
  }

  const handleAddBracket = () => {
    if (!activeTariff) return
    const lastBracket = activeTariff.brackets[activeTariff.brackets.length - 1]
    const min = lastBracket ? (lastBracket.maxAmount || 5000000) + 1 : 0
    const newBracket: TariffBracket = {
      id: `b-${Date.now()}`,
      minAmount: min,
      maxAmount: null,
      baseFee: lastBracket ? lastBracket.baseFee + 10000 : 5000,
      baseThreshold: min - 1,
      incrementStep: 1000000,
      incrementFee: 5000,
      description: `Custom bracket above R${(min - 1).toLocaleString()}`
    }
    setActiveTariff({
      ...activeTariff,
      brackets: [...activeTariff.brackets, newBracket]
    })
  }

  const handleRemoveBracket = (index: number) => {
    if (!activeTariff || activeTariff.brackets.length <= 1) return
    const updated = activeTariff.brackets.filter((_, i) => i !== index)
    setActiveTariff({
      ...activeTariff,
      brackets: updated
    })
  }

  const handleUpdateDisbursement = (index: number, field: keyof DisbursementItem, value: any) => {
    if (!settings) return
    const updated = [...settings.defaultDisbursements]
    updated[index] = {
      ...updated[index],
      [field]: value
    }
    setSettings({
      ...settings,
      defaultDisbursements: updated
    })
  }

  const handleRemoveDisbursement = (index: number) => {
    if (!settings) return
    const updated = settings.defaultDisbursements.filter((_, i) => i !== index)
    setSettings({
      ...settings,
      defaultDisbursements: updated
    })
  }

  const handleAddDisbursement = () => {
    if (!settings || !newDisbName.trim()) return
    const amt = parseFloat(newDisbAmount.replace(/[^0-9.]/g, '')) || 0
    const newItem: DisbursementItem = {
      id: `disb-${Date.now()}`,
      name: newDisbName.trim(),
      amount: amt,
      isVatApplicable: newDisbVat,
      isCustomary: false,
      category: newDisbCategory
    }
    setSettings({
      ...settings,
      defaultDisbursements: [...settings.defaultDisbursements, newItem]
    })
    setNewDisbName('')
    setNewDisbAmount('')
    setNewDisbVat(true)
  }

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500 dark:text-gray-400">
        <RefreshCw className="h-6 w-6 animate-spin mr-3 text-teal-600" />
        <span>Loading firm accounts & tariff settings...</span>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-teal-900 via-navy-900 to-navy-950 p-6 rounded-2xl text-white shadow-xl border border-teal-500/20">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Receipt className="h-6 w-6 text-teal-400" />
            <h2 className="text-2xl font-bold tracking-tight">Firm Accounts, Tariffs & VAT Setup</h2>
          </div>
          <p className="text-teal-200 text-sm max-w-2xl">
            Configure firm VAT registration status, banking trust account details, customizable customary disbursements, and Law Society conveyancing sliding scale tariff tables.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <div className="flex items-center text-sm font-medium text-emerald-400 bg-emerald-950/60 px-3 py-1.5 rounded-lg border border-emerald-500/30">
              <CheckCircle className="h-4 w-4 mr-1.5" />
              Settings saved!
            </div>
          )}
          <Button 
            onClick={handleSaveSettings} 
            disabled={isSaving}
            className="bg-teal-500 hover:bg-teal-400 text-navy-950 font-semibold shadow-lg shadow-teal-500/20"
          >
            {isSaving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save All Settings
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* 1. Firm Details & VAT Status */}
      <Card variant="premium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <span>Firm Legal Identity & VAT Registration</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Firm Legal Practice Name
              </label>
              <Input
                value={settings.firmName}
                onChange={e => setSettings({ ...settings, firmName: e.target.value })}
                placeholder="e.g. Kruger Incorporated Attorneys"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Practice Registration Number
              </label>
              <Input
                value={settings.registrationNumber || ''}
                onChange={e => setSettings({ ...settings, registrationNumber: e.target.value })}
                placeholder="e.g. 2019/123456/21"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Default Lodgement Deed Count
              </label>
              <Input
                type="number"
                min="1"
                max="20"
                value={settings.defaultLodgementDeedsCount || 1}
                onChange={e => setSettings({ ...settings, defaultLodgementDeedsCount: parseInt(e.target.value) || 1 })}
              />
              <p className="text-xs text-gray-500 mt-1">Item 1(a) Lodgement fee @ R52 per deed</p>
            </div>
          </div>

          {/* VAT Configuration Box */}
          <div className="p-5 rounded-xl bg-teal-50/70 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-900/50 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <input
                  id="vat-registered-checkbox"
                  type="checkbox"
                  checked={settings.isVatRegistered}
                  onChange={e => setSettings({ ...settings, isVatRegistered: e.target.checked })}
                  className="mt-1 h-5 w-5 text-teal-600 rounded border-gray-300 focus:ring-teal-500"
                />
                <div>
                  <label htmlFor="vat-registered-checkbox" className="font-semibold text-gray-900 dark:text-gray-100 cursor-pointer">
                    Firm is Registered for Value-Added Tax (VAT)
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    When enabled, 15% standard South African VAT is calculated on attorney fees and applicable disbursements. Transfer duty and statutory Deeds Office fees remain VAT-exempt.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Badge variant={settings.isVatRegistered ? 'success' : 'default'}>
                  {settings.isVatRegistered ? 'VAT Registered (15%)' : 'Non-VAT Registered (0%)'}
                </Badge>
              </div>
            </div>

            {settings.isVatRegistered && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-teal-200/60 dark:border-teal-900/40 animate-in fade-in duration-200">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    VAT Registration Number *
                  </label>
                  <Input
                    value={settings.vatNumber}
                    onChange={e => setSettings({ ...settings, vatNumber: e.target.value })}
                    placeholder="e.g. 4120987654"
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    Standard SA VAT Rate
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.01"
                      value={((settings.vatRate || 0.15) * 100).toFixed(0)}
                      onChange={e => setSettings({ ...settings, vatRate: (parseFloat(e.target.value) || 15) / 100 })}
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2. Trust Banking Details for Statements */}
      <Card variant="premium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coins className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <span>Attorney Section 86 Trust Banking Details</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                Bank Name
              </label>
              <Input
                value={settings.trustAccount?.bankName || ''}
                onChange={e => setSettings({
                  ...settings,
                  trustAccount: { ...settings.trustAccount, bankName: e.target.value }
                })}
                placeholder="e.g. Standard Bank / Nedbank / FNB / Absa"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                Account Holder / Name
              </label>
              <Input
                value={settings.trustAccount?.accountName || ''}
                onChange={e => setSettings({
                  ...settings,
                  trustAccount: { ...settings.trustAccount, accountName: e.target.value }
                })}
                placeholder="e.g. Kruger Inc Trust Account"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                Account Number
              </label>
              <Input
                value={settings.trustAccount?.accountNumber || ''}
                onChange={e => setSettings({
                  ...settings,
                  trustAccount: { ...settings.trustAccount, accountNumber: e.target.value }
                })}
                placeholder="e.g. 0123456789"
                className="font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                Branch Code
              </label>
              <Input
                value={settings.trustAccount?.branchCode || ''}
                onChange={e => setSettings({
                  ...settings,
                  trustAccount: { ...settings.trustAccount, branchCode: e.target.value }
                })}
                placeholder="e.g. 051001"
                className="font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                Account Type
              </label>
              <Input
                value={settings.trustAccount?.accountType || 'Trust Cheque Account'}
                onChange={e => setSettings({
                  ...settings,
                  trustAccount: { ...settings.trustAccount, accountType: e.target.value }
                })}
                placeholder="Trust Cheque Account"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                Payment Reference Prefix
              </label>
              <Input
                value={settings.trustAccount?.referencePrefix || 'TRF'}
                onChange={e => setSettings({
                  ...settings,
                  trustAccount: { ...settings.trustAccount, referencePrefix: e.target.value }
                })}
                placeholder="e.g. TRF or MAT"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. LSSA Conveyancing Tariff Engine & Sliding Scale Brackets */}
      <Card variant="premium" className="overflow-hidden">
        <CardHeader className="bg-gray-50/50 dark:bg-navy-800/40 border-b border-gray-200 dark:border-navy-700">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                <span>Conveyancing Tariff Engine (Sliding Scale)</span>
              </CardTitle>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Manage annual Law Society of South Africa (LSSA) recommended guidelines, bracket increments, and custom firm fee rules.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Active Tariff Version:</label>
              <select
                value={selectedTariffId}
                onChange={e => handleTariffChange(e.target.value)}
                className="px-3 py-1.5 text-sm bg-white dark:bg-navy-700 border border-gray-300 dark:border-navy-600 rounded-lg text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 font-medium"
              >
                {tariffs.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Rate Multiplier / Negotiation discount */}
          <div className="flex flex-col md:flex-row items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-navy-800/60 border border-gray-200 dark:border-navy-700 gap-4">
            <div className="space-y-1">
              <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                <Percent className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                Firm Tariff Multiplier / Discount Rate
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                1.0 = 100% LSSA Standard Guideline. Set to 0.85 for 15% developer discount, or 1.10 for 10% premium.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="3.0"
                value={settings.tariffMultiplier ?? 1.0}
                onChange={e => setSettings({ ...settings, tariffMultiplier: parseFloat(e.target.value) || 1.0 })}
                className="w-24 text-center font-bold text-teal-600"
              />
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                ({Math.round(((settings.tariffMultiplier ?? 1.0) * 100))}% of tariff)
              </span>
            </div>
          </div>

          {/* Brackets Table */}
          {activeTariff && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                  Sliding Scale Brackets ({activeTariff.name})
                </h4>
                <Button size="sm" variant="outline" onClick={handleAddBracket} className="text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Bracket Tier
                </Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-navy-700">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-100 dark:bg-navy-800 text-gray-600 dark:text-gray-400 uppercase font-semibold">
                    <tr>
                      <th className="px-3 py-2.5">From Value (R)</th>
                      <th className="px-3 py-2.5">To Value (R)</th>
                      <th className="px-3 py-2.5">Base Fee (R)</th>
                      <th className="px-3 py-2.5">Threshold (R)</th>
                      <th className="px-3 py-2.5">Per Increment Step (R)</th>
                      <th className="px-3 py-2.5">Step Fee (R)</th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-navy-700 font-mono">
                    {activeTariff.brackets.map((bracket, idx) => (
                      <tr key={bracket.id || idx} className="hover:bg-gray-50/80 dark:hover:bg-navy-800/40">
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={bracket.minAmount}
                            onChange={e => handleBracketChange(idx, 'minAmount', parseFloat(e.target.value) || 0)}
                            className="w-24 p-1 rounded border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {bracket.maxAmount !== null ? (
                            <input
                              type="number"
                              value={bracket.maxAmount}
                              onChange={e => handleBracketChange(idx, 'maxAmount', parseFloat(e.target.value) || 0)}
                              className="w-24 p-1 rounded border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700"
                            />
                          ) : (
                            <span className="text-gray-400 font-sans italic">Unlimited</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={bracket.baseFee}
                            onChange={e => handleBracketChange(idx, 'baseFee', parseFloat(e.target.value) || 0)}
                            className="w-24 p-1 rounded border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-teal-600 font-bold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={bracket.baseThreshold}
                            onChange={e => handleBracketChange(idx, 'baseThreshold', parseFloat(e.target.value) || 0)}
                            className="w-24 p-1 rounded border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={bracket.incrementStep}
                            onChange={e => handleBracketChange(idx, 'incrementStep', parseFloat(e.target.value) || 0)}
                            className="w-24 p-1 rounded border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={bracket.incrementFee}
                            onChange={e => handleBracketChange(idx, 'incrementFee', parseFloat(e.target.value) || 0)}
                            className="w-24 p-1 rounded border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-teal-600 font-bold"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveBracket(idx)}
                            disabled={activeTariff.brackets.length <= 1}
                            className="text-gray-400 hover:text-red-500 disabled:opacity-30 p-1"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Interactive Live Formula Tester */}
          <div className="p-4 rounded-xl bg-teal-500/5 dark:bg-teal-500/10 border border-teal-500/20 space-y-2">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                  Live Tariff Tester:
                </span>
                <div className="relative w-44">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-bold">R</span>
                  <Input
                    value={testAmount}
                    onChange={e => setTestAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="2500000"
                    className="pl-7 py-1 text-sm font-semibold"
                  />
                </div>
              </div>

              {testResult && (
                <div className="flex items-center gap-3 text-right">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {testResult.explanation}
                  </div>
                  <div className="text-base font-bold text-teal-600 dark:text-teal-400 bg-white dark:bg-navy-800 px-3 py-1 rounded-lg border border-teal-500/30">
                    {formatZAR(testResult.fee)} <span className="text-xs text-gray-500 font-normal">(excl VAT)</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. Customizable Disbursements & Customary Charges */}
      <Card variant="premium">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Coins className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                <span>Firm Standard Disbursements & Customary Charges</span>
              </CardTitle>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Non-regulated fees and disbursements customizable per law practice (FICA, Postage & Petties, Doc Gen, Search fees, etc.)
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-navy-700">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100 dark:bg-navy-800 text-gray-600 dark:text-gray-400 uppercase text-xs font-semibold">
                <tr>
                  <th className="px-4 py-3">Disbursement Item</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 w-36">Amount (ZAR)</th>
                  <th className="px-4 py-3 text-center w-28">Subject to VAT</th>
                  <th className="px-4 py-3 text-right w-16">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-700">
                {settings.defaultDisbursements.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-gray-50/80 dark:hover:bg-navy-800/40">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <Input
                        value={item.name}
                        onChange={e => handleUpdateDisbursement(idx, 'name', e.target.value)}
                        className="py-1 text-sm font-medium"
                      />
                      {item.description && (
                        <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={item.category}
                        onChange={e => handleUpdateDisbursement(idx, 'category', e.target.value)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-gray-800 dark:text-gray-200"
                      >
                        <option value="compliance">Compliance (FICA)</option>
                        <option value="admin">Administration</option>
                        <option value="statutory">Statutory / Search</option>
                        <option value="rates">Rates & Municipal</option>
                        <option value="adhoc">Ad-hoc Fee</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-semibold">R</span>
                        <Input
                          type="number"
                          value={item.amount}
                          onChange={e => handleUpdateDisbursement(idx, 'amount', parseFloat(e.target.value) || 0)}
                          className="pl-7 py-1 text-sm font-bold font-mono"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={item.isVatApplicable}
                        onChange={e => handleUpdateDisbursement(idx, 'isVatApplicable', e.target.checked)}
                        className="h-4 w-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveDisbursement(idx)}
                        className="text-gray-400 hover:text-red-500 p-1 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add New Disbursement Row */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-navy-800/50 border border-dashed border-gray-300 dark:border-navy-600 space-y-3">
            <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Add New Disbursement Line Item
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Item Description</label>
                <Input
                  value={newDisbName}
                  onChange={e => setNewDisbName(e.target.value)}
                  placeholder="e.g. Courier & Delivery Charges / HOA Compliance"
                  className="py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select
                  value={newDisbCategory}
                  onChange={e => setNewDisbCategory(e.target.value as any)}
                  className="w-full text-xs px-2.5 py-2 rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700"
                >
                  <option value="admin">Administration</option>
                  <option value="compliance">Compliance (FICA)</option>
                  <option value="statutory">Statutory / Search</option>
                  <option value="rates">Rates & Municipal</option>
                  <option value="adhoc">Ad-hoc Fee</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount (R)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-semibold">R</span>
                  <Input
                    value={newDisbAmount}
                    onChange={e => setNewDisbAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="450"
                    className="pl-7 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newDisbVat}
                    onChange={e => setNewDisbVat(e.target.checked)}
                    className="h-4 w-4 text-teal-600 rounded border-gray-300"
                  />
                  <span>VAT</span>
                </label>
                <Button size="sm" onClick={handleAddDisbursement} disabled={!newDisbName.trim()} className="flex-1">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
