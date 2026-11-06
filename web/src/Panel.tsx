import { useEffect, useState } from 'react'
import { supabase, mensajeError, leerTodo, dinero } from './supabase'
import { porCategoria } from './Comparar'

// Panel gerencial: lee la vista panel_empresa (una fila por empresa visible; los cálculos están en la base).
type Fila = {
  empresa_id: string
  nombre: string
  moneda_reporte: string
  presupuesto: number
  comprometido: number
  ejecutado: number
  pagado: number
  disponible: number
  ahorro: number
  exceso: number
  sin_partida: number
  telecom_rd: number
  telecom_us: number
  flotas_mensual: number
  flotas_lineas: number
  software_vencen_60: number
  personal_fuera_hoy: number
  garantias_vencen_60: number
  reposiciones_pendientes: number
}

const pct = (a: number, b: number) => (Number(b) > 0 ? `${((Number(a) / Number(b)) * 100).toFixed(1)} %` : '—')

export default function Panel({ empresa, personal }: { empresa: string; personal: boolean }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [categorias, setCategorias] = useState<[string, { presupuesto: number; ejecutado: number }][]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('panel_empresa').select('*').order('nombre').then(async ({ data, error }) => {
      if (error) setError(await mensajeError(error))
      else setFilas((data ?? []) as Fila[])
    })
    // Ejecución por categoría de la versión vigente (la gráfica de barras).
    supabase.from('presupuestos_versiones').select('id').eq('empresa_id', empresa).eq('estado', 'Vigente').eq('activo', true).maybeSingle()
      .then(async ({ data: v }) => {
        if (!v) { setCategorias([]); return }
        const { data } = await leerTodo<{ version_id: string; categoria: string; presupuesto: number; ejecutado: number }>((d, h) =>
          supabase.from('saldo_partidas').select('version_id, categoria, presupuesto, ejecutado').eq('version_id', v.id).order('partida_id').range(d, h))
        setCategorias(Object.entries(porCategoria(data, v.id)).sort(([, x], [, y]) => y.presupuesto - x.presupuesto))
      })
  }, [empresa])

  const f = filas.find((x) => x.empresa_id === empresa)
  if (error) return <p className="error" role="alert">{error}</p>
  if (!f) return null
  const m = f.moneda_reporte

  const tarjetas: { titulo: string; valor: string; nota?: string; alerta?: boolean; ahorro?: boolean }[] = [
    { titulo: 'Presupuesto vigente', valor: `${m} ${dinero(f.presupuesto)}` },
    { titulo: 'Ejecutado', valor: `${m} ${dinero(f.ejecutado)}`, nota: `${pct(f.ejecutado, f.presupuesto)} del presupuesto · pagado ${dinero(f.pagado)}` },
    { titulo: 'Comprometido', valor: `${m} ${dinero(f.comprometido)}` },
    { titulo: 'Disponible', valor: `${m} ${dinero(f.disponible)}`, alerta: Number(f.disponible) < 0 },
    { titulo: 'Ahorro en partidas', valor: `${m} ${dinero(f.ahorro)}`, nota: 'Saldo de las partidas por debajo de su presupuesto', ahorro: true },
    { titulo: 'Fuera de presupuesto', valor: `${m} ${dinero(Number(f.exceso) + Number(f.sin_partida))}`, nota: `Excesos ${dinero(f.exceso)} · sin partida ${dinero(f.sin_partida)}`, alerta: Number(f.exceso) + Number(f.sin_partida) > 0 },
    { titulo: 'Telecomunicaciones / mes', valor: `RD$ ${dinero(f.telecom_rd)}`, nota: Number(f.telecom_us) ? `y US$ ${dinero(f.telecom_us)}` : undefined },
    { titulo: 'Flotas / mes', valor: `RD$ ${dinero(f.flotas_mensual)}`, nota: `${f.flotas_lineas} ${Number(f.flotas_lineas) === 1 ? 'línea activa' : 'líneas activas'}` },
    { titulo: 'Software vencido o por vencer', valor: String(f.software_vencen_60), nota: 'Vencido o vence en 60 días', alerta: f.software_vencen_60 > 0 },
    { titulo: 'Garantías por vencer', valor: String(f.garantias_vencen_60), nota: 'Activos en los próximos 60 días', alerta: f.garantias_vencen_60 > 0 },
    { titulo: 'Reposiciones pendientes', valor: String(f.reposiciones_pendientes), nota: 'Propuestas o presupuestadas' },
    ...(personal ? [{ titulo: 'Personal fuera hoy', valor: String(f.personal_fuera_hoy) }] : []),
  ]

  // Consolidado por moneda de reporte: no se suman empresas que reportan en monedas distintas.
  const monedas = [...new Set(filas.map((x) => x.moneda_reporte))]
  const suma = (mon: string, k: keyof Fila) => filas.filter((x) => x.moneda_reporte === mon).reduce((s, x) => s + Number(x[k]), 0)

  return (
    <>
      <div className="indicadores">
        {tarjetas.map((t) => (
          <div key={t.titulo} className={`tarjeta indicador${t.alerta ? ' alerta' : ''}${t.ahorro ? ' ahorro' : ''}`}>
            <span className="nota">{t.titulo}</span>
            <strong>{t.valor}</strong>
            {t.nota && <span className="nota">{t.nota}</span>}
          </div>
        ))}
      </div>

      {categorias.length > 0 && (
        <div className="tarjeta">
          <h3 style={{ margin: 0 }}>Ejecución por categoría · versión vigente</h3>
          <p className="nota" style={{ margin: 0 }}>Barra: presupuesto de la categoría; relleno: lo ejecutado ({m}). En rojo, lo que supera el presupuesto.</p>
          <div className="barras">
            {categorias.map(([cat, t]) => {
              const max = categorias[0][1].presupuesto || 1
              const uso = t.presupuesto ? Math.min(t.ejecutado / t.presupuesto, 1) : 1
              const exceso = t.ejecutado > t.presupuesto
              return (
                <div key={cat} className="barra">
                  <span>{cat}</span>
                  <div className="pista" style={{ width: `${Math.max((t.presupuesto / max) * 100, 4)}%` }} role="img"
                    aria-label={`${cat}: ejecutado ${dinero(t.ejecutado)} de ${dinero(t.presupuesto)}`}>
                    <div className={exceso ? 'relleno exceso' : 'relleno'} style={{ width: `${uso * 100}%` }} />
                  </div>
                  <span className="mono nota">{dinero(t.ejecutado)} / {dinero(t.presupuesto)} · {pct(t.ejecutado, t.presupuesto)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {filas.length > 1 && (
        <>
          <h3>Consolidado</h3>
          <div className="desplazable">
            <table>
              <thead>
                <tr><th>Empresa</th><th>Moneda</th><th>Presupuesto</th><th>Ejecutado</th><th>% ejecutado</th><th>Disponible</th><th>Ahorro</th><th>Fuera de presupuesto</th></tr>
              </thead>
              <tbody>
                {filas.map((x) => (
                  <tr key={x.empresa_id} className={x.empresa_id === empresa ? 'seleccionado' : ''}>
                    <td>{x.nombre}</td>
                    <td>{x.moneda_reporte}</td>
                    <td className="num">{dinero(x.presupuesto)}</td>
                    <td className="num">{dinero(x.ejecutado)}</td>
                    <td className="num">{pct(x.ejecutado, x.presupuesto)}</td>
                    <td className={`num${Number(x.disponible) < 0 ? ' negativo' : ''}`}>{dinero(x.disponible)}</td>
                    <td className="num">{dinero(x.ahorro)}</td>
                    <td className="num">{dinero(Number(x.exceso) + Number(x.sin_partida))}</td>
                  </tr>
                ))}
                {monedas.map((mon) => (
                  <tr key={mon} className="total">
                    <td>Total</td>
                    <td>{mon}</td>
                    <td className="num">{dinero(suma(mon, 'presupuesto'))}</td>
                    <td className="num">{dinero(suma(mon, 'ejecutado'))}</td>
                    <td className="num">{pct(suma(mon, 'ejecutado'), suma(mon, 'presupuesto'))}</td>
                    <td className="num">{dinero(suma(mon, 'disponible'))}</td>
                    <td className="num">{dinero(suma(mon, 'ahorro'))}</td>
                    <td className="num">{dinero(suma(mon, 'exceso') + suma(mon, 'sin_partida'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
