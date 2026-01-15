import type { LogoVendor } from '@moldable-ai/ai/client'
import { useTheme } from '@moldable-ai/ui'

type VendorLogoProps = {
  vendor: LogoVendor
  className?: string
}

export function VendorLogo({ vendor, className = 'size-4' }: VendorLogoProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const src = isDark
    ? `/llms/vendor=${vendor}-dark.svg`
    : `/llms/vendor=${vendor}.svg`

  return <img src={src} alt={vendor} className={className} />
}
