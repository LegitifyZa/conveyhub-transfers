import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

const TEMP_USERNAME = 'admin'
const TEMP_PASSWORD = 'Y8PmKXaT7lHW4d5T'
const AUTH_KEY = 'legitify_auth'

interface AuthContextValue {
  isAuthenticated: boolean
  login: (username: string, password: string) => boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem(AUTH_KEY) === '1'
  })

  const login = useCallback((username: string, password: string) => {
    if (username.trim().toLowerCase() === TEMP_USERNAME && password.trim() === TEMP_PASSWORD) {
      localStorage.setItem(AUTH_KEY, '1')
      setIsAuthenticated(true)
      return true
    }
    return false
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_KEY)
    setIsAuthenticated(false)
  }, [])

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
