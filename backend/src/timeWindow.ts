// backend/src/timeWindow.ts
// Time window scheduling for compliant calling hours

/**
 * Check if current time is within allowed calling windows.
 * Default windows: 10:00-13:00, 16:00-20:30
 * Blocks Sundays
 * 
 * @param now - Date to check (defaults to current time)
 * @param timezone - Timezone string (defaults to "Asia/Kolkata")
 * @returns true if within calling window, false otherwise
 */
export function isWithinCallingWindow(
  now: Date = new Date(),
  timezone: string = "Asia/Kolkata"
): boolean {
  // Convert to target timezone
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  
  // Get day of week (0 = Sunday, 6 = Saturday)
  const dayOfWeek = localTime.getDay();
  
  // Block Sundays
  if (dayOfWeek === 0) {
    return false;
  }
  
  // Get hours and minutes in local time
  const hours = localTime.getHours();
  const minutes = localTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  
  // Define calling windows in minutes from midnight
  const window1Start = 10 * 60; // 10:00
  const window1End = 13 * 60;    // 13:00
  const window2Start = 16 * 60;  // 16:00
  const window2End = 20 * 60 + 30; // 20:30
  
  // Check if within either window
  const inWindow1 = timeInMinutes >= window1Start && timeInMinutes <= window1End;
  const inWindow2 = timeInMinutes >= window2Start && timeInMinutes <= window2End;
  
  return inWindow1 || inWindow2;
}

/**
 * Get the next valid calling time from a given date.
 * 
 * @param fromDate - Starting date to calculate next valid time from
 * @param timezone - Timezone string (defaults to "Asia/Kolkata")
 * @returns Date object representing next valid calling time
 */
export function getNextValidCallTime(
  fromDate: Date = new Date(),
  timezone: string = "Asia/Kolkata"
): Date {
  // Convert to target timezone
  const localTime = new Date(fromDate.toLocaleString("en-US", { timeZone: timezone }));
  
  // Clone to avoid mutating original
  const nextTime = new Date(localTime);
  
  // Get current time components
  const hours = nextTime.getHours();
  const minutes = nextTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const dayOfWeek = nextTime.getDay();
  
  // Define calling windows
  const window1Start = 10 * 60; // 10:00
  const window1End = 13 * 60;    // 13:00
  const window2Start = 16 * 60;  // 16:00
  const window2End = 20 * 60 + 30; // 20:30
  
  // If it's Sunday, move to Monday 10:00
  if (dayOfWeek === 0) {
    const daysUntilMonday = 1;
    nextTime.setDate(nextTime.getDate() + daysUntilMonday);
    nextTime.setHours(10, 0, 0, 0);
    return nextTime;
  }
  
  // Check if we're before first window today
  if (timeInMinutes < window1Start) {
    nextTime.setHours(10, 0, 0, 0);
    return nextTime;
  }
  
  // Check if we're in first window but can still call
  if (timeInMinutes >= window1Start && timeInMinutes < window1End) {
    // Still in window, return current time
    return nextTime;
  }
  
  // Check if we're between windows (13:00-16:00)
  if (timeInMinutes >= window1End && timeInMinutes < window2Start) {
    nextTime.setHours(16, 0, 0, 0);
    return nextTime;
  }
  
  // Check if we're in second window
  if (timeInMinutes >= window2Start && timeInMinutes < window2End) {
    // Still in window, return current time
    return nextTime;
  }
  
  // We're after second window (after 20:30)
  // Move to next day, first window
  nextTime.setDate(nextTime.getDate() + 1);
  
  // If next day is Sunday, skip to Monday
  if (nextTime.getDay() === 0) {
    nextTime.setDate(nextTime.getDate() + 1);
  }
  
  nextTime.setHours(10, 0, 0, 0);
  return nextTime;
}

/**
 * Format next valid call time for display.
 */
export function formatNextCallTime(nextTime: Date, timezone: string = "Asia/Kolkata"): string {
  const localTime = new Date(nextTime.toLocaleString("en-US", { timeZone: timezone }));
  return localTime.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Check if current time is within batch calling window (10:30 AM - 7:30 PM IST).
 * Used for batch operations to ensure compliance with calling hours.
 * 
 * @param now - Date to check (defaults to current time)
 * @param timezone - Timezone string (defaults to "Asia/Kolkata")
 * @param startHour - Start hour (defaults to 10, from env CALL_START_HOUR)
 * @param startMinute - Start minute (defaults to 30, from env CALL_START_MINUTE)
 * @param endHour - End hour (defaults to 19, from env CALL_END_HOUR)
 * @param endMinute - End minute (defaults to 30, from env CALL_END_MINUTE)
 * @returns true if within batch calling window, false otherwise
 */
export function isWithinBatchCallWindow(
  now: Date = new Date(),
  timezone: string = "Asia/Kolkata",
  startHour: number = parseInt(process.env.CALL_START_HOUR || "10", 10),
  startMinute: number = parseInt(process.env.CALL_START_MINUTE || "30", 10),
  endHour: number = parseInt(process.env.CALL_END_HOUR || "19", 10),
  endMinute: number = parseInt(process.env.CALL_END_MINUTE || "30", 10)
): boolean {
  // Convert to target timezone
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  
  // Get hours and minutes in local time
  const hours = localTime.getHours();
  const minutes = localTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  
  // Define batch calling window in minutes from midnight
  const windowStart = startHour * 60 + startMinute;
  const windowEnd = endHour * 60 + endMinute;
  
  // Check if within window
  return timeInMinutes >= windowStart && timeInMinutes <= windowEnd;
}

/**
 * Parse HH:mm time string to hours and minutes
 * @param timeStr - Time string in HH:mm format (e.g., "10:00", "19:30")
 * @returns Object with hour and minute, or null if invalid
 */
function parseTimeString(timeStr: string | undefined): { hour: number; minute: number } | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

/**
 * Check if current time is within call window.
 * Uses CALL_WINDOW_START and CALL_WINDOW_END env vars (HH:mm format, IST).
 * Falls back to 10:00-19:00 if env vars not set.
 * 
 * @param now - Date to check (defaults to current time)
 * @param timezone - Timezone string (defaults to "Asia/Kolkata")
 * @returns true if within call window, false otherwise
 */
export function isWithinCallWindow(
  now: Date = new Date(),
  timezone: string = "Asia/Kolkata"
): boolean {
  // Parse window times from environment variables (HH:mm format)
  const windowStartStr = process.env.CALL_WINDOW_START;
  const windowEndStr = process.env.CALL_WINDOW_END;
  
  let windowStart: number;
  let windowEnd: number;
  
  const parsedStart = parseTimeString(windowStartStr);
  const parsedEnd = parseTimeString(windowEndStr);
  
  if (parsedStart && parsedEnd) {
    // Use env vars if both are valid
    windowStart = parsedStart.hour * 60 + parsedStart.minute;
    windowEnd = parsedEnd.hour * 60 + parsedEnd.minute;
  } else {
    // Fallback to defaults (10:00 - 19:00)
    windowStart = 10 * 60; // 10:00
    windowEnd = 19 * 60; // 19:00 (7:00 PM)
  }
  
  // Convert to target timezone
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  
  // Get hours and minutes in local time
  const hours = localTime.getHours();
  const minutes = localTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  
  // Check if within window
  return timeInMinutes >= windowStart && timeInMinutes <= windowEnd;
}
