import { Link } from 'react-router-dom'
import './VeloSupplyLogo.css'

type Props = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function VeloSupplyLogo({ size = 'md', className = '' }: Props) {
  return <Link className={`velo-logo velo-logo-${size} ${className}`.trim()} to="/" aria-label="VeloSupply AI home">
    <span className="velo-logo-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42" role="presentation">
        <path className="velo-logo-frame" d="M21 3.7 35.2 12v18L21 38.2 6.8 30V12Z" />
        <path className="velo-logo-chevron" d="m11.5 13.2 9.3 16 9.2-16" />
        <path className="velo-logo-speed" d="M3 17h6M1.5 22h6" />
        <circle className="velo-logo-node" cx="33.5" cy="8.7" r="2.4" />
      </svg>
    </span>
    <span className="velo-logo-wordmark"><strong>VeloSupply</strong><small>AI</small></span>
  </Link>
}
