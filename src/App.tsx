import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { MainLayout } from '@/layouts'
import { Landing, Dashboard, Cases, Documents, Settings, NewTransfer, Transfers, Bonds, Cancellations, TransfersDashboard } from '@/pages'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<MainLayout><Dashboard /></MainLayout>} />
        <Route path="/cases" element={<MainLayout><Cases /></MainLayout>} />
        <Route path="/documents" element={<MainLayout><Documents /></MainLayout>} />
        <Route path="/settings" element={<MainLayout><Settings /></MainLayout>} />
        <Route path="/transfers" element={<MainLayout><TransfersDashboard /></MainLayout>} />
        <Route path="/transfers/new" element={<MainLayout><NewTransfer /></MainLayout>} />
        <Route path="/transfers/workflow" element={<MainLayout><Transfers /></MainLayout>} />
        <Route path="/bonds" element={<MainLayout><Bonds /></MainLayout>} />
        <Route path="/cancellations" element={<MainLayout><Cancellations /></MainLayout>} />
      </Routes>
    </Router>
  )
}

export default App
