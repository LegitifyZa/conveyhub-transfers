import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { 
  Home, 
  FileText, 
  Shield, 
  RefreshCw,
  FolderOpen,
  BookOpen,
  Braces,
  Code2,
  Library,
  Wand2,
  Settings,
  Moon,
  Sun
} from 'lucide-react'
import { cn } from '@/utils/cn'

interface SidebarItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  href: string
  isActive?: boolean
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon: Icon, label, href, isActive }) => {
  return (
    <Link
      to={href}
      className={cn(
        'flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors duration-200',
        isActive
          ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-navy-700 hover:text-gray-900 dark:hover:text-gray-100'
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="font-medium">{label}</span>
    </Link>
  )
}

interface SidebarProps {
  className?: string
}

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: Home },
  { name: 'Cases', href: '/cases', icon: FileText },
  { name: 'Documents', href: '/documents', icon: FolderOpen },
  { name: 'Document Catalogue', href: '/document-catalogue', icon: BookOpen },
  { name: 'Data Dictionary', href: '/data-dictionary', icon: Braces },
  { name: 'Template Engine', href: '/template-engine', icon: Code2 },
  { name: 'Clause Library', href: '/clause-library', icon: Library },
  { name: 'Document Generator', href: '/document-generator', icon: Wand2 },
  { name: 'Transfers', href: '/transfers', icon: FileText },
  { name: 'Bonds', href: '/bonds', icon: Shield },
  { name: 'Cancellations', href: '/cancellations', icon: RefreshCw },
  { name: 'Settings', href: '/settings', icon: Settings },
]

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
  const location = useLocation()
  const [isDarkMode, setIsDarkMode] = React.useState(() => {
    return localStorage.getItem('darkMode') === 'true'
  })

  React.useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('darkMode', isDarkMode.toString())
  }, [isDarkMode])

  return (
    <aside className={cn(
      'w-64 border-r border-gray-200 dark:border-navy-700 bg-white dark:bg-navy-800',
      className
    )}>
      <div className="h-full flex flex-col">
        <div className="p-6">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-teal-500 to-navy-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">L</span>
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Legitify
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Convey Hub</p>
        </div>

        <nav className="flex-1 px-4 pb-6">
          <div className="space-y-1">
            {navigation.map((item) => (
              <SidebarItem
                key={item.href}
                icon={item.icon}
                label={item.name}
                href={item.href}
                isActive={location.pathname === item.href}
              />
            ))}
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-navy-700">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-navy-700 hover:text-gray-900 dark:hover:text-gray-100 transition-all duration-200 w-full"
          >
            {isDarkMode ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
            <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
      </div>
    </aside>
  )
}

export { Sidebar }
