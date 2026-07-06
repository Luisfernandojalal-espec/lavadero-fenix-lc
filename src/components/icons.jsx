// Íconos de línea, sobrios (no emojis). Heredan el color con currentColor.
const paths = {
  mesas: <><path d="M2 8h20" /><path d="M5 8v10M19 8v10" /><path d="M8 8v4h8V8" /></>,
  turno: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2" /><path d="M9 2h6" /></>,
  factura: <><path d="M6 2h9l3 3v17l-2-1-2 1-2-1-2 1-2-1-2 1V2z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  inventario: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  historial: <><rect x="4" y="4" width="16" height="18" rx="2" /><path d="M9 2h6v3H9z" /><path d="M8 10h8M8 14h8M8 18h5" /></>,
  credito: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>,
  gastos: <><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" /><circle cx="17" cy="14" r="1.5" /></>,
  balance: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  config: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
  lavadores: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
}

export function ModIcon({ name, size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  )
}
