import React, { useState, useEffect, useMemo } from 'react'
import { 
  TrendingUp, 
  FileText, 
  Coins, 
  Building, 
  Receipt, 
  Sliders
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { Badge } from '@/components/ui'
import { 
  calculateConveyancingFee, 
  calculateTransferDuty, 
  calculateDeedsOfficeFee, 
  formatZAR, 
  FirmAccountSettings, 
  DEFAULT_FIRM_SETTINGS,
  TariffSchedule,
  LSSA_TARIFF_2026_2027,
  generateProformaStatement,
  ProformaStatementData
} from '@/utils/conveyancingAccounts'
import { AccountsApi } from '@/lib/api/accountsApi'
import { ProformaStatementView } from '@/components/accounts/ProformaStatementView'

type CalcTab = 'transfer' | 'bond' | 'combined' | 'repayment' | 'proforma'

export const AccountsCalculator: React.FC = () => {
  const [activeTab, setActiveTab] = useState<CalcTab>('transfer')
  const [firmSettings, setFirmSettings] = useState<FirmAccountSettings>(DEFAULT_FIRM_SETTINGS)
  const [activeTariff, setActiveTariff] = useState<TariffSchedule>(LSSA_TARIFF_2026_2027)

  // Inputs
  const [purchasePrice, setPurchasePrice] = useState<string>('2500000')
  const [depositAmount, setDepositAmount] = useState<string>('250000')
  const [bondAmount, setBondAmount] = useState<string>('2250000')
  const [isVatTransaction, setIsVatTransaction] = useState<boolean>(false)
  const [deedsCount, setDeedsCount] = useState<number>(1)
  const [propertyType, setPropertyType] = useState<'freehold' | 'sectional_title' | 'hoa'>('freehold')
  
  // Bond Repayment Inputs
  const [interestRate, setInterestRate] = useState<string>('11.75')
  const [loanTermYears, setLoanTermYears] = useState<string>('20')

  // Proforma State
  const [generatedProforma, setGeneratedProforma] = useState<ProformaStatementData | null>(null)

  useEffect(() => {
    AccountsApi.getFirmSettings().then(setFirmSettings)
    AccountsApi.getActiveTariffSchedule().then(setActiveTariff)
  }, [])

  // Parsed Numerical Values
  const numericPrice = parseFloat(purchasePrice.replace(/[^0-9.]/g, '')) || 0
  const numericDeposit = parseFloat(depositAmount.replace(/[^0-9.]/g, '')) || 0
  const numericBond = parseFloat(bondAmount.replace(/[^0-9.]/g, '')) || 0
  const numericInterest = parseFloat(interestRate.replace(/[^0-9.]/g, '')) || 11.75
  const numericTerm = parseInt(loanTermYears) || 20

  // 1. Transfer Costs Calculation
  const transferCalculation = useMemo(() => {
    const vatRate = firmSettings.isVatRegistered ? firmSettings.vatRate || 0.15 : 0
    const multiplier = firmSettings.tariffMultiplier || 1.0

    // Conveyancing Fee
    const conv = calculateConveyancingFee(numericPrice, activeTariff, multiplier)
    const convFee = conv.feeExclVat
    const convVat = Math.round(convFee * vatRate)
    const convIncl = convFee + convVat

    // Transfer Duty
    const td = calculateTransferDuty(numericPrice, isVatTransaction)

    // Deeds Office Fees
    const deeds = calculateDeedsOfficeFee(numericPrice, 'transfer', deedsCount)

    // Standard Disbursements
    const disbs = firmSettings.defaultDisbursements || []
    let disbExcl = 0
    let disbVat = 0
    disbs.forEach(d => {
      disbExcl += d.amount || 0
      if (d.isVatApplicable && firmSettings.isVatRegistered) {
        disbVat += Math.round((d.amount || 0) * vatRate)
      }
    })
    const disbIncl = disbExcl + disbVat

    const grandTotal = convIncl + td.transferDuty + deeds.totalDeedsOfficeFees + disbIncl
    const effectiveRate = numericPrice > 0 ? (grandTotal / numericPrice) * 100 : 0

    return {
      convFee,
      convVat,
      convIncl,
      convExplanation: conv.calculationExplanation,
      transferDuty: td.transferDuty,
      transferDutyDescription: td.rateDescription,
      isExempt: td.isExempt,
      bracketTier: td.bracketTier,
      deedsRegistrationFee: deeds.statutoryRegistrationFee,
      deedsLodgementFee: deeds.statutoryLodgementFee,
      deedsTotal: deeds.totalDeedsOfficeFees,
      disbursementsExcl: disbExcl,
      disbursementsVat: disbVat,
      disbursementsTotal: disbIncl,
      grandTotal,
      effectiveRate
    }
  }, [numericPrice, isVatTransaction, deedsCount, firmSettings, activeTariff])

  // 2. Bond Registration Calculation
  const bondCalculation = useMemo(() => {
    const vatRate = firmSettings.isVatRegistered ? firmSettings.vatRate || 0.15 : 0
    const multiplier = firmSettings.tariffMultiplier || 1.0

    // Bond Attorney Fee
    const bondConv = calculateConveyancingFee(numericBond, activeTariff, multiplier)
    const bondFee = bondConv.feeExclVat
    const bondVat = Math.round(bondFee * vatRate)
    const bondIncl = bondFee + bondVat

    // Deeds Office Bond Fee (Item 1(c))
    const deeds = calculateDeedsOfficeFee(numericBond, 'bond', 1)

    // Configurable Bond Disbursements (Postage, FICA, Doc Gen, Bank compliance)
    const bondDisb = (firmSettings.defaultDisbursements || []).filter(d => 
      d.enabled && (d.applicationRule === 'conditional_bond' || d.category === 'compliance' || d.category === 'admin')
    )
    let bondDisbExcl = 0
    let bondDisbVat = 0
    bondDisb.forEach(d => {
      bondDisbExcl += d.amount || 0
      if (d.isVatApplicable && firmSettings.isVatRegistered) {
        bondDisbVat += Math.round((d.amount || 0) * vatRate)
      }
    })
    const bondDisbTotal = bondDisbExcl + bondDisbVat

    const grandTotal = bondIncl + deeds.totalDeedsOfficeFees + bondDisbTotal
    return {
      bondFee,
      bondVat,
      bondIncl,
      deedsTotal: deeds.totalDeedsOfficeFees,
      deedsRegistrationFee: deeds.statutoryRegistrationFee,
      deedsLodgementFee: deeds.statutoryLodgementFee,
      disbursementsTotal: bondDisbTotal,
      grandTotal
    }
  }, [numericBond, firmSettings, activeTariff])

  // 3. Bond Repayment Calculation (PMT formula)
  const repaymentCalculation = useMemo(() => {
    const p = numericBond
    const r = (numericInterest / 100) / 12 // monthly interest
    const n = numericTerm * 12 // total months

    if (p <= 0 || r <= 0 || n <= 0) {
      return { monthlyPayment: 0, totalRepaid: 0, totalInterest: 0 }
    }

    const monthlyPayment = Math.round((p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1))
    const totalRepaid = monthlyPayment * n
    const totalInterest = totalRepaid - p

    return {
      monthlyPayment,
      totalRepaid,
      totalInterest
    }
  }, [numericBond, numericInterest, numericTerm])

  // Handle switching to generated Proforma tab
  const handleGenerateProforma = () => {
    const proforma = generateProformaStatement({
      transferId: 'CALC-ESTIMATE',
      matterReference: 'CALC-ESTIMATE',
      propertyAddress: '123 Coastal Boulevard, Camps Bay, Cape Town',
      erfNumber: 'Erf 1089',
      purchasePrice: numericPrice,
      depositAmount: numericDeposit,
      loanAmount: numericBond,
      isVatTransaction,
      lodgementDeedsCount: deedsCount,
      firmSettings,
      tariffSchedule: activeTariff
    })
    setGeneratedProforma(proforma)
    setActiveTab('proforma')
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Hero Banner */}
      <div className="bg-gradient-to-r from-navy-900 via-navy-950 to-teal-950 p-8 rounded-3xl text-white shadow-2xl border border-teal-500/20 relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2.5">
              <span className="px-3 py-1 rounded-full bg-teal-500/20 text-teal-300 text-xs font-bold uppercase tracking-wider border border-teal-500/30">
                South African Conveyancing Engine
              </span>
              <span className="text-xs text-gray-400">LSSA {activeTariff.version} • SARS Official Brackets</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Transfer & Bond Cost Calculator
            </h1>
            <p className="text-gray-300 text-sm leading-relaxed">
              Calculate accurate property transfer fees, SARS transfer duty, statutory Deeds Office lodgement fees, and attorney bond registration costs in real-time.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Button
              onClick={handleGenerateProforma}
              className="bg-teal-500 hover:bg-teal-400 text-navy-950 font-bold px-6 py-3 rounded-xl shadow-lg shadow-teal-500/25 flex items-center gap-2 w-full sm:w-auto"
            >
              <FileText className="h-4 w-4" />
              Generate Proforma Statement
            </Button>
          </div>
        </div>

        {/* Tab Navigation Pill Bar */}
        <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t border-gray-800/80">
          <button
            onClick={() => setActiveTab('transfer')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all ${
              activeTab === 'transfer'
                ? 'bg-teal-500 text-navy-950 shadow-lg shadow-teal-500/30'
                : 'bg-navy-800/80 text-gray-300 hover:bg-navy-800 hover:text-white'
            }`}
          >
            <Building className="h-4 w-4" />
            1. Transfer Costs Calculator
          </button>

          <button
            onClick={() => setActiveTab('bond')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all ${
              activeTab === 'bond'
                ? 'bg-teal-500 text-navy-950 shadow-lg shadow-teal-500/30'
                : 'bg-navy-800/80 text-gray-300 hover:bg-navy-800 hover:text-white'
            }`}
          >
            <Receipt className="h-4 w-4" />
            2. Bond Registration Costs
          </button>

          <button
            onClick={() => setActiveTab('combined')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all ${
              activeTab === 'combined'
                ? 'bg-teal-500 text-navy-950 shadow-lg shadow-teal-500/30'
                : 'bg-navy-800/80 text-gray-300 hover:bg-navy-800 hover:text-white'
            }`}
          >
            <Coins className="h-4 w-4" />
            3. Combined Transfer + Bond
          </button>

          <button
            onClick={() => setActiveTab('repayment')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all ${
              activeTab === 'repayment'
                ? 'bg-teal-500 text-navy-950 shadow-lg shadow-teal-500/30'
                : 'bg-navy-800/80 text-gray-300 hover:bg-navy-800 hover:text-white'
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            4. Bond Repayment & Amortization
          </button>

          {generatedProforma && (
            <button
              onClick={() => setActiveTab('proforma')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all ${
                activeTab === 'proforma'
                  ? 'bg-teal-500 text-navy-950 shadow-lg shadow-teal-500/30'
                  : 'bg-navy-800/80 text-teal-400 hover:bg-navy-800 hover:text-teal-300'
              }`}
            >
              <FileText className="h-4 w-4" />
              5. Proforma Statement View
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: TRANSFER COSTS CALCULATOR */}
      {activeTab === 'transfer' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          {/* Inputs Column */}
          <div className="lg:col-span-1 space-y-6">
            <Card variant="premium">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <Sliders className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  <span>Property Transaction Inputs</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
                    Property Purchase Price (ZAR) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R</span>
                    <Input
                      value={purchasePrice}
                      onChange={e => setPurchasePrice(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="2,500,000"
                      className="pl-8 text-base font-bold text-teal-600 dark:text-teal-400"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[1200000, 2500000, 4500000, 8000000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setPurchasePrice(String(val))}
                        className="text-[11px] font-semibold px-2 py-1 bg-gray-100 dark:bg-navy-800 rounded-md hover:bg-teal-50 dark:hover:bg-teal-950/40 text-gray-700 dark:text-gray-300"
                      >
                        R{(val / 1000000).toFixed(1)}M
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
                    Deeds Lodgement Count (Item 1(a))
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min="1"
                      max="10"
                      value={deedsCount}
                      onChange={e => setDeedsCount(parseInt(e.target.value) || 1)}
                      className="w-24 text-center font-bold"
                    />
                    <span className="text-xs text-gray-500">
                      @ R52.00 per deed ({formatZAR(deedsCount * 52)})
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
                    Property Type
                  </label>
                  <select
                    value={propertyType}
                    onChange={e => setPropertyType(e.target.value as any)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="freehold">Freehold / Standalone Property</option>
                    <option value="sectional_title">Sectional Title (Body Corporate)</option>
                    <option value="hoa">Estate with Homeowners Association (HOA)</option>
                  </select>
                </div>

                {/* VAT Inclusive Toggle */}
                <div className="p-4 rounded-xl bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-900/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="vat-tx" className="text-xs font-bold text-gray-900 dark:text-gray-100 cursor-pointer">
                      VAT Transaction / Developer Sale
                    </label>
                    <input
                      id="vat-tx"
                      type="checkbox"
                      checked={isVatTransaction}
                      onChange={e => setIsVatTransaction(e.target.checked)}
                      className="h-4 w-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500"
                    />
                  </div>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400">
                    If buying from a VAT-registered property developer, purchase price includes VAT and NO transfer duty is payable to SARS.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={handleGenerateProforma}
                    className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-2.5 rounded-xl shadow-md"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Create Proforma Statement
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Transfer Breakdown Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Total Grand Banner */}
            <Card variant="glass" className="bg-gradient-to-br from-teal-900/20 via-navy-900/30 to-navy-950/40 border-teal-500/30">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                      Total Estimated Transfer Costs
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-gray-100 font-mono">
                      {formatZAR(transferCalculation.grandTotal)}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Effective rate: <span className="font-bold text-teal-600">{transferCalculation.effectiveRate.toFixed(2)}%</span> of purchase price
                    </p>
                  </div>

                  <div className="text-left sm:text-right space-y-1 text-xs">
                    <Badge variant={firmSettings.isVatRegistered ? 'success' : 'default'}>
                      {firmSettings.isVatRegistered ? '15% VAT Included' : 'Non-VAT Practice'}
                    </Badge>
                    <p className="text-gray-400">Tariff: {activeTariff.name}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detailed Item Breakdown Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Conveyancing Fees */}
              <Card variant="premium">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-teal-600" />
                      Attorney Conveyancing Fee
                    </h4>
                    <span className="font-bold font-mono text-teal-600 text-base">
                      {formatZAR(transferCalculation.convIncl)}
                    </span>
                  </div>
                  <div className="text-xs space-y-1 text-gray-500">
                    <div className="flex justify-between">
                      <span>Fee (Excl VAT):</span>
                      <span className="font-mono">{formatZAR(transferCalculation.convFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>VAT (15%):</span>
                      <span className="font-mono">{formatZAR(transferCalculation.convVat)}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-100 dark:border-navy-700">
                    {transferCalculation.convExplanation}
                  </p>
                </CardContent>
              </Card>

              {/* SARS Transfer Duty */}
              <Card variant="premium">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                      <Receipt className="h-4 w-4 text-blue-600" />
                      SARS Transfer Duty
                    </h4>
                    <span className="font-bold font-mono text-blue-600 text-base">
                      {formatZAR(transferCalculation.transferDuty)}
                    </span>
                  </div>
                  <div className="text-xs space-y-1 text-gray-500">
                    <div className="flex justify-between">
                      <span>Bracket Tier:</span>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">{transferCalculation.bracketTier}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax Status:</span>
                      <span>{transferCalculation.isExempt ? 'Zero / Exempt' : 'Payable to SARS'}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-100 dark:border-navy-700">
                    {transferCalculation.transferDutyDescription}
                  </p>
                </CardContent>
              </Card>

              {/* Deeds Office Fees */}
              <Card variant="premium">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                      <Building className="h-4 w-4 text-indigo-600" />
                      Deeds Office Statutory Fees
                    </h4>
                    <span className="font-bold font-mono text-indigo-600 text-base">
                      {formatZAR(transferCalculation.deedsTotal)}
                    </span>
                  </div>
                  <div className="text-xs space-y-1 text-gray-500">
                    <div className="flex justify-between">
                      <span>Registration (Item 1(b)):</span>
                      <span className="font-mono">{formatZAR(transferCalculation.deedsRegistrationFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Lodgement (Item 1(a)):</span>
                      <span className="font-mono">{formatZAR(transferCalculation.deedsLodgementFee)}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-100 dark:border-navy-700">
                    Government Gazette statutory deeds registration schedule.
                  </p>
                </CardContent>
              </Card>

              {/* Disbursements */}
              <Card variant="premium">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                      <Coins className="h-4 w-4 text-amber-600" />
                      Practice Disbursements
                    </h4>
                    <span className="font-bold font-mono text-amber-600 text-base">
                      {formatZAR(transferCalculation.disbursementsTotal)}
                    </span>
                  </div>
                  <div className="text-xs space-y-1 text-gray-500">
                    <div className="flex justify-between">
                      <span>Customary Items (Excl):</span>
                      <span className="font-mono">{formatZAR(transferCalculation.disbursementsExcl)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Disbursements VAT:</span>
                      <span className="font-mono">{formatZAR(transferCalculation.disbursementsVat)}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-100 dark:border-navy-700">
                    FICA, Postages & Petties, Doc Gen, Search & Rates figures.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BOND REGISTRATION CALCULATOR */}
      {activeTab === 'bond' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          <div className="lg:col-span-1 space-y-6">
            <Card variant="premium">
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-teal-600" />
                  <span>Bond Registration Inputs</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
                    Mortgage Bond Amount to Register (ZAR) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R</span>
                    <Input
                      value={bondAmount}
                      onChange={e => setBondAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="2,250,000"
                      className="pl-8 text-base font-bold text-teal-600 dark:text-teal-400"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 dark:bg-navy-800 text-xs text-gray-500 space-y-2">
                  <p className="font-semibold text-gray-700 dark:text-gray-300">About Bond Registration Costs:</p>
                  <p>
                    Bond attorney fees are calculated on a sliding scale based on the mortgage loan amount registered over the title deed at the Deeds Office.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <Card variant="glass" className="bg-gradient-to-br from-teal-900/20 via-navy-900/30 to-navy-950/40 border-teal-500/30">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                      Total Estimated Bond Registration Costs
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-gray-100 font-mono">
                      {formatZAR(bondCalculation.grandTotal)}
                    </h2>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card variant="premium">
                <CardContent className="p-5 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-gray-500">Bond Attorney Fee</h4>
                  <p className="text-xl font-bold text-teal-600 font-mono">{formatZAR(bondCalculation.bondIncl)}</p>
                  <p className="text-[11px] text-gray-400">Fee: {formatZAR(bondCalculation.bondFee)} + VAT</p>
                </CardContent>
              </Card>

              <Card variant="premium">
                <CardContent className="p-5 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-gray-500">Deeds Office Fee (Item 1(c))</h4>
                  <p className="text-xl font-bold text-indigo-600 font-mono">{formatZAR(bondCalculation.deedsTotal)}</p>
                  <p className="text-[11px] text-gray-400">Statutory bond registration</p>
                </CardContent>
              </Card>

              <Card variant="premium">
                <CardContent className="p-5 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-gray-500">Bond Disbursements</h4>
                  <p className="text-xl font-bold text-amber-600 font-mono">{formatZAR(bondCalculation.disbursementsTotal)}</p>
                  <p className="text-[11px] text-gray-400">FICA, electronic doc & admin</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: COMBINED TRANSFER & BOND COSTS */}
      {activeTab === 'combined' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <Card variant="premium">
            <CardContent className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-700 dark:text-gray-300 mb-1">
                    Purchase Price (R)
                  </label>
                  <Input
                    value={purchasePrice}
                    onChange={e => setPurchasePrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="font-bold text-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-700 dark:text-gray-300 mb-1">
                    Deposit Amount (R)
                  </label>
                  <Input
                    value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-700 dark:text-gray-300 mb-1">
                    Bond Amount (R)
                  </label>
                  <Input
                    value={bondAmount}
                    onChange={e => setBondAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="font-bold text-blue-600"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card variant="premium">
              <CardContent className="p-6 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-600">1. Property Transfer Costs</span>
                <p className="text-3xl font-extrabold text-gray-900 dark:text-gray-100 font-mono">
                  {formatZAR(transferCalculation.grandTotal)}
                </p>
                <div className="text-xs space-y-1 text-gray-500 pt-2 border-t border-gray-100 dark:border-navy-700">
                  <div className="flex justify-between"><span>Conveyancing + VAT:</span><span className="font-mono">{formatZAR(transferCalculation.convIncl)}</span></div>
                  <div className="flex justify-between"><span>Transfer Duty:</span><span className="font-mono">{formatZAR(transferCalculation.transferDuty)}</span></div>
                  <div className="flex justify-between"><span>Deeds Office:</span><span className="font-mono">{formatZAR(transferCalculation.deedsTotal)}</span></div>
                  <div className="flex justify-between"><span>Disbursements:</span><span className="font-mono">{formatZAR(transferCalculation.disbursementsTotal)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card variant="premium">
              <CardContent className="p-6 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600">2. Bond Registration Costs</span>
                <p className="text-3xl font-extrabold text-gray-900 dark:text-gray-100 font-mono">
                  {formatZAR(bondCalculation.grandTotal)}
                </p>
                <div className="text-xs space-y-1 text-gray-500 pt-2 border-t border-gray-100 dark:border-navy-700">
                  <div className="flex justify-between"><span>Bond Attorney + VAT:</span><span className="font-mono">{formatZAR(bondCalculation.bondIncl)}</span></div>
                  <div className="flex justify-between"><span>Deeds Office Bond:</span><span className="font-mono">{formatZAR(bondCalculation.deedsTotal)}</span></div>
                  <div className="flex justify-between"><span>Bond Disbursements:</span><span className="font-mono">{formatZAR(bondCalculation.disbursementsTotal)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card variant="glass" className="bg-gradient-to-br from-teal-900/30 to-navy-950/50 border-teal-500/40">
              <CardContent className="p-6 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-400">Total Cash Required (All Costs)</span>
                <p className="text-3xl font-black text-teal-400 font-mono">
                  {formatZAR(transferCalculation.grandTotal + bondCalculation.grandTotal + numericDeposit)}
                </p>
                <div className="text-xs space-y-1 text-gray-300 pt-2 border-t border-teal-500/20">
                  <div className="flex justify-between"><span>Cash Deposit:</span><span className="font-mono">{formatZAR(numericDeposit)}</span></div>
                  <div className="flex justify-between"><span>Transfer Costs:</span><span className="font-mono">{formatZAR(transferCalculation.grandTotal)}</span></div>
                  <div className="flex justify-between"><span>Bond Costs:</span><span className="font-mono">{formatZAR(bondCalculation.grandTotal)}</span></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 4: BOND REPAYMENT & AMORTIZATION */}
      {activeTab === 'repayment' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          <div className="lg:col-span-1 space-y-6">
            <Card variant="premium">
              <CardHeader>
                <CardTitle className="text-base font-bold">Loan Repayment Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-700 dark:text-gray-300 mb-1">
                    Bond Loan Amount (R)
                  </label>
                  <Input
                    value={bondAmount}
                    onChange={e => setBondAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="font-bold text-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-gray-700 dark:text-gray-300 mb-1">
                    Interest Rate (% p.a.)
                  </label>
                  <Input
                    value={interestRate}
                    onChange={e => setInterestRate(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="11.75"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-gray-700 dark:text-gray-300 mb-1">
                    Loan Term (Years)
                  </label>
                  <select
                    value={loanTermYears}
                    onChange={e => setLoanTermYears(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-navy-600 bg-white dark:bg-navy-700"
                  >
                    <option value="15">15 Years (180 months)</option>
                    <option value="20">20 Years (240 months)</option>
                    <option value="25">25 Years (300 months)</option>
                    <option value="30">30 Years (360 months)</option>
                  </select>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card variant="premium">
                <CardContent className="p-5">
                  <span className="text-xs text-gray-500 uppercase font-bold">Monthly Installment</span>
                  <p className="text-2xl font-black text-teal-600 font-mono mt-1">
                    {formatZAR(repaymentCalculation.monthlyPayment)} /mo
                  </p>
                </CardContent>
              </Card>

              <Card variant="premium">
                <CardContent className="p-5">
                  <span className="text-xs text-gray-500 uppercase font-bold">Total Interest Paid</span>
                  <p className="text-2xl font-bold text-amber-600 font-mono mt-1">
                    {formatZAR(repaymentCalculation.totalInterest)}
                  </p>
                </CardContent>
              </Card>

              <Card variant="premium">
                <CardContent className="p-5">
                  <span className="text-xs text-gray-500 uppercase font-bold">Total Loan Repaid</span>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 font-mono mt-1">
                    {formatZAR(repaymentCalculation.totalRepaid)}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: GENERATED PROFORMA STATEMENT */}
      {activeTab === 'proforma' && generatedProforma && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <ProformaStatementView
            statement={generatedProforma}
            firmSettings={firmSettings}
            onUpdateStatement={setGeneratedProforma}
          />
        </div>
      )}
    </div>
  )
}
