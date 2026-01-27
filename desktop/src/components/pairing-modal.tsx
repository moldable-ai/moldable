import { MessageSquare, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@moldable-ai/ui'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'

interface PairingRequest {
  channel: string
  sender_id: string
  display_name?: string
  code: string
  timestamp: string
}

export function PairingModal() {
  const [request, setRequest] = useState<PairingRequest | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Listen for pairing requests from the gateway
  useEffect(() => {
    const unlisten = listen<PairingRequest>(
      'gateway:pairing-requested',
      (event) => {
        console.log('[PairingModal] Received pairing request:', event.payload)
        setRequest(event.payload)
      },
    )

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const handleApprove = useCallback(async () => {
    if (!request) return

    setIsProcessing(true)
    try {
      await invoke('approve_pairing', {
        channel: request.channel,
        code: request.code,
      })
      toast.success('Pairing approved! The user can now send messages.')
      setRequest(null)
    } catch (error) {
      console.error('[PairingModal] Failed to approve:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to approve pairing',
      )
    } finally {
      setIsProcessing(false)
    }
  }, [request])

  const handleDeny = useCallback(async () => {
    if (!request) return

    setIsProcessing(true)
    try {
      await invoke('deny_pairing', {
        channel: request.channel,
        code: request.code,
      })
      toast.info('Pairing denied.')
      setRequest(null)
    } catch (error) {
      console.error('[PairingModal] Failed to deny:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to deny pairing',
      )
    } finally {
      setIsProcessing(false)
    }
  }, [request])

  const handleCancelAndDisable = useCallback(async () => {
    if (!request) return

    setIsProcessing(true)
    try {
      // First deny the pairing request
      await invoke('deny_pairing', {
        channel: request.channel,
        code: request.code,
      })

      // Then disable the Telegram channel via gateway WebSocket
      await invoke('gateway_config_patch', {
        patch: {
          channels: {
            telegram: {
              enabled: false,
            },
          },
        },
      })

      toast.info('Pairing cancelled and Telegram channel disabled.')
      setRequest(null)
    } catch (error) {
      console.error('[PairingModal] Failed to cancel:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to cancel and disable',
      )
    } finally {
      setIsProcessing(false)
    }
  }, [request])

  if (!request) return null

  const displayName = request.display_name || request.sender_id
  const channelLabel =
    request.channel.charAt(0).toUpperCase() + request.channel.slice(1)

  return (
    <AlertDialog open={true} onOpenChange={() => {}}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="bg-primary/10 mx-auto mb-4 flex size-16 items-center justify-center rounded-full">
            <MessageSquare className="text-primary size-8" />
          </div>
          <AlertDialogTitle className="text-center">
            Pairing Request
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            <span className="font-medium">{displayName}</span> wants to connect
            via {channelLabel}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="bg-muted/50 my-4 flex items-center justify-center gap-2 rounded-lg py-3">
          <span className="text-muted-foreground text-sm">Pairing code:</span>
          <code className="bg-background rounded px-2 py-1 font-mono text-lg font-semibold">
            {request.code}
          </code>
        </div>

        <div className="bg-muted/30 mb-4 flex items-start gap-2 rounded-lg border px-3 py-2">
          <ShieldAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-xs">
            Only approve if you recognize this user and initiated the pairing
            from {channelLabel}.
          </p>
        </div>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            onClick={handleApprove}
            disabled={isProcessing}
            className="w-full"
          >
            {isProcessing ? 'Processing...' : 'Approve'}
          </AlertDialogAction>
          <AlertDialogCancel
            onClick={handleDeny}
            disabled={isProcessing}
            className="w-full"
          >
            Deny
          </AlertDialogCancel>
          <Button
            variant="ghost"
            onClick={handleCancelAndDisable}
            disabled={isProcessing}
            className="text-destructive hover:text-destructive w-full"
          >
            Cancel and disable {channelLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
