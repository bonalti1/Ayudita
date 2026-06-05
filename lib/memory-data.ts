export type MemoryStatus = "ready" | "review" | "processing";

export type MemoryItem = {
  id: string;
  title: string;
  meta: string;
  type: MemoryStatus;
  icon: "doc" | "health" | "person" | "bill" | "voice";
  tone: "green" | "red" | "blue";
  status: string;
  summary: string;
  fields: Array<[string, string]>;
};

export const memoryItems: MemoryItem[] = [
  {
    id: "insurance",
    title: "Tarjeta de seguro GEICO",
    meta: "WhatsApp · PDF · documento",
    type: "ready",
    icon: "doc",
    tone: "green",
    status: "Listo",
    summary:
      "Ayudita encontró la póliza, el vehículo y la fecha de vencimiento. También creó un recordatorio antes de la renovación.",
    fields: [
      ["Proveedor", "GEICO"],
      ["Póliza", "•••• 1934"],
      ["Vehículo", "Honda CR-V"],
      ["Vence", "Mar 14, 2027"],
      ["Recordatorio", "Feb 14, 2027"]
    ]
  },
  {
    id: "lab",
    title: "Resultados de laboratorio",
    meta: "Web · imagen · salud",
    type: "review",
    icon: "health",
    tone: "red",
    status: "Revisar",
    summary:
      "Ayudita resumió los resultados, pero necesita confirmar el nombre del laboratorio y la fecha antes de guardarlo en Salud.",
    fields: [
      ["Categoría", "Salud"],
      ["Paciente", "Maria Pena"],
      ["Fecha detectada", "Mayo 28, 2026"],
      ["Laboratorio", "No confirmado"],
      ["Estado", "Necesita revisión"]
    ]
  },
  {
    id: "birthday",
    title: "Cumpleaños de mamá",
    meta: "WhatsApp · texto · familia",
    type: "ready",
    icon: "person",
    tone: "green",
    status: "Listo",
    summary:
      "Ayudita guardó el cumpleaños de tu mamá y creó un recordatorio anual una semana antes.",
    fields: [
      ["Persona", "Mamá"],
      ["Fecha", "Octubre 12"],
      ["Repite", "Cada año"],
      ["Recordatorio", "Octubre 5"],
      ["Origen", "WhatsApp"]
    ]
  },
  {
    id: "water",
    title: "Cuenta de agua",
    meta: "WhatsApp · screenshot · cuenta",
    type: "review",
    icon: "bill",
    tone: "red",
    status: "Revisar",
    summary:
      "Ayudita encontró dos fechas posibles en la cuenta. Confirma la fecha correcta para crear el recordatorio.",
    fields: [
      ["Proveedor", "City Utilities"],
      ["Monto", "$84.20"],
      ["Fecha 1", "Jun 12, 2026"],
      ["Fecha 2", "Jun 15, 2026"],
      ["Confianza", "72%"]
    ]
  },
  {
    id: "voice",
    title: "Nota de voz: cita de Sofia",
    meta: "WhatsApp · audio · procesando",
    type: "processing",
    icon: "voice",
    tone: "blue",
    status: "Procesando",
    summary:
      "Ayudita está transcribiendo la nota de voz para detectar fecha, doctora y posibles recordatorios.",
    fields: [
      ["Entrada", "Audio de WhatsApp"],
      ["Estado", "Transcribiendo"],
      ["Duración", "0:42"],
      ["Categoría sugerida", "Salud"],
      ["Próximo paso", "Extraer datos"]
    ]
  }
];

export function statusClass(type: MemoryStatus) {
  if (type === "ready") return "ready";
  if (type === "review") return "review";
  return "processing";
}
