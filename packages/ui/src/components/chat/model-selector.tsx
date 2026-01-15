import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

export type ModelOption = {
  id: string
  name: string
  icon: ReactNode
}

type ModelSelectorProps = {
  models: ModelOption[]
  selectedModel: string
  onModelChange: (modelId: string) => void
  disabled?: boolean
  className?: string
}

export function ModelSelector({
  models,
  selectedModel,
  onModelChange,
  disabled = false,
  className,
}: ModelSelectorProps) {
  const currentModel = models.find((m) => m.id === selectedModel) ?? models[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            'text-muted-foreground hover:text-foreground h-7 gap-1.5 rounded-full px-2.5 text-xs font-medium',
            className,
          )}
        >
          <span>{currentModel?.icon}</span>
          <span>{currentModel?.name}</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => onModelChange(model.id)}
            className="flex items-center gap-2"
          >
            <span>{model.icon}</span>
            <span className="flex-1">{model.name}</span>
            {model.id === selectedModel && (
              <Check className="text-primary size-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
