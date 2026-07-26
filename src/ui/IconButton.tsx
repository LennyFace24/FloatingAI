import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  label: string;
  tooltip: string;
  children: ReactNode;
}

export function IconButton({ label, tooltip, children, className = '', ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      className={`icon-button ${className}`.trim()}
      type={props.type ?? 'button'}
      aria-label={label}
      title={tooltip}
    >
      {children}
    </button>
  );
}
