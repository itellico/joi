// Birthday checker — creates Things3 tasks for upcoming birthdays
// Runs as a system_event cron job (daily at 8 AM)

import { query } from "../db/client.js";
import { getActiveTasks, createTask } from "../things/client.js";
import type { JoiConfig } from "../config/schema.js";

interface BirthdayContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  birthday: string; // ISO date string
}

export async function checkBirthdays(_config: JoiConfig): Promise<void> {
  // Find contacts with birthdays in the next 3 days (handles month/year boundaries)
  const result = await query<BirthdayContact>(
    `SELECT id, first_name, last_name, birthday::text FROM contacts
     WHERE birthday IS NOT NULL
       AND (EXTRACT(month FROM birthday)::int, EXTRACT(day FROM birthday)::int) IN (
         SELECT EXTRACT(month FROM d)::int, EXTRACT(day FROM d)::int
         FROM generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days', INTERVAL '1 day') AS d
       )`,
  );

  if (result.rows.length === 0) {
    console.log("[Birthdays] No upcoming birthdays in the next 3 days");
    return;
  }

  // Load active Things tasks to dedup
  const activeTasks = getActiveTasks();
  const birthdayTaskTitles = new Set(
    activeTasks
      .filter((t) => t.title.includes("Birthday"))
      .map((t) => t.title),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let created = 0;
  for (const contact of result.rows) {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unknown";

    // Check if a birthday task already exists for this contact
    if (birthdayTaskTitles.has(`Birthday: ${name}`)) continue;
    // Also check partial matches (in case format varies)
    const alreadyExists = [...birthdayTaskTitles].some(
      (t) => t.includes("Birthday") && t.includes(name),
    );
    if (alreadyExists) continue;

    // Determine when the birthday is this year (or next year for Dec→Jan boundary)
    const bday = new Date(contact.birthday);
    let thisYearBday = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
    if (thisYearBday < today) {
      thisYearBday = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
    }
    const diffDays = Math.round((thisYearBday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const formatted = thisYearBday.toLocaleDateString("de-AT", { day: "numeric", month: "long" });
    const title = `Birthday: ${name}`;
    const isToday = diffDays === 0;

    await createTask(title, {
      list: isToday ? "today" : "upcoming",
      when: isToday ? "today" : thisYearBday.toISOString().slice(0, 10),
      tags: ["birthday", "radar"],
      notes: `${name}'s birthday on ${formatted}`,
    });

    created++;
    console.log(`[Birthdays] Created task: ${title} (${formatted})`);
  }

  console.log(`[Birthdays] Done — ${created} task(s) created, ${result.rows.length} birthday(s) found`);
}
