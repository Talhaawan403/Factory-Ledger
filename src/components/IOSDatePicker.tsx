import React, { useState, useRef, type CSSProperties } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRefraction } from '../hooks/useRefraction';

interface Props {
  label: string;
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  floating?: boolean;
  disabled?: boolean;
}

function parseLocalDate(dateStr?: string): Date {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month, day, 12, 0, 0);
    }
  }
  return new Date(dateStr);
}

export default function IOSDatePicker({ label, value, onChange, style, inputStyle, floating = false, disabled = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => (value ? parseLocalDate(value) : new Date()));

  const sheetRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 28;
  useRefraction(sheetRef, isOpen, { radius: GLASS_RADIUS, blur: 12, saturate: 1.5 });

  const handleOpen = () => {
    if (disabled) return;
    if (value) {
      setCurrentMonth(parseLocalDate(value));
    }
    setIsOpen(true);
  };

  const selectedDate = value ? parseLocalDate(value) : null;

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const dateFormat = "yyyy-MM-dd";
  const days = eachDayOfInterval({
    start: startDate,
    end: endDate
  });

  const handleDateClick = (day: Date) => {
    onChange(format(day, dateFormat));
    setIsOpen(false);
  };

  const displayValue = value ? format(parseLocalDate(value), 'MMM d, yyyy') : '';
  const isFloated = floating && (isOpen || Boolean(value));

  return (
    <>
      {floating ? (
        <div
          className={`floating-field ${isOpen ? 'is-focused' : ''} ${isFloated ? 'is-floated' : ''}`}
          style={{ marginBottom: 12, cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none', opacity: disabled ? 0.62 : 1, ...style }}
          onClick={handleOpen}
        >
          <div
            className="floating-input"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              color: value ? 'var(--label-primary)' : 'transparent',
              ...inputStyle 
            }}
          >
            {displayValue || 'Select Date'}
          </div>
          <label className="floating-label">
            {label}
          </label>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.62 : 1, ...style }} onClick={handleOpen}>
          <span style={{ width: 85, fontSize: 17, color: 'var(--label-primary)', fontWeight: 400, flexShrink: 0 }}>
            {label}
          </span>
          <div
            style={{
              flex: 1,
              fontSize: 17,
              color: value ? 'var(--label-primary)' : 'var(--label-tertiary)',
              ...inputStyle
            }}
          >
            {displayValue || placeholderLabel()}
          </div>
        </div>
      )}

      {isOpen && (
        <>
          <div
            className="ios-modal-backdrop"
            onClick={() => setIsOpen(false)}
            style={{
              zIndex: 99998,
              background: 'rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)'
            }}
          />
          <div
            ref={sheetRef}
            className="ios-datepicker-sheet glass"
            style={{
              '--glass-radius': `${GLASS_RADIUS}px`,
              zIndex: 99999
            } as CSSProperties}
          >
            <div className="ios-sheet-handle" style={{ background: 'var(--label-quaternary)', opacity: 0.6 }} />
            <div className="ios-sheet-header" style={{ borderBottom: 'none', padding: '6px 20px 0', background: 'transparent' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 17,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '4px 0'
                }}
              >
                Cancel
              </button>
              <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--label-primary)' }}>Select Date</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDateClick(new Date());
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '4px 0'
                }}
              >
                Today
              </button>
            </div>
            
            <div className="ios-sheet-body" style={{ padding: '10px 16px 24px', background: 'transparent' }}>
              {/* Calendar Card */}
              <div
                className="ios-datepicker-calendar-card"
                style={{
                  borderRadius: 20,
                  padding: '16px',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--label-primary)' }}>
                    {format(currentMonth, 'MMMM yyyy')}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); prevMonth(); }}
                      className="ios-datepicker-nav-btn"
                      aria-label="Previous Month"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); nextMonth(); }}
                      className="ios-datepicker-nav-btn"
                      aria-label="Next Month"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>

                {/* Days of Week */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 12 }}>
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
                    <div key={i} style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--label-tertiary)' }}>
                      {day}
                    </div>
                  ))}
                </div>

                {/* Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px 4px' }}>
                  {days.map((day, i) => {
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    const isDayToday = isToday(day);

                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'center' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDateClick(day); }}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            fontWeight: isSelected ? 600 : 400,
                            cursor: 'pointer',
                            background: isSelected ? 'var(--ios-blue)' : (isDayToday && !isSelected ? 'var(--fill-tertiary)' : 'transparent'),
                            color: isSelected ? '#FFF' : (!isCurrentMonth ? 'var(--label-quaternary)' : (isDayToday ? 'var(--ios-blue)' : 'var(--label-primary)')),
                            border: 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {format(day, 'd')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

  function placeholderLabel() {
    return 'Select Date';
  }
}
