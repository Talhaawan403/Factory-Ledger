export interface WebShellMode {
  showSimulatorControls: boolean;
  showSimulatorFrame: boolean;
  isEdgeToEdge: boolean;
}

export function getWebShellMode(
  _isNative?: boolean,
  _isDevelopment?: boolean,
  _isFullscreen?: boolean,
): WebShellMode {
  return {
    showSimulatorControls: false,
    showSimulatorFrame: false,
    isEdgeToEdge: true,
  };
}

