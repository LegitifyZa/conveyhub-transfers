import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { MainLayout } from '@/layouts'
import { Dashboard, Cases, Documents, DocumentCatalogue, DataDictionary, TemplateEngine, ClauseLibrary, DocumentGenerator, Settings, Login, NewTransfer, Transfers, Bonds, Cancellations, TransfersDashboard, TransferMilestones, AccountsCalculator } from '@/pages'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function AuthenticatedRoutes() {
  const { isAuthenticated } = useAuth()
  return (
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate to="/transfers" replace /> : <Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<RequireAuth><MainLayout><Dashboard /></MainLayout></RequireAuth>} />
      <Route path="/cases" element={<RequireAuth><MainLayout><Cases /></MainLayout></RequireAuth>} />
      <Route path="/documents" element={<RequireAuth><MainLayout><Documents /></MainLayout></RequireAuth>} />
      <Route path="/document-catalogue" element={<RequireAuth><MainLayout><DocumentCatalogue /></MainLayout></RequireAuth>} />
      <Route path="/data-dictionary" element={<RequireAuth><MainLayout><DataDictionary /></MainLayout></RequireAuth>} />
      <Route path="/template-engine" element={<RequireAuth><MainLayout><TemplateEngine /></MainLayout></RequireAuth>} />
      <Route path="/clause-library" element={<RequireAuth><MainLayout><ClauseLibrary /></MainLayout></RequireAuth>} />
      <Route path="/document-generator" element={<RequireAuth><MainLayout><DocumentGenerator /></MainLayout></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><MainLayout><Settings /></MainLayout></RequireAuth>} />
      <Route path="/transfers" element={<RequireAuth><MainLayout><TransfersDashboard /></MainLayout></RequireAuth>} />
      <Route path="/transfers/new" element={<RequireAuth><MainLayout><NewTransfer /></MainLayout></RequireAuth>} />
      <Route path="/transfers/workflow" element={<RequireAuth><MainLayout><Transfers /></MainLayout></RequireAuth>} />
      <Route path="/transfers/:transferId/milestones" element={<RequireAuth><MainLayout><TransferMilestones /></MainLayout></RequireAuth>} />
      <Route path="/accounts" element={<RequireAuth><MainLayout><AccountsCalculator /></MainLayout></RequireAuth>} />
      <Route path="/calculators" element={<RequireAuth><MainLayout><AccountsCalculator /></MainLayout></RequireAuth>} />
      <Route path="/bonds" element={<RequireAuth><MainLayout><Bonds /></MainLayout></RequireAuth>} />
      <Route path="/cancellations" element={<RequireAuth><MainLayout><Cancellations /></MainLayout></RequireAuth>} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AuthenticatedRoutes />
      </Router>
    </AuthProvider>
  )
}

export default App
