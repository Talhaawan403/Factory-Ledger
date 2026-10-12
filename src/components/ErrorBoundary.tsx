import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCw, Download, Copy, Check } from 'lucide-react';
import { exportDatabaseBackupJson } from '../utils/exportSharing';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isExporting: boolean;
  exportDone: boolean;
  exportError: string | null;
  copied: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isExporting: false,
      exportDone: false,
      exportError: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled UI error caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleEmergencyExport = async () => {
    try {
      this.setState({ isExporting: true, exportError: null });
      await exportDatabaseBackupJson();
      this.setState({ exportDone: true });
    } catch (err) {
      console.error('[ErrorBoundary] Emergency export failed:', err);
      this.setState({
        exportError: 'Emergency export failed: ' + (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      this.setState({ isExporting: false });
    }
  };

  handleCopyDetails = () => {
    const { error, errorInfo } = this.state;
    const text = `Error: ${error?.message}\n\nStack:\n${error?.stack}\n\nComponent Stack:\n${errorInfo?.componentStack}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  render() {
    if (this.state.hasError) {
      const { error, isExporting, exportDone, copied } = this.state;
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 20px',
            backgroundColor: '#000000',
            color: '#ffffff',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              backgroundColor: '#1c1c1e',
              border: '1px solid #2c2c2e',
              borderRadius: 20,
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: 'rgba(255, 59, 48, 0.15)',
                color: '#ff3b30',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <AlertOctagon size={30} strokeWidth={2.4} />
            </div>

            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#ffffff' }}>
              Something Went Wrong
            </h1>
            <p style={{ fontSize: 14, color: '#8e8e93', margin: '0 0 20px', lineHeight: 1.4 }}>
              The application encountered an unexpected display issue. Your saved data is safely stored on this device.
            </p>

            {error && (
              <div
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: '#2c2c2e',
                  borderRadius: 10,
                  fontSize: 12,
                  color: '#ff453a',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  wordBreak: 'break-word',
                  marginBottom: 20,
                  maxHeight: 90,
                  overflowY: 'auto',
                }}
              >
                {error.message || 'Unknown runtime error'}
              </div>
            )}

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  width: '100%',
                  height: 48,
                  backgroundColor: '#007aff',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                }}
              >
                <RotateCw size={17} strokeWidth={2.2} />
                <span>Reload Application</span>
              </button>

              <button
                type="button"
                onClick={this.handleEmergencyExport}
                disabled={isExporting}
                style={{
                  width: '100%',
                  height: 48,
                  backgroundColor: exportDone ? '#30d158' : '#3a3a3c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  opacity: isExporting ? 0.7 : 1,
                }}
              >
                <Download size={17} strokeWidth={2.2} />
                <span>
                  {isExporting ? 'Exporting…' : exportDone ? 'Backup Downloaded!' : 'Emergency JSON Export'}
                </span>
              </button>

              {this.state.exportError && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#ff453a',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(255, 69, 58, 0.1)',
                    borderRadius: 8,
                    textAlign: 'left',
                    wordBreak: 'break-word',
                  }}
                >
                  {this.state.exportError}
                </div>
              )}

              <button
                type="button"
                onClick={this.handleCopyDetails}
                style={{
                  width: '100%',
                  height: 40,
                  backgroundColor: 'transparent',
                  color: '#8e8e93',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                {copied ? <Check size={14} color="#30d158" /> : <Copy size={14} />}
                <span>{copied ? 'Copied to Clipboard' : 'Copy Technical Details'}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
