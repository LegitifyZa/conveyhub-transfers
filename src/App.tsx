import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/layouts'
import { Dashboard, Cases, Documents, DocumentCatalogue, DataDictionary, TemplateEngine, ClauseLibrary, DocumentGenerator, Settings, NewTransfer, Transfers, Bonds, Cancellations, TransfersDashboard, TransferMilestones } from '@/pages'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/transfers" replace />} />
        <Route path="/dashboard" element={<MainLayout><Dashboard /></MainLayout>} />
        <Route path="/cases" element={<MainLayout><Cases /></MainLayout>} />
        <Route path="/documents" element={<MainLayout><Documents /></MainLayout>} />
        <Route path="/document-catalogue" element={<MainLayout><DocumentCatalogue /></MainLayout>} />
        <Route path="/data-dictionary" element={<MainLayout><DataDictionary /></MainLayout>} />
        <Route path="/template-engine" element={<MainLayout><TemplateEngine /></MainLayout>} />
        <Route path="/clause-library" element={<MainLayout><ClauseLibrary /></MainLayout>} />
        <Route path="/document-generator" element={<MainLayout><DocumentGenerator /></MainLayout>} />
        <Route path="/settings" element={<MainLayout><Settings /></MainLayout>} />
        <Route path="/transfers" element={<MainLayout><TransfersDashboard /></MainLayout>} />
        <Route path="/transfers/new" element={<MainLayout><NewTransfer /></MainLayout>} />
        <Route path="/transfers/workflow" element={<MainLayout><Transfers /></MainLayout>} />
        <Route path="/transfers/:transferId/milestones" element={<MainLayout><TransferMilestones /></MainLayout>} />
        <Route path="/bonds" element={<MainLayout><Bonds /></MainLayout>} />
        <Route path="/cancellations" element={<MainLayout><Cancellations /></MainLayout>} />
      </Routes>
    </Router>
  )
}

export default App
