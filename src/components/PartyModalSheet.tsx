import React, { useState } from 'react';
import { Building2, Phone, MapPin, User, X } from 'lucide-react';

interface PartyModalSheetProps {
  isOpen: boolean;
  mode: 'add' | 'edit';
  initialData?: {
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
  };
  onClose: () => void;
  onSave: (data: {
    name: string;
    contactPerson: string;
    phone: string;
    address: string;
  }) => void;
}

export default function PartyModalSheet({
  isOpen,
  mode,
  initialData,
  onClose,
  onSave
}: PartyModalSheetProps) {
  if (!isOpen) return null;

  return (
    <PartyModalContent
      key={mode === 'edit' ? (initialData?.name || 'edit') : 'add'}
      mode={mode}
      initialData={initialData}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function PartyModalContent({
  mode,
  initialData,
  onClose,
  onSave
}: Omit<PartyModalSheetProps, 'isOpen'>) {
  const [name, setName] = useState(initialData?.name || '');
  const [contactPerson, setContactPerson] = useState(initialData?.contactPerson || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [address, setAddress] = useState(initialData?.address || '');

  const isValid = name.trim().length > 0;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValid) return;
    onSave({
      name: name.trim(),
      contactPerson: contactPerson.trim() || name.trim(),
      phone: phone.trim(),
      address: address.trim()
    });
  };

  // Get 1-2 initials for Apple Contacts style monogram
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');

  return (
    <>
      {/* ── Apple Dimmed Blur Backdrop ── */}
      <div
        className="ios-modal-backdrop"
        onClick={onClose}
        style={{ zIndex: 99998 }}
      />

      {/* ── Apple iOS Modal Sheet ── */}
      <div
        className="ios-bottom-sheet"
        style={{
          zIndex: 99999,
          maxHeight: '88vh',
          height: 'auto',
          background: 'var(--bg-grouped)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTop: '0.5px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.5)'
        }}
      >
        {/* Grabber Handle */}
        <div
          className="ios-sheet-handle"
          style={{
            width: 36,
            height: 5,
            borderRadius: 3,
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
            margin: '8px auto 4px'
          }}
        />

        {/* Navigation Bar */}
        <div
          className="ios-sheet-header"
          style={{
            padding: '10px 16px 12px',
            borderBottom: '0.5px solid var(--separator)',
            background: 'var(--bg-grouped)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ios-blue)',
              fontSize: 17,
              fontWeight: 400,
              cursor: 'pointer',
              padding: '4px 6px'
            }}
          >
            Cancel
          </button>

          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--label-primary)'
            }}
          >
            {mode === 'add' ? 'New Party' : 'Edit Party'}
          </span>

          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={!isValid}
            style={{
              background: 'transparent',
              border: 'none',
              color: isValid ? 'var(--ios-blue)' : 'var(--label-quaternary)',
              fontSize: 17,
              fontWeight: 600,
              cursor: isValid ? 'pointer' : 'default',
              padding: '4px 6px',
              transition: 'color 0.15s ease'
            }}
          >
            {mode === 'add' ? 'Add' : 'Save'}
          </button>
        </div>

        {/* Sheet Content Body */}
        <form
          onSubmit={handleSubmit}
          className="ios-sheet-body"
          style={{
            padding: '0 0 max(32px, env(safe-area-inset-bottom))',
            background: 'var(--bg-grouped)',
            overflowY: 'auto'
          }}
        >
          {/* Apple Contacts Style Profile Monogram */}
          <div
            style={{
              display: 'flex',
              color: 'black',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '20px 16px 12px'
            }}
          >
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'none',
                marginBottom: 8
              }}
            >
              {initials ? (
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: 'var(--ios-blue)',
                    letterSpacing: 0.5
                  }}
                >
                  {initials}
                </span>
              ) : (
                <Building2 size={34} color="var(--ios-blue)" strokeWidth={1.8} />
              )}
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--label-secondary)',
                letterSpacing: -0.1
              }}
            >
              {name.trim() || (mode === 'add' ? 'Add Party Profile' : 'Party Details')}
            </span>
          </div>

          {/* Inset Grouped Table Section */}
          <div className="ios-group" style={{ margin: '8px 16px 20px' }}>
            <div className="ios-group-title" style={{ paddingLeft: 4 }}>
              PARTY DETAILS
            </div>

            <div className="ios-card-grouped">
              {/* Row 1: Party / Company Name */}
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 52,
                  padding: '8px 16px',
                  background: 'var(--bg-card)'
                }}
              >
                <div
                  className="ios-glyph-badge"
                  style={{ background: '#0A84FF', marginRight: 12 }}
                >
                  <Building2 size={18} strokeWidth={2.2} />
                </div>
                <span
                  style={{
                    width: 72,
                    fontSize: 16,
                    color: 'var(--label-secondary)',
                    fontWeight: 400,
                    flexShrink: 0
                  }}
                >
                  Name
                </span>
                <input
                  type="text"
                  required
                  autoFocus={mode === 'add'}
                  placeholder="Required"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 17,
                    color: 'var(--label-primary)',
                    fontFamily: 'var(--font-system)'
                  }}
                />
                {name.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setName('')}
                    style={{
                      background: 'var(--fill-tertiary)',
                      border: 'none',
                      borderRadius: '50%',
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--label-secondary)',
                      cursor: 'pointer',
                      padding: 0,
                      marginLeft: 8
                    }}
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
                <div className="ios-separator with-glyph" style={{ left: 56 }} />
              </div>

              {/* Row 2: Contact Person */}
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 52,
                  padding: '8px 16px',
                  background: 'var(--bg-card)'
                }}
              >
                <div
                  className="ios-glyph-badge"
                  style={{ background: '#5E5CE6', marginRight: 12 }}
                >
                  <User size={18} strokeWidth={2.2} />
                </div>
                <span
                  style={{
                    width: 72,
                    fontSize: 16,
                    color: 'var(--label-secondary)',
                    fontWeight: 400,
                    flexShrink: 0
                  }}
                >
                  Contact
                </span>
                <input
                  type="text"
                  placeholder="Optional"
                  value={contactPerson}
                  onChange={e => setContactPerson(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 17,
                    color: 'var(--label-primary)',
                    fontFamily: 'var(--font-system)'
                  }}
                />
                {contactPerson.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setContactPerson('')}
                    style={{
                      background: 'var(--fill-tertiary)',
                      border: 'none',
                      borderRadius: '50%',
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--label-secondary)',
                      cursor: 'pointer',
                      padding: 0,
                      marginLeft: 8
                    }}
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
                <div className="ios-separator with-glyph" style={{ left: 56 }} />
              </div>

              {/* Row 3: Phone */}
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 52,
                  padding: '8px 16px',
                  background: 'var(--bg-card)'
                }}
              >
                <div
                  className="ios-glyph-badge"
                  style={{ background: '#34C759', marginRight: 12 }}
                >
                  <Phone size={18} strokeWidth={2.2} />
                </div>
                <span
                  style={{
                    width: 72,
                    fontSize: 16,
                    color: 'var(--label-secondary)',
                    fontWeight: 400,
                    flexShrink: 0
                  }}
                >
                  Phone
                </span>
                <input
                  type="tel"
                  placeholder="Optional"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 17,
                    color: 'var(--label-primary)',
                    fontFamily: 'var(--font-system)'
                  }}
                />
                {phone.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPhone('')}
                    style={{
                      background: 'var(--fill-tertiary)',
                      border: 'none',
                      borderRadius: '50%',
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--label-secondary)',
                      cursor: 'pointer',
                      padding: 0,
                      marginLeft: 8
                    }}
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
                <div className="ios-separator with-glyph" style={{ left: 56 }} />
              </div>

              {/* Row 4: Address */}
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 52,
                  padding: '8px 16px',
                  background: 'var(--bg-card)'
                }}
              >
                <div
                  className="ios-glyph-badge"
                  style={{ background: '#FF9500', marginRight: 12 }}
                >
                  <MapPin size={18} strokeWidth={2.2} />
                </div>
                <span
                  style={{
                    width: 72,
                    fontSize: 16,
                    color: 'var(--label-secondary)',
                    fontWeight: 400,
                    flexShrink: 0
                  }}
                >
                  Address
                </span>
                <input
                  type="text"
                  placeholder="Optional"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 17,
                    color: 'var(--label-primary)',
                    fontFamily: 'var(--font-system)'
                  }}
                />
                {address.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAddress('')}
                    style={{
                      background: 'var(--fill-tertiary)',
                      border: 'none',
                      borderRadius: '50%',
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--label-secondary)',
                      cursor: 'pointer',
                      padding: 0,
                      marginLeft: 8
                    }}
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
                {/* No separator below the last item */}
              </div>
            </div>

            <div className="ios-group-footnote" style={{ paddingLeft: 4, marginTop: 8 }}>
              Parties are saved to your ledger and can be referenced in dispatches, invoices, and payments.
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
