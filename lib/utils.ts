export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function getDateRange(days: number = 7): { from: string; to: string } {
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - days);
  return { from: formatDate(fromDate), to: formatDate(today) };
}

export function formatHours(hours: number): string {
  return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(2)}h`;
}

export function truncateComment(comment: string, maxLength: number = 30): string {
  if (comment.length <= maxLength) return comment;
  return comment.substring(0, maxLength - 3) + "...";
}

export function getDayName(dateStr: string): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[new Date(dateStr).getDay()];
}
