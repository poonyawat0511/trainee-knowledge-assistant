'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Upload as UploadIcon, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function UploadPage() {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done'>('idle')

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setStatus('uploading')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/documents', { method: 'POST', body: formData })
      const body = await response.json()

      if (!response.ok) {
        setStatus('idle')
        toast.error(body.error?.message ?? 'Upload failed')
        return
      }

      setStatus('done')
      toast.success(`Uploaded "${body.filename}" (${body.charCount} characters extracted)`)
    } catch {
      setStatus('idle')
      toast.error('Upload failed')
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadIcon className="size-5" />
            Upload a document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            PDF or TXT files are supported. The extracted text becomes available as chat context.
          </p>
          <Input type="file" accept=".pdf,.txt" onChange={handleUpload} disabled={status === 'uploading'} />
          {status === 'uploading' && <p className="text-sm text-muted-foreground">Uploading…</p>}
          <Button
            render={
              <Link href="/chat">
                <ArrowLeft className="size-4" />
                Back to chat
              </Link>
            }
            variant="ghost"
            className="w-full justify-start gap-2"
          />
        </CardContent>
      </Card>
    </div>
  )
}
