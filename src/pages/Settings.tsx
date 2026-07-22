import React, { useEffect, useState } from 'react'
import { User, Bell, Shield, Palette, Globe, CreditCard, HelpCircle, LogOut } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'
import { apiRequest } from '@/lib/api/http'

interface UserProfile {
  id: string
  email: string
  name: string
  firstName?: string
  lastName?: string
  phone?: string
  avatarUrl?: string
}

const settingsSections = [
  { title: 'Profile Settings', icon: User, description: 'Manage your personal information and account details' },
  { title: 'Notifications', icon: Bell, description: 'Configure how you receive notifications and updates' },
  { title: 'Security', icon: Shield, description: 'Manage your password and security preferences' },
  { title: 'Appearance', icon: Palette, description: 'Customize the look and feel of your workspace' },
  { title: 'Language & Region', icon: Globe, description: 'Set your language preferences and regional settings' },
  { title: 'Billing & Plans', icon: CreditCard, description: 'Manage your subscription and payment methods' },
  { title: 'Help & Support', icon: HelpCircle, description: 'Get help and contact our support team' }
]

const Settings: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await apiRequest<{ success: boolean; data: UserProfile }>('/api/users/me')
        if (response.success && response.data) {
          setUser(response.data)
          setFirstName(response.data.firstName || '')
          setLastName(response.data.lastName || '')
          setEmail(response.data.email || '')
          setPhone(response.data.phone || '')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      } finally {
        setIsLoading(false)
      }
    }

    loadProfile()
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setError('')
    setSuccess('')

    try {
      const response = await apiRequest<{ success: boolean; data: UserProfile; message?: string }>('/api/users/me', {
        method: 'PUT',
        body: { firstName, lastName, email, phone }
      })

      if (response.success && response.data) {
        setUser(response.data)
        setSuccess(response.message || 'Profile updated successfully')
      } else {
        setError('Update failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setIsSaving(false)
    }
  }

  const displayName = user?.name || `${firstName} ${lastName}`.trim() || '—'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400">Manage your account settings and preferences</p>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center space-x-4">
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-teal-500 to-navy-600 flex items-center justify-center">
                <User className="h-8 w-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">{displayName}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{email}</p>
                <Button variant="outline" size="sm" className="mt-2">
                  Change Photo
                </Button>
              </div>
            </div>

            {isLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading profile...</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      First Name
                    </label>
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Last Name
                    </label>
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email
                    </label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Phone
                    </label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                )}
                {success && (
                  <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
                )}

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {settingsSections.map((section) => (
          <Card key={section.title} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-start space-x-4">
                <div className="p-2 bg-gray-100 dark:bg-navy-700 rounded-lg">
                  <section.icon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">{section.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{section.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Danger Zone */}
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="text-lg text-red-600 dark:text-red-400">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Delete Account</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Once you delete your account, there is no going back. Please be certain.
              </p>
              <Button variant="outline" className="text-red-600 border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                Delete Account
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logout */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Sign Out</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Sign out of your account on this device
              </p>
            </div>
            <Button variant="outline" className="text-red-600 border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { Settings }
