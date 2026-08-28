export interface ScheduledTaskPayload {
  title: string;
  estimated_hours: number;
}

export function buildEventPayload(
  evalDate: string,
  startTime: string,
  endTime: string,
  scheduledTasks: ScheduledTaskPayload[],
  timezone: string
) {
  const taskLines = scheduledTasks && scheduledTasks.length > 0
    ? scheduledTasks.map(t => `- ${t.title} (${t.estimated_hours}h)`).join("\n")
    : "- Sin tareas especificadas";

  const summary = `🔨 Taller Carpintería (${startTime} - ${endTime})`;
  const description = `🔨 WORKSHOP OS - Bloque Macro de Trabajo\n\nTareas Agendadas:\n${taskLines}`;

  const startFormatted = startTime.length === 5 ? `${startTime}:00` : startTime;
  const endFormatted = endTime.length === 5 ? `${endTime}:00` : endTime;

  return {
    summary,
    description,
    extendedProperties: {
      private: {
        app: "workshop-os",
        category: "macro_work_block"
      },
      shared: {
        workshop_os_event: "true"
      }
    },
    start: {
      dateTime: `${evalDate}T${startFormatted}`,
      timeZone: timezone
    },
    end: {
      dateTime: `${evalDate}T${endFormatted}`,
      timeZone: timezone
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 60 },
        { method: "popup", minutes: 30 }
      ]
    }
  };
}
