import type { HTMLAttributes } from 'react'

export function BrandEmblem(props: HTMLAttributes<HTMLSpanElement>) {
  return <span className="brand-mark" aria-hidden="true" {...props}>
    <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
      <path d="M5 16 12.5 8.5 20 16l-7.5 7.5L5 16Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
      <path d="m14.5 16 5-5 7 7-5 5-7-7Z" stroke="var(--hex-ffe7d9)" strokeWidth="2.1" strokeLinejoin="round" />
      <path d="M11.5 16h8" stroke="var(--hex-ffffff)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </span>
}
