import { describe, it, expect } from 'vitest';
import { parseHoursFromText } from '../scripts/parse-daily-updates.js';

describe('parseHoursFromText', () => {
  it("returns status 'reported' when hours found", () => {
    const result = parseHoursFromText("1. KEYPO engine API (2H)\n2. 讀書會 (1H)");
    expect(result.status).toBe('reported');
    expect(result.total).toBe(3);
  });

  it("returns status 'zero' when total is 0", () => {
    const result = parseHoursFromText("1. 無工作項目 (0H)");
    expect(result.status).toBe('zero');
    expect(result.total).toBe(0);
  });

  it("returns status 'replied_no_hours' when no hours found", () => {
    const result = parseHoursFromText("今天做了很多事情但沒寫工時");
    expect(result.status).toBe('replied_no_hours');
    expect(result.total).toBeNull();
  });
});
