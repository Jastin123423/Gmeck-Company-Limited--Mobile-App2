import React from 'react';

export const PurchaseIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...props}
  >
    {/* Vertical downward arrow */}
    <path d="M12 3v12" />
    <path d="m8 11 4 4 4-4" />
    {/* Curved lower semi-circle bowl arc */}
    <path d="M4 12a8 8 0 0 0 16 0" />
  </svg>
);
