import { useNavigate } from 'react-router-dom';
import { FileQuestion, ChevronLeft } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '24px 16px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: 'var(--fill-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--label-secondary)',
          marginBottom: 16,
        }}
      >
        <FileQuestion size={36} strokeWidth={1.75} />
      </div>

      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--label-primary)',
          margin: '0 0 8px 0',
          letterSpacing: '-0.4px',
        }}
      >
        Page Not Found
      </h1>

      <p
        style={{
          fontSize: 14,
          color: 'var(--label-secondary)',
          maxWidth: 320,
          lineHeight: 1.5,
          margin: '0 0 24px 0',
        }}
      >
        The requested screen, voucher, or link does not exist or has been moved.
      </p>

      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          backgroundColor: 'var(--ios-blue)',
          color: '#ffffff',
          border: 'none',
          borderRadius: 14,
          padding: '12px 20px',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          minHeight: 44,
          boxShadow: 'none',
        }}
      >
        <ChevronLeft size={18} strokeWidth={2.5} />
        Return to Summary
      </button>
    </div>
  );
}
