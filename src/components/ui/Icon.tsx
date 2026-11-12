import React from 'react';

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  filled?: boolean;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 20,
  className = '',
  filled = false,
}) => {
  return (
    <span
      className={`material-symbols-outlined select-none inline-flex items-center justify-center leading-none ${className}`}
      style={{
        fontSize: `${size}px`,
        fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0",
      }}
    >
      {name}
    </span>
  );
};

