// Robot de licitaciones: revisa compras estatales (ARCE) y arma licitaciones.json
// con los llamados que piden los estudios que hace la clínica. Corre solo, en
// GitHub Actions, dos veces por día. No necesita nada instalado: Node 20 alcanza.
//
// Uso: node robot/licitaciones.mjs [salida.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SALIDA = process.argv[2] ?? join(AQUI, 'licitaciones.json')
const BASE = 'https://www.comprasestatales.gub.uy'
const CONFIG = JSON.parse(readFileSync(join(AQUI, 'codigos.json'), 'utf8'))
const DIAS_QUE_SE_GUARDAN = 120 // después de cerrada la recepción de ofertas
const PAGINAS_POR_CODIGO = 1 // 10 llamados por página, de más nuevo a más viejo
const PAGINAS_VIGENTES = 8 // los 80 llamados vigentes más nuevos de todo el Estado, para buscar por palabra

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
// Hora de Uruguay (UTC-3), corra donde corra el robot: GitHub está en UTC.
const ahoraUy = () => new Date(Date.now() - 3 * 3600000)
const hoy = () => ahoraUy().toISOString().slice(0, 10)

async function bajar(url) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (robot de licitaciones de la clínica)' } })
      if (r.ok) return await r.text()
      console.error(`  ${r.status} en ${url}`)
    } catch (e) {
      console.error(`  falló ${url}: ${e.message}`)
    }
    await dormir(2000 * intento)
  }
  return ''
}

const limpiar = (t) =>
  t.replace(/&sol;/g, '/').replace(/&nbsp;/g, ' ').replace(/&oacute;/g, 'ó').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** '11/09/2026 11:00hs' → '2026-09-11T11:00' */
function fechaIso(texto) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(texto ?? '')
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}${m[4] ? `T${m[4]}:${m[5]}` : ''}`
}

/** Saca los llamados de una página de resultados del buscador. */
function parsearLista(html) {
  const items = []
  const bloques = html.split('<div class="row item">').slice(1)
  for (const b of bloques) {
    const link = /href="(\/consultas\/detalle\/mostrar-llamado\/\d+\/id\/(\d+))"/.exec(b)
    if (!link) continue
    const titulo = /<h3><a[^>]*>([\s\S]*?)<\/a><\/h3>/.exec(b)
    const organismo = /<span class="text-muted">([^<]*\|[^<]*)<\/span>/.exec(b)
    const objeto = /<p class="buy-object">([\s\S]*?)<\/p>/.exec(b)
    const recepcion = /Recepci&oacute;n de ofertas hasta:(?:<\/span>)?(?:&nbsp;|\s)*<strong>([^<]*)<\/strong>/.exec(b)
    const publicado = /Publicado:(?:&nbsp;)?\s*([^<]*)<\/span>/.exec(b)
    const estado = /<div class="col-md-3 text-right">([^<]*)<\/div>/.exec(b)
    const tituloLimpio = limpiar((titulo?.[1] ?? '').split('<span')[0])
    const [org, unidad] = limpiar(organismo?.[1] ?? '').split('|').map((x) => x.trim())
    items.push({
      id: link[2],
      url: BASE + link[1],
      titulo: tituloLimpio,
      organismo: org ?? '',
      unidad: unidad ?? '',
      objeto: limpiar(objeto?.[1] ?? ''),
      recepcion_hasta: fechaIso(limpiar(recepcion?.[1] ?? '')),
      publicado: fechaIso(limpiar(publicado?.[1] ?? '')),
      estado: limpiar(estado?.[1] ?? ''),
      apertura_electronica: /Apertura electr/.test(b),
    })
  }
  return items
}

const normal = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

async function main() {
  const previo = existsSync(SALIDA) ? JSON.parse(readFileSync(SALIDA, 'utf8')) : { llamados: [] }
  const porId = new Map(previo.llamados.map((l) => [l.id, l]))
  const encontrados = new Map()
  const anotar = (item, motivo) => {
    const e = encontrados.get(item.id) ?? { ...item, motivos: [] }
    if (!e.motivos.includes(motivo)) e.motivos.push(motivo)
    encontrados.set(item.id, e)
  }

  // 1. Por código de artículo: los llamados más nuevos que piden ese estudio.
  const codigos = Object.entries(CONFIG.codigos)
  console.log(`Revisando ${codigos.length} códigos de artículo…`)
  for (const [codigo, nombre] of codigos) {
    for (let p = 1; p <= PAGINAS_POR_CODIGO; p++) {
      const url = `${BASE}/consultas/buscar/tipo-pub/LLA/filtro-cat/ART/cod-articulo/${codigo}/tipo-orden/DESC${p > 1 ? `/page/${p}` : ''}`
      const html = await bajar(url)
      const items = parsearLista(html)
      for (const it of items) anotar(it, `${nombre} (${codigo})`)
      if (items.length < 10) break
      await dormir(300)
    }
    await dormir(300)
  }

  // 2. Por palabra, entre los llamados vigentes más nuevos de todo el Estado.
  const palabras = (CONFIG.palabras ?? []).map(normal)
  console.log(`Buscando ${palabras.length} palabras en los llamados vigentes…`)
  for (let p = 1; p <= PAGINAS_VIGENTES; p++) {
    const html = await bajar(`${BASE}/consultas/buscar/tipo-pub/VIG/tipo-orden/DESC${p > 1 ? `/page/${p}` : ''}`)
    const items = parsearLista(html)
    for (const it of items) {
      const texto = normal(`${it.objeto} ${it.titulo}`)
      const pega = palabras.find((w) => texto.includes(w))
      if (pega) anotar(it, `menciona «${pega}»`)
    }
    if (items.length < 10) break
    await dormir(300)
  }

  // 3. Se juntan con lo que ya había: lo nuevo lleva la fecha en que se vio.
  const dia = hoy()
  let nuevos = 0
  for (const [id, it] of encontrados) {
    const viejo = porId.get(id)
    if (!viejo) nuevos++
    porId.set(id, { ...viejo, ...it, visto_en: viejo?.visto_en ?? dia, motivos: [...new Set([...(viejo?.motivos ?? []), ...it.motivos])] })
  }
  // Lo cerrado hace mucho se deja de guardar.
  const limite = new Date(Date.now() - DIAS_QUE_SE_GUARDAN * 86400000).toISOString().slice(0, 10)
  const llamados = [...porId.values()]
    .filter((l) => !l.recepcion_hasta || l.recepcion_hasta.slice(0, 10) >= limite)
    .sort((a, b) => (b.publicado ?? '').localeCompare(a.publicado ?? ''))

  const vigentes = llamados.filter((l) => l.recepcion_hasta && l.recepcion_hasta.slice(0, 10) >= dia).length
  writeFileSync(SALIDA, JSON.stringify({ actualizado: new Date().toISOString(), vigentes, llamados }, null, 2))
  // Los nuevos que todavía se pueden ofertar van aparte: con eso se mandan los avisos.
  const ahora = ahoraUy().toISOString().slice(0, 16)
  const avisar = [...encontrados.values()].filter((it) => !previo.llamados.some((l) => l.id === it.id) && it.recepcion_hasta && it.recepcion_hasta >= ahora)
  writeFileSync(join(dirname(SALIDA), 'nuevos.json'), JSON.stringify(avisar, null, 2))
  console.log(`Listo: ${llamados.length} llamados guardados, ${vigentes} vigentes, ${nuevos} nuevos, ${avisar.length} para avisar. → ${SALIDA}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
