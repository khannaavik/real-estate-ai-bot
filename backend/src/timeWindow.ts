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
