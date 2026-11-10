import type { CSSProperties, ReactNode } from 'react'

// Piezas comunes de las pantallas reconstruidas desde design/*.dc.html (Telecom, Flotas…).

export type Empresa = { id: string; nombre: string; tema: string; moneda_reporte: string }

export const tarjeta: CSSProperties = { background: '#FFFFFF', border: '1px solid var(--borde)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }
export const h2: CSSProperties = { margin: 0, fontSize: 17, fontWeight: 600 }
export const tenue: CSSProperties = { fontSize: 13, color: 'var(--tenue)' }
export const etiqueta: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--tenue)' }
export const control: CSSProperties = { height: 40, border: '1px solid var(--borde)', borderRadius: 8, padding: '0 10px', fontSize: 14, background: '#FFFFFF', color: 'var(--tinta)' }
export const botonBorde: CSSProperties = { height: 40, padding: '0 12px', borderRadius: 8, border: '1px solid var(--borde)', background: '#FFFFFF', color: 'var(--tinta)', fontSize: 13, fontWeight: 500 }
export const botonAcento: CSSProperties = { height: 40, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--acento)', color: '#FFFFFF', fontSize: 13, fontWeight: 600 }
export const pastilla = ([bg, fg]: readonly [string, string]): CSSProperties => ({ fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 999, background: bg, color: fg, whiteSpace: 'nowrap' })
export const RIESGO: [string, string] = ['#FBE9DF', '#8A3A12']
export const miles = (v: number) => (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })
export const entero = (v: number) => Math.round(v).toLocaleString('en-US')

// Cabecera del módulo: ruta, título, subtítulo, Consolidado / empresas y el botón de crear.
export function Cabecera({ modulo, titulo, subtitulo, empresas, co, elegir, ir, crear }: {
  modulo: string
  titulo: string
  subtitulo: ReactNode
  empresas: Empresa[]
  co: string
  elegir: (id: string) => void
  ir: (vista: string) => void
  crear?: { texto: string; onClick: () => void } // ausente si no puede crear o el formulario ya está abierto
}) {
  const todas = co === 'all'
  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={tenue}><button className="enlace" onClick={() => ir('inicio')} style={{ color: 'var(--enlace)', fontSize: 13 }}>Panel gerencial</button> · {modulo} · Ambiente <b>{todas ? 'Consolidado' : empresas.find((e) => e.id === co)?.nombre}</b></span>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em' }}>{titulo}</h1>
          <span style={{ fontSize: 14, color: 'var(--tenue)' }}>{subtitulo}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="Empresa" style={{ display: 'flex', border: '1px solid var(--borde)', borderRadius: 10, overflow: 'hidden', background: '#FFFFFF' }}>
            {[{ id: 'all', nombre: 'Consolidado' }, ...empresas].map((c) => (
              <button key={c.id} onClick={() => elegir(c.id)} aria-pressed={co === c.id}
                style={{ height: 44, padding: '0 18px', border: 'none', borderRadius: 0, fontSize: 14, fontWeight: 600, background: co === c.id ? 'var(--boton-activo)' : '#FFFFFF', color: co === c.id ? '#FFFFFF' : 'var(--tinta)' }}>
                {c.nombre}
              </button>
            ))}
          </div>
          {crear && (
            <button onClick={crear.onClick} disabled={todas} title={todas ? 'Elija una empresa para crear' : undefined}
              style={{ height: 44, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--acento)', color: '#FFFFFF', fontSize: 14, fontWeight: 600 }}>{crear.texto}</button>
          )}
        </div>
      </header>
      {crear && todas && <p className="nota" style={{ margin: '-12px 0 0' }}>Para crear, elija primero la empresa.</p>}
    </>
  )
}

export function Indicadores({ etiqueta: aria, kpis }: { etiqueta: string; kpis: { label: string; value: string; sub: string; color?: string }[] }) {
  return (
    <section aria-label={aria} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
      {kpis.map((k) => (
        <div key={k.label} style={{ background: '#FFFFFF', border: '1px solid var(--borde)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--tenue)', fontWeight: 600 }}>{k.label}</span>
          <span className="mono" style={{ fontSize: 26, fontWeight: 600, color: k.color ?? 'var(--tinta)' }}>{k.value}</span>
          <span style={{ fontSize: 12, color: 'var(--tenue)' }}>{k.sub}</span>
        </div>
      ))}
    </section>
  )
}

export function Mensajes({ msg, error }: { msg: string; error: string }) {
  return (
    <>
      {msg && !error && <p role="status" style={{ margin: 0, padding: '10px 12px', borderRadius: 8, background: 'var(--ahorro-fondo)', color: 'var(--ahorro-tinta)', fontSize: 13 }}>{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  )
}

// Barra horizontal con nombre, cantidad y valor (costo por tipo, por área…).
export function Barra({ nombre, detalle, valor, ancho, onClick }: { nombre: string; detalle: string; valor: string; ancho: number; onClick?: () => void }) {
  const contenido = (
    <>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, width: '100%' }}>
        <span>{nombre} <span style={{ color: 'var(--tenue)' }}>· {detalle}</span></span>
        <span className="mono" style={{ fontWeight: 600 }}>{valor}</span>
      </span>
      <span style={{ display: 'block', width: '100%', height: 10, background: 'var(--pista)', borderRadius: 5, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${ancho}%`, height: '100%', background: 'var(--primario)' }} />
      </span>
    </>
  )
  const estilo: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0', border: 'none', background: 'transparent', color: 'var(--tinta)', textAlign: 'left', width: '100%', fontWeight: 400 }
  return onClick ? <button onClick={onClick} style={estilo}>{contenido}</button> : <div style={estilo}>{contenido}</div>
}

export function Paginador({ total, pagina, porPagina, setPagina }: { total: number; pagina: number; porPagina: number; setPagina: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span className="mono" style={tenue}>{total ? `Mostrando ${pagina * porPagina + 1}–${Math.min(total, (pagina + 1) * porPagina)} de ${total} · página ${pagina + 1} de ${paginas}` : ''}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={botonBorde} disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
        <button style={botonBorde} disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
      </div>
    </div>
  )
}

// Página válida para el total actual (al filtrar, la lista puede encogerse).
export const paginaValida = (pagina: number, total: number, porPagina: number) => Math.min(pagina, Math.max(0, Math.ceil(total / porPagina) - 1))
