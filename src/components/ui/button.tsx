import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium select-none transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:brightness-110 active:brightness-95 shadow-sm',
        interactive: 'bg-interactive text-white hover:brightness-110',
        secondary: 'bg-surface text-text border border-border hover:bg-surface-2',
        ghost: 'text-text hover:bg-surface-2',
        danger: 'bg-recording text-white hover:brightness-110',
        'danger-outline': 'border border-recording/40 text-recording bg-surface hover:bg-recording/5',
        link: 'text-interactive underline-offset-4 hover:underline px-0 min-h-0',
      },
      size: {
        sm: 'min-h-11 px-3 text-sm',
        md: 'min-h-12 px-4 text-[0.95rem]',
        lg: 'min-h-14 px-6 text-base',
        icon: 'size-12',
        'icon-sm': 'size-11',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
))
Button.displayName = 'Button'
