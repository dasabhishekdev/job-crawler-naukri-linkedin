function startOfTodayIst(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${parts}T00:00:00+05:30`);
}

function istParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function istDate(year, month, day, hour, minute = 0) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  return new Date(`${year}-${mm}-${dd}T${hh}:${min}:00+05:30`);
}

const CRON_HOURS = [9, 19];

function nextScheduledRun(now = new Date()) {
  const p = istParts(now);
  for (const hour of CRON_HOURS) {
    const slot = istDate(p.year, p.month, p.day, hour, 0);
    if (slot.getTime() > now.getTime()) return slot;
  }
  const tomorrow = new Date(istDate(p.year, p.month, p.day, 0, 0).getTime() + 24 * 60 * 60 * 1000);
  const t = istParts(tomorrow);
  return istDate(t.year, t.month, t.day, CRON_HOURS[0], 0);
}

function cronExpression() {
  return "0 9,19 * * *";
}

module.exports = {
  startOfTodayIst,
  istParts,
  nextScheduledRun,
  cronExpression,
  CRON_HOURS,
};
