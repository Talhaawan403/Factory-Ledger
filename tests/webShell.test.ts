import { describe, expect, it } from 'vitest';
import { getWebShellMode } from '../src/utils/webShell';

describe('web shell presentation', () => {
  it('opens production web app edge-to-edge without simulator controls or phone mockup', () => {
    expect(getWebShellMode(false, false, true)).toEqual({
      showSimulatorControls: false,
      showSimulatorFrame: false,
      isEdgeToEdge: true,
    });
  });

  it('keeps development mode edge-to-edge without simulator controls or phone mockup', () => {
    expect(getWebShellMode(false, true, false)).toEqual({
      showSimulatorControls: false,
      showSimulatorFrame: false,
      isEdgeToEdge: true,
    });
  });

  it('always treats the native app as edge-to-edge', () => {
    expect(getWebShellMode(true, false, true)).toEqual({
      showSimulatorControls: false,
      showSimulatorFrame: false,
      isEdgeToEdge: true,
    });
  });
});

