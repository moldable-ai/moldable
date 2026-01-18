import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@moldable-ai/ui'

interface SettingsGeneralProps {
  theme: string
  resolvedTheme?: string
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void
}

export function SettingsGeneral({
  theme,
  onThemeChange,
}: SettingsGeneralProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">General</h2>
        <p className="text-muted-foreground text-xs">
          Configure general application preferences
        </p>
      </div>

      {/* Appearance section */}
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">Appearance</h3>
          <p className="text-muted-foreground text-xs">
            Choose how Moldable looks on your device
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <ThemeOption
            label="Light"
            icon={<Sun className="size-5" />}
            isSelected={theme === 'light'}
            onClick={() => onThemeChange('light')}
          />
          <ThemeOption
            label="Dark"
            icon={<Moon className="size-5" />}
            isSelected={theme === 'dark'}
            onClick={() => onThemeChange('dark')}
          />
          <ThemeOption
            label="System"
            icon={<Monitor className="size-5" />}
            isSelected={theme === 'system'}
            onClick={() => onThemeChange('system')}
          />
        </div>
      </section>
    </div>
  )
}

function ThemeOption({
  label,
  icon,
  isSelected,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 transition-colors',
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/50 hover:bg-muted/50',
      )}
    >
      <div
        className={cn(
          'flex size-10 items-center justify-center rounded-full',
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </div>
      <span
        className={cn(
          'text-sm',
          isSelected ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      {isSelected && (
        <div className="bg-primary text-primary-foreground absolute right-2 top-2 flex size-5 items-center justify-center rounded-full">
          <Check className="size-3" />
        </div>
      )}
    </button>
  )
}
