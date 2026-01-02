// components/LeadStatusBadge.tsx
import React from 'react';

export type LeadStatus = 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';

interface LeadStatusBadgeProps {
  status: LeadStatus | string;
  className?: string;
}

const statusConfig: Record<
  LeadStatus,
  {
    label: string;
    bgColor: string;
    textColor: string;
    ariaLabel: string;
    animate?: boolean;
  }
> = {
  NOT_PICK: {
    label: 'No response yet',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-700',
    ariaLabel: 'Lead status: No response yet - No response from contact',
  },
  COLD: {
    label: 'Cold',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    ariaLabel: 'Lead status: Cold - Low interest level',
  },
  WARM: {
    label: 'Warm',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-700',
    ariaLabel: 'Lead status: Warm - Moderate interest level',
  },
  HOT: {
    label: 'Hot',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
    ariaLabel: 'Lead status: Hot - High interest level, immediate attention needed',
    animate: true,
  },
};

export function LeadStatusBadge({ status, className = '' }: LeadStatusBadgeProps) {
  const config = statusConfig[status as LeadStatus] || {
    label: status,
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-700',
    ariaLabel: `Lead status: ${status}`,
  };

  const baseClasses = 'px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center';
  const colorClasses = `${config.bgColor} ${config.textColor}`;
  const animationClass = config.animate ? 'animate-pulse' : '';
  const combinedClasses = `${baseClasses} ${colorClasses} ${animationClass} ${className}`.trim();

  return (
    <span
      className={combinedClasses}
      role="status"
      aria-label={config.ariaLabel}
      aria-live="polite"
    >
      {config.label}
    </span>
  );
}

