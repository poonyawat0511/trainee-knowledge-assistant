'use client'

import { useState } from 'react'

export default function UploadPage() {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setStatus('uploading')
    setMessage(null)

    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/documents', { method: 'POST', body: formData })
    const body = await response.json()

    if (!response.ok) {
      setStatus('error')
      setMessage(body.error?.message ?? 'Upload failed')
      return
    }

    setStatus('done')
    setMessage(`Uploaded "${body.filename}" (${body.charCount} characters extracted)`)
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Upload a document</h1>
      <input type="file" accept=".pdf,.txt" onChange={handleUpload} />
      {status === 'uploading' && <p className="mt-4 text-sm text-gray-500">Uploading…</p>}
      {message && (
        <p className={`mt-4 text-sm ${status === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {message}
        </p>
      )}
    </main>
  )
}
