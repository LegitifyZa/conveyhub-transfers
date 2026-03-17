import React from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { cn } from '@/utils/cn'

interface MainLayoutProps {
  children: React.ReactNode
  className?: string
}

const MainLayout: React.FC<MainLayoutProps> = ({ children, className }) => {
  return (
    <div className={cn('h-screen flex flex-col bg-gray-50 dark:bg-navy-900', className)}>
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

export { MainLayout }
