import { Brain, Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip'

export type ReasoningEffortOption = {
  value: string
  label: string
}

type ReasoningEffortSelectorProps = {
  options: ReasoningEffortOption[]
  selectedEffort: string
  onEffortChange: (effort: string) => void
  disabled?: boolean
  className?: string
}

export function ReasoningEffortSelector({
  options,
  selectedEffort,
  onEffortChange,
  disabled = false,
  className,
}: ReasoningEffortSelectorProps) {
  const currentOption =
    options.find((o) => o.value === selectedEffort) ?? options[1] // Default to medium

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                className={cn(
                  'text-muted-foreground hover:text-foreground',
                  className,
                )}
              >
                <Brain className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Reasoning: {currentOption?.label}</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onEffortChange(option.value)}
              className="flex items-center gap-2"
            >
              <Brain className="text-muted-foreground size-3.5" />
              <span className="flex-1">{option.label}</span>
              {option.value === selectedEffort && (
                <Check className="text-primary size-4" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  )
}
