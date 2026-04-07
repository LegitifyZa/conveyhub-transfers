import React, { useState } from 'react'
import { X, Mail, Send, User } from 'lucide-react'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui'

interface Client {
  id: string
  name: string
  email: string
  property: string
}

interface EmailModalProps {
  isOpen: boolean
  onClose: () => void
  onSendEmail: (emailData: EmailData) => void
}

interface EmailData {
  to: string
  subject: string
  message: string
  clientName: string
}

export const EmailModal: React.FC<EmailModalProps> = ({
  isOpen,
  onClose,
  onSendEmail
}) => {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)

  // Mock clients data
  const clients: Client[] = [
    {
      id: '1',
      name: 'John Smith',
      email: 'john.smith@email.com',
      property: '123 Oak Street'
    },
    {
      id: '2',
      name: 'Sarah Johnson',
      email: 'sarah.johnson@email.com',
      property: '456 Elm Avenue'
    },
    {
      id: '3',
      name: 'Michael Brown',
      email: 'michael.brown@email.com',
      property: '789 Pine Road'
    },
    {
      id: '4',
      name: 'Emily Davis',
      email: 'emily.davis@email.com',
      property: '321 Maple Lane'
    },
    {
      id: '5',
      name: 'Robert Wilson',
      email: 'robert.wilson@email.com',
      property: '654 Cedar Court'
    }
  ]

  const handleSendEmail = async () => {
    if (!selectedClient || !subject.trim() || !message.trim()) {
      return
    }

    setIsSending(true)

    try {
      // Simulate sending email
      await new Promise(resolve => setTimeout(resolve, 2000))

      const emailData: EmailData = {
        to: selectedClient.email,
        subject,
        message,
        clientName: selectedClient.name
      }

      onSendEmail(emailData)
      
      // Reset form
      setSelectedClient(null)
      setSubject('')
      setMessage('')
      onClose()
    } catch (error) {
      console.error('Failed to send email:', error)
    } finally {
      setIsSending(false)
    }
  }

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client)
    // Pre-fill subject with client's name
    setSubject(`Update regarding your property transfer - ${client.property}`)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-navy-800 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-navy-700">
          <div className="flex items-center space-x-3">
            <Mail className="h-5 w-5 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Send Email to Client
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex h-[calc(90vh-8rem)]">
          {/* Client Selection Sidebar */}
          <div className="w-80 border-r border-gray-200 dark:border-navy-700 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Select Client
              </h3>
              <div className="space-y-2">
                {clients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => handleClientSelect(client)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedClient?.id === client.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-navy-700 hover:bg-gray-50 dark:hover:bg-navy-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                        <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {client.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {client.email}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {client.property}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Email Composition */}
          <div className="flex-1 flex flex-col">
            <div className="p-6 flex-1 overflow-y-auto">
              {selectedClient ? (
                <div className="space-y-4">
                  {/* Selected Client Info */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                    <div className="flex items-center space-x-3">
                      <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <div>
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                          {selectedClient.name}
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          {selectedClient.email}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Email Form */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      To
                    </label>
                    <Input
                      value={selectedClient.email}
                      disabled
                      className="bg-gray-50 dark:bg-navy-700"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Subject
                    </label>
                    <Input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Enter email subject"
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Message
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Type your message here..."
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-navy-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-navy-700 dark:text-gray-100 resize-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Mail className="h-12 w-12 text-gray-400 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Select a Client
                  </h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Choose a client from the list to compose an email
                  </p>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-6 border-t border-gray-200 dark:border-navy-700">
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isSending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSendEmail}
                  disabled={!selectedClient || !subject.trim() || !message.trim() || isSending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isSending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Send Email
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
