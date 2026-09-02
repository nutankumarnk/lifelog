import React, { useEffect, useRef } from 'react';

interface AIInfoPopoverProps {
  request?: unknown;
  response?: unknown;
  onClose: () => void;
}

export const AIInfoPopover: React.FC<AIInfoPopoverProps> = ({ request, response, onClose }) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div className="popover-backdrop">
      <div className="popover" ref={popoverRef}>
        <button className="popover-close" onClick={onClose}>×</button>
        <h2>AI Request / Response Details</h2>
        {request ? (
          <div>
            <h3>Request</h3>
            <pre>{JSON.stringify(request, null, 2)}</pre>
          </div>
        ) : (
          <p>No request data available.</p>
        )}
        {response ? (
          <div>
            <h3>Response</h3>
            <pre>{JSON.stringify(response, null, 2)}</pre>
          </div>
        ) : (
          <p>No response data available.</p>
        )}
      </div>
    </div>
  );
};
