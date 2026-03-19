import { useState, useEffect, useCallback } from 'react'
import { initializeDatabase, db } from '../lib/database'
import { DatabaseUtils } from '../lib/utils/databaseUtils'

export interface DatabaseState {
  isConnected: boolean
  isLoading: boolean
  error: string | null
  stats: any
}

export const useDatabase = () => {
  const [state, setState] = useState<DatabaseState>({
    isConnected: false,
    isLoading: true,
    error: null,
    stats: null
  })

  // Initialize database connection
  const initialize = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      await initializeDatabase()
      const stats = await DatabaseUtils.getTableStats()
      setState({
        isConnected: true,
        isLoading: false,
        error: null,
        stats
      })
    } catch (error) {
      setState({
        isConnected: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Database connection failed',
        stats: null
      })
    }
  }, [])

  // Test connection
  const testConnection = useCallback(async (): Promise<boolean> => {
    try {
      const connected = await db.testConnection()
      setState(prev => ({ ...prev, isConnected: connected, error: null }))
      return connected
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection test failed'
      setState(prev => ({ ...prev, isConnected: false, error: errorMessage }))
      return false
    }
  }, [])

  // Get database health
  const getHealth = useCallback(async () => {
    try {
      const health = await DatabaseUtils.getDatabaseHealth()
      return health
    } catch (error) {
      console.error('Error getting database health:', error)
      return null
    }
  }, [])

  // Refresh stats
  const refreshStats = useCallback(async () => {
    try {
      const stats = await DatabaseUtils.getTableStats()
      setState(prev => ({ ...prev, stats }))
    } catch (error) {
      console.error('Error refreshing stats:', error)
    }
  }, [])

  // Initialize on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  return {
    ...state,
    initialize,
    testConnection,
    getHealth,
    refreshStats
  }
}
