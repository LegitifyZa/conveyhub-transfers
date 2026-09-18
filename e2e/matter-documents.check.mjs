// Playwright check for the authenticated matter-documents lane. Every
// /api/** request is intercepted and answered by this script — no BFF,
// FastAPI, database, storage backend or scanner is contacted. Scan and
// storage behavior here is MOCKED evidence only; the ClamAV and
// files-service adapters are unverified against deployed infrastructure.
//
// Run: `node e2e/matter-documents.check.mjs` with `vite preview` serving the
// built bundle (BASE env var overrides).
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:4173'
const MATTER_ID = '11111111-1111-4111-8111-111111111111'
const TRANSFER_ID = 'TRF-PW-DOC'
const PDF_BYTES = Buffer.from('%PDF-1.4 synthetic check file\n%%EOF')

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

// Simulated server store. `calls` records create/upload/download-link bodies
// so checks can assert identical-key retries and no-duplicate behavior.
function makeApi(t = {}) {
  const calls = { createDoc: [], upload: [], downloadLink: [], recalculate: 0 }
  const documents = (t.documents || []).map(d => ({ ...d }))
  const requirements = (t.requirements || []).map(r => ({ ...r }))
  let uploadAttempts = 0
  let createAttempts = 0
  const uploadBehaviour = t.uploadBehaviour || 'success'
  // 'success' | 'fail-once' | 'scan-pending' | 'infected'

  const docRow = (id, over = {}) => ({
    id, transferId: MATTER_ID, catalogueDocumentId: null,
    name: over.name || 'FICA documents', status: 'pending', notes: null,
    fileSize: null, fileType: null, originalFileName: null,
    requirementKey: over.requirementKey ?? null, scanStatus: 'not_scanned',
    uploadedAt: null, createdAt: '2026-09-18T10:00:00Z', updatedAt: '2026-09-18T10:00:00Z',
    ...over,
  })

  const route = async (r) => {
    const url = new URL(r.request().url())
    const path = url.pathname
    const method = r.request().method()

    if (path === '/api/auth/refresh' && method === 'POST') {
      return r.fulfill(json({ message: 'OK', data: { token: 'pw-access-token', expires: Math.floor(Date.now() / 1000) + 3600 } }))
    }
    if (path === '/api/v1/transfers/' && method === 'GET') {
      // The persistence probe's real contract: {message, data:{transfers:[],
      // pagination}}. probeMalformed simulates the legacy {success:true}
      // envelope the old check wrongly trusted — controls must stay locked.
      if (t.probeMalformed) {
        return r.fulfill(json({ success: true, data: [] }))
      }
      return r.fulfill(json({
        message: 'OK',
        data: { transfers: [], pagination: { page: 1, limit: 1, total: 0 } },
      }))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}/documents` && method === 'GET') {
      return r.fulfill(json({
        message: 'OK',
        data: {
          documents,
          requirements,
          unevaluatedFacts: t.unevaluatedFacts || [],
          unevaluatedRules: t.unevaluatedRules || [],
        },
      }))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}/documents` && method === 'POST') {
      const body = JSON.parse(r.request().postData() || '{}')
      calls.createDoc.push(body)
      createAttempts += 1
      // Idempotent replay: same key + same payload returns the same row.
      const replay = documents.find(d => d.client_request_id === body.client_request_id)
      if (replay) return r.fulfill(json({ message: 'OK', data: replay }))
      const doc = docRow(`doc-${createAttempts}`, {
        name: body.name,
        requirementKey: body.requirement_key ?? null,
        client_request_id: body.client_request_id,
      })
      documents.push(doc)
      return r.fulfill(json({ message: 'Created', data: doc }, 201))
    }
    const fileMatch = path.match(new RegExp(`^/api/v1/transfers/${MATTER_ID}/documents/([^/]+)/file$`))
    if (fileMatch && method === 'POST') {
      const doc = documents.find(d => d.id === fileMatch[1])
      calls.upload.push({ documentId: fileMatch[1] })
      uploadAttempts += 1
      if (uploadBehaviour === 'fail-once' && uploadAttempts === 1) {
        return r.fulfill(json({ message: 'Internal error', errors: ['simulated upload failure'] }, 500))
      }
      if (uploadBehaviour === 'scan-pending') {
        Object.assign(doc, {
          scanStatus: 'error', scanResult: 'ScannerUnavailableError',
          originalFileName: 'fica.pdf', fileType: 'application/pdf', fileSize: PDF_BYTES.length,
        })
        return r.fulfill(json({ message: 'OK', data: { document: doc, outcome: 'scan_pending' } }))
      }
      if (uploadBehaviour === 'infected') {
        Object.assign(doc, {
          scanStatus: 'infected', scanResult: 'Eicar-Test',
          originalFileName: 'evil.pdf', fileType: 'application/pdf', fileSize: PDF_BYTES.length,
        })
        return r.fulfill(json({ message: 'OK', data: { document: doc, outcome: 'quarantined' } }))
      }
      Object.assign(doc, {
        status: 'uploaded', scanStatus: 'clean',
        originalFileName: 'fica.pdf', fileType: 'application/pdf', fileSize: PDF_BYTES.length,
        uploadedAt: '2026-09-18T10:01:00Z',
      })
      if (doc.requirementKey) {
        const req = requirements.find(x => x.requirementKey === doc.requirementKey)
        if (req) {
          req.linkedDocumentId = doc.id
          req.satisfiedDocumentId = doc.id
        }
      }
      return r.fulfill(json({ message: 'OK', data: { document: doc, outcome: 'uploaded' } }))
    }
    const linkMatch = path.match(new RegExp(`^/api/v1/transfers/${MATTER_ID}/documents/([^/]+)/download-link$`))
    if (linkMatch && method === 'POST') {
      calls.downloadLink.push({ documentId: linkMatch[1] })
      return r.fulfill(json({
        message: 'OK',
        data: { downloadUrl: `/api/v1/documents/download/v1.${linkMatch[1]}.sig`, expires: Math.floor(Date.now() / 1000) + 300 },
      }))
    }
    if (path.startsWith('/api/v1/documents/download/') && method === 'GET') {
      // Bearer-token semantics: only the exact issued token shape serves
      // bytes; any tampered/unknown token is denied (mocked server behavior).
      const token = decodeURIComponent(path.split('/download/')[1] || '')
      if (!/^v1\.doc-\d+\.sig$/.test(token)) {
        return r.fulfill(json({ message: 'Forbidden' }, 403))
      }
      return r.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': "attachment; filename*=UTF-8''fica.pdf" },
        body: PDF_BYTES,
      })
    }
    if (path === `/api/v1/transfers/${MATTER_ID}/documents/requirements/recalculate` && method === 'POST') {
      calls.recalculate += 1
      return r.fulfill(json({ message: 'OK', data: { requirements } }))
    }
    if (path === `/api/v1/transfers/${MATTER_ID}` && method === 'GET') {
      return r.fulfill(json({
        message: 'OK',
        data: {
          id: MATTER_ID, transferId: TRANSFER_ID, propertyAddress: '12 Test Street',
          status: 'in_progress', updatedAt: '2026-09-18T09:00:00Z',
          matter: { id: 'matter-1', title: 'Test matter', firmReference: 'FRM-1', status: 'in_progress', updatedAt: '2026-09-18T09:00:00Z' },
        },
      }))
    }
    // Legacy lanes the milestones page loads — quarantined/empty mocks.
    if (path === `/api/transfers/${MATTER_ID}` && method === 'GET') {
      return r.fulfill(json({ success: true, data: { id: MATTER_ID, transfer_id: TRANSFER_ID, property_address: '12 Test Street', status: 'in_progress', documents: [] } }))
    }
    if (path === `/api/transfers/${MATTER_ID}/milestones` && method === 'GET') {
      return r.fulfill(json({ success: true, data: [] }))
    }
    if (path === `/api/transfers/${MATTER_ID}/activity` && method === 'GET') {
      return r.fulfill(json({ success: true, data: [] }))
    }
    console.log('  unhandled:', method, path)
    return r.fulfill(json({ message: 'OK', data: {} }))
  }

  return { route, calls, documents, requirements }
}

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(`PASS  ${name}`)
    console.log(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name}: ${error.message}`)
    console.log(`FAIL  ${name}: ${error.message}`)
  }
}

const browser = await chromium.launch()

async function newAuthedPage(api) {
  const context = await browser.newContext()
  await context.addCookies([{ name: 'deedly_sid', value: 'pw-sid-1', url: BASE }])
  await context.route('**/api/**', api.route)
  const page = await context.newPage()
  return { context, page }
}

async function openDocumentsTab(page) {
  await page.goto(`${BASE}/transfers/${MATTER_ID}/milestones`)
  await page.getByRole('button', { name: /documents/i }).click()
  await page.locator('text=Transfer Documents').waitFor()
}

await check('requirement upload -> clean scan -> satisfied -> download link', async () => {
  const api = makeApi({
    requirements: [{
      id: 'req-1', requirementKey: 'fica', displayName: 'FICA documents',
      source: 'baseline', conditionKey: null, status: 'active',
      satisfiedDocumentId: null, linkedDocumentId: null,
    }],
  })
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)
  await page.getByText('Required', { exact: true }).waitFor()

  await page.locator('label', { hasText: 'Upload' }).first().click()
  await page.locator('input[data-upload-key="req:fica"]').setInputFiles({
    name: 'fica.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES,
  })
  await page.getByText('Provided').waitFor()

  assert.equal(api.calls.createDoc.length, 1)
  assert.equal(api.calls.createDoc[0].requirement_key, 'fica')
  assert.ok(api.calls.createDoc[0].client_request_id)
  assert.equal(api.calls.upload.length, 1)
  await page.getByText('Security scan passed').waitFor()

  // Download issues a short-lived link (authenticated issuance) and the
  // browser retrieves real bytes with the bearer token — assert the actual
  // downloaded filename AND content, not just that a URL was opened.
  const linkResponse = page.waitForResponse(
    (resp) => resp.url().endsWith(`/api/v1/transfers/${MATTER_ID}/documents/doc-1/download-link`) && resp.request().method() === 'POST',
  )
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download' }).click(),
  ])
  const link = await linkResponse
  const linkData = (await link.json()).data
  assert.match(linkData.downloadUrl, /^\/api\/v1\/documents\/download\/v1\./)
  assert.ok(linkData.expires > Math.floor(Date.now() / 1000))
  assert.equal(api.calls.downloadLink.length, 1)
  // Real bearer-link retrieval: the downloaded artifact has the issued
  // filename and byte-for-byte the mocked file content.
  assert.equal(download.suggestedFilename(), 'fica.pdf')
  const savedPath = await download.path()
  assert.deepEqual(readFileSync(savedPath), PDF_BYTES)
  // A tampered bearer token is denied — retrieval re-validates, not just the
  // issuance path.
  const denied = await page.evaluate(async () => {
    const res = await fetch('/api/v1/documents/download/v1.doc-1.forged')
    return res.status
  })
  assert.equal(denied, 403)
  await context.close()
})

await check('failed upload shows the error and no fake uploaded state', async () => {
  const api = makeApi({ uploadBehaviour: 'fail-once' })
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)

  await page.getByPlaceholder('Document name').fill('Sale agreement')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByText('Sale agreement').waitFor()

  await page.locator('label', { hasText: 'Upload file' }).first().click()
  await page.locator('input[data-upload-key="doc-1"]').setInputFiles({
    name: 'agreement.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES,
  })
  await page.getByText(/upload failed|500/i).first().waitFor()
  // Honest state: still pending, no download control, no scan-passed badge.
  assert.equal(await page.getByText('Security scan passed').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Download' }).count(), 0)
  await context.close()
})

await check('scanner unavailable keeps the file undownloadable', async () => {
  const api = makeApi({ uploadBehaviour: 'scan-pending' })
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)

  await page.getByPlaceholder('Document name').fill('Title deed')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.locator('label', { hasText: 'Upload file' }).first().click()
  await page.locator('input[data-upload-key="doc-1"]').setInputFiles({
    name: 'deed.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES,
  })
  await page.getByText('Scan unavailable — retry upload').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Download' }).count(), 0)
  assert.equal(api.calls.downloadLink.length, 0)
  await context.close()
})

await check('infected file is blocked and never downloadable', async () => {
  const api = makeApi({ uploadBehaviour: 'infected' })
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)

  await page.getByPlaceholder('Document name').fill('Suspicious file')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.locator('label', { hasText: 'Upload file' }).first().click()
  await page.locator('input[data-upload-key="doc-1"]').setInputFiles({
    name: 'evil.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES,
  })
  await page.getByText('Blocked by security scan').waitFor()
  await page.getByText(/failed the security scan/i).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Download' }).count(), 0)
  await context.close()
})

await check('withdrawn requirement renders without deleting its evidence', async () => {
  const api = makeApi({
    requirements: [{
      id: 'req-w', requirementKey: 'bond_letter', displayName: 'Bond approval letter',
      source: 'conditional', conditionKey: 'has_bond', status: 'withdrawn',
      satisfiedDocumentId: null, linkedDocumentId: 'doc-9',
    }],
    documents: [{
      id: 'doc-9', transferId: MATTER_ID, name: 'Bond approval letter',
      status: 'uploaded', scanStatus: 'clean', requirementKey: 'bond_letter',
      originalFileName: 'bond.pdf', fileType: 'application/pdf', fileSize: 1234,
      uploadedAt: '2026-09-17T10:00:00Z',
    }],
  })
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)
  await page.getByText('No longer required').waitFor()
  // The uploaded evidence is still listed and downloadable — never deleted.
  await page.getByText('bond.pdf').waitFor()
  assert.ok(await page.getByRole('button', { name: 'Download' }).count() >= 1)
  await context.close()
})

await check('document readback after reload', async () => {
  const api = makeApi({
    documents: [{
      id: 'doc-7', transferId: MATTER_ID, name: 'Rates clearance',
      status: 'uploaded', scanStatus: 'clean', requirementKey: null,
      originalFileName: 'rates.pdf', fileType: 'application/pdf', fileSize: 2048,
      uploadedAt: '2026-09-17T10:00:00Z',
    }],
  })
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)
  await page.getByText('Rates clearance').waitFor()
  await page.getByText('rates.pdf').waitFor()
  await page.getByText('Security scan passed').waitFor()
  await context.close()
})

await check('persistence probe accepts the real {message,data:{transfers}} envelope', async () => {
  // Wizard-path check, distinct from the documents envelope: GET
  // /api/v1/transfers/?limit=1 must satisfy data.transfers as an array for
  // Save Draft / Submit Transfer to unlock.
  const api = makeApi({})
  const { context, page } = await newAuthedPage(api)
  const probeResponse = page.waitForResponse(r => r.url().includes('/api/v1/transfers/?limit=1'))
  await page.goto(`${BASE}/transfers/workflow`)
  await probeResponse
  const save = page.getByRole('button', { name: 'Save Draft' })
  await save.waitFor()
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Save Draft')
    return btn && !btn.disabled
  }, { timeout: 5000 })
  await context.close()
})

await check('persistence probe fails closed on a malformed envelope', async () => {
  const api = makeApi({ probeMalformed: true })
  const { context, page } = await newAuthedPage(api)
  const probeResponse = page.waitForResponse(r => r.url().includes('/api/v1/transfers/?limit=1'))
  await page.goto(`${BASE}/transfers/workflow`)
  await probeResponse
  const save = page.getByRole('button', { name: 'Save Draft' })
  await save.waitFor()
  await page.waitForTimeout(500) // let probe state settle
  assert.equal(await save.isDisabled(), true)
  await context.close()
})

await check('missing classification renders as visibly unevaluated, not complete', async () => {
  // The API flags the missing matter fact; the section must render an
  // "evaluation incomplete" notice — never a silent empty/complete list.
  const api = makeApi({ unevaluatedFacts: ['classification_code'] })
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)
  const notice = page.locator('[data-testid="requirements-unevaluated-notice"]')
  await notice.waitFor()
  assert.match(await notice.innerText(), /evaluation is incomplete/i)
  assert.match(await notice.innerText(), /classification/i)
  await context.close()
})

await check('complete evaluation renders no unevaluated notice', async () => {
  const api = makeApi({})
  const { context, page } = await newAuthedPage(api)
  await openDocumentsTab(page)
  await page.waitForTimeout(500) // let the section settle after load
  assert.equal(
    await page.locator('[data-testid="requirements-unevaluated-notice"]').count(),
    0
  )
  await context.close()
})

await browser.close()
console.log('\n--- RESULTS ---')
results.forEach(r => console.log(r))
process.exit(results.every(r => r.startsWith('PASS')) ? 0 : 1)
