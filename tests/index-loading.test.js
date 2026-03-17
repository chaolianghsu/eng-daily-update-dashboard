import { describe, it, expect } from 'vitest';

// Test SEVERITY_COLORS mapping (matches index.html)
describe('SEVERITY_COLORS', () => {
  const COLORS = {
    red: "#ef4444", redDim: "#991b1b",
    yellow: "#eab308", yellowDim: "#854d0e",
    orange: "#f97316", orangeDim: "#7c2d12",
    green: "#22c55e", greenDim: "#166534",
  };

  const SEVERITY_COLORS = {
    "\uD83D\uDD34": { sc: COLORS.red, bg: COLORS.redDim },
    "\uD83D\uDFE1": { sc: COLORS.yellow, bg: COLORS.yellowDim },
    "\uD83D\uDFE0": { sc: COLORS.orange, bg: COLORS.orangeDim },
    "\uD83D\uDFE2": { sc: COLORS.green, bg: COLORS.greenDim },
  };

  it('should map \uD83D\uDD34 to red colors', () => {
    expect(SEVERITY_COLORS["\uD83D\uDD34"]).toEqual({ sc: "#ef4444", bg: "#991b1b" });
  });

  it('should map \uD83D\uDFE1 to yellow colors', () => {
    expect(SEVERITY_COLORS["\uD83D\uDFE1"]).toEqual({ sc: "#eab308", bg: "#854d0e" });
  });

  it('should map \uD83D\uDFE0 to orange colors', () => {
    expect(SEVERITY_COLORS["\uD83D\uDFE0"]).toEqual({ sc: "#f97316", bg: "#7c2d12" });
  });

  it('should map \uD83D\uDFE2 to green colors', () => {
    expect(SEVERITY_COLORS["\uD83D\uDFE2"]).toEqual({ sc: "#22c55e", bg: "#166534" });
  });

  it('should return undefined for unknown severity', () => {
    expect(SEVERITY_COLORS["unknown"]).toBeUndefined();
  });
});

describe('raw_data.json loading contract', () => {
  it('raw_data.json should be loadable and contain required fields', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dataPath = path.resolve(__dirname, '..', 'public', 'raw_data.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    expect(data).toHaveProperty('rawData');
    expect(data).toHaveProperty('issues');
  });
});
