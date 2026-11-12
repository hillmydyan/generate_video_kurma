import React from 'react';
import { STATUS_META, TaskStatus } from '@/lib/format';
import { Icon } from './Icon';

interface StatusBadgeProps {
  status: string;
  className?: string;
  showIcon?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className = '',
  showIcon = true,
}) => {
  const meta = STATUS_META[status as TaskStatus] || {
    label: status,
    badgeClass: 'badge-queued',
    icon: 'help_outline',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.badgeClass} ${className}`}
    >
      {showIcon && (
        <Icon
          name={meta.icon}
          size={14}
          className={status === 'generating' || status === 'downloading' ? 'animate-fs-spin' : ''}
        />
      )}
      <span>{meta.label}</span>
    </span>
  );
};

