import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { registerHooks, type LoadHookSync, type ResolveHookSync } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

// StepProperty imports leaflet, which dereferences `window` at module load,
// and leaflet's stylesheet, which the Node test harness cannot parse. Both
// are stubbed — `L` is only used inside useEffect, which SSR never runs.
// Component imports below are dynamic so the hooks register before
// resolution.
const resolveHook: ResolveHookSync = (specifier, context, nextResolve) => {
  if (specifier === 'leaflet') {
    return { url: 'data:text/javascript,export default {}', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
const loadHook: LoadHookSync = (url, context, nextLoad) => {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {}', shortCircuit: true }
  }
  return nextLoad(url, context)
}
registerHooks({ resolve: resolveHook, load: loadHook })

const { StepProperty } = await import('./StepProperty')
const { TransferProvider, validatePropertyDetails } = await import('./TransferForm')
import type { TransferState } from './TransferForm'

const EMPTY_DETAILS = {
  address: '', city: '', state: '', zipCode: '', propertyType: '',
  lotNumber: '', legalDescription: '', yearBuilt: '', squareFootage: '',
}

function baseState(overrides: Partial<TransferState> = {}): TransferState {
  return {
    currentStep: 1,
    propertyDetails: { ...EMPTY_DETAILS },
    parties: [],
    financials: {
      purchasePrice: '', depositAmount: '', loanAmount: '', interestRate: '',
      loanTerm: '', transferDuty: '', conveyancingFees: '', deedsOfficeFees: '',
      vat: '', postPetty: '', clearanceCertificate: '', ratesClearance: '',
    },
    documents: [],
    status: 'draft',
    ...overrides,
  }
}

function render(state: TransferState): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null,
      createElement(TransferProvider, { initialValue: state, children: createElement(StepProperty) })))
}

describe('StepProperty capture form', () => {
  it('renders the approved labels and the deferred area field', () => {
    const html = render(baseState())
    // Approved labels — no US "State"/"Zip Code" or conflated "Lot" label.
    assert.match(html, /Province \*/)
    assert.match(html, /Postal code \*/)
    assert.match(html, /Erf number/)
    assert.match(html, /Property Type \*/)
    assert.doesNotMatch(html, /Zip [Cc]ode|>State \*</)
    // Editable area capture is deferred: visible, disabled, explained.
    assert.match(html, /Area \(m²\)/)
    assert.match(html, /disabled=""/)
    assert.match(html, /Area capture is unavailable in this step\. Existing values are preserved unchanged\./)
    // Manual capture is honest about provenance and needs no prior search.
    assert.match(html, /private to your institution and are not verified against any registry/)
    // Existing-property selection is offered alongside manual capture.
    assert.match(html, /Link an existing property \(optional\)/)
  })

  it('preserves an existing area value in the disabled field', () => {
    const html = render(baseState({
      propertyDetails: { ...EMPTY_DETAILS, squareFootage: '185.5' },
    }))
    assert.match(html, /value="185\.5"/)
    assert.match(html, /disabled=""/)
  })
})

describe('StepProperty saved/selected link display', () => {
  const linked = {
    id: 'prop-1', streetAddress: '12 Test Street', city: 'Johannesburg',
    province: 'Gauteng', postalCode: '2196', propertyType: 'Freehold',
    status: 'active', manual: true,
  }

  it('renders a persisted link read-only with the unverified badge and no capture form', () => {
    const html = render(baseState({
      persistedPropertyLinkId: 'link-1',
      linkedProperty: linked,
      propertyRequestId: 'req-1',
    }))
    assert.match(html, /Linked property/)
    assert.match(html, /12 Test Street/)
    assert.match(html, /Manually captured — unverified/)
    assert.match(html, /Saved links cannot be removed here/)
    // The capture cards and discovery are hidden once a link is persisted —
    // no editable fields imply an edit path that does not exist.
    assert.doesNotMatch(html, /Street Address \*/)
    assert.doesNotMatch(html, /Link an existing property/)
    // A persisted link is not offered a Change control.
    assert.doesNotMatch(html, />Change</)
  })

  it('renders a selected-but-unsaved property with a Change control', () => {
    const html = render(baseState({
      selectedPropertyId: 'prop-1',
      linkedProperty: { ...linked, manual: false },
    }))
    assert.match(html, /Selected property/)
    assert.match(html, />Change</)
    assert.doesNotMatch(html, /Saved links cannot be removed here/)
  })
})

describe('TransferNavigation step-1 validation', () => {
  it('enables Next when a property is selected without manual fields', async () => {
    const { TransferNavigation } = await import('./TransferNavigation')
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null,
        createElement(TransferProvider, {
          initialValue: baseState({ selectedPropertyId: 'prop-1', linkedProperty: {
            id: 'prop-1', streetAddress: '7 Selected Lane', city: 'Cape Town',
            province: 'Western Cape', postalCode: '8001', propertyType: 'Freehold',
            status: 'active', manual: false,
          } }),
          children: createElement(TransferNavigation, {
            currentStep: 1, totalSteps: 5, onPrevious: () => {}, onNext: () => {},
          }),
        })))
    // Regresses the real bug: validatePropertyDetails was called without the
    // linked flag, leaving Next disabled for a valid selected property.
    assert.match(html, /Next Step/)
    const opening = html.match(/<button[^>]*>(?:(?!\/button)[\s\S])*?Next Step/)?.[0] || ''
    assert.ok(opening, 'next button rendered')
    // The class list contains Tailwind "disabled:" variants — match only a
    // real disabled attribute, not the substring.
    assert.ok(!/\sdisabled[=> ]/.test(opening), 'next button must be enabled')
  })
})

describe('validatePropertyDetails', () => {
  it('requires the UI floor for manual capture, including postal code and property type', () => {
    for (const field of ['address', 'city', 'state', 'zipCode', 'propertyType'] as const) {
      assert.equal(
        validatePropertyDetails({ ...EMPTY_DETAILS, address: 'a', city: 'c', state: 'p', zipCode: '2196', propertyType: 'Freehold', [field]: '' }),
        false,
        field,
      )
    }
    assert.equal(validatePropertyDetails({
      ...EMPTY_DETAILS, address: 'a', city: 'c', state: 'p', zipCode: '2196', propertyType: 'Freehold',
    }), true)
  })

  it('is satisfied by a linked property with no manual fields', () => {
    assert.equal(validatePropertyDetails({ ...EMPTY_DETAILS }, true), true)
  })
})
