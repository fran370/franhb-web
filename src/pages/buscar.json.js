import { todasLasEntradas, rutaDe, tituloDe, extractoDe } from '../utils/entradas';
import { TIPOS } from '../consts';

export async function GET() {
  const entradas = await todasLasEntradas();
  const datos = entradas.map((entrada) => ({
    titulo: tituloDe(entrada),
    tipo: TIPOS[entrada.data.tipo].etiqueta,
    ruta: rutaDe(entrada),
    fecha: entrada.data.fecha.toISOString(),
    extracto: extractoDe(entrada),
  }));

  return new Response(JSON.stringify(datos), {
    headers: { 'Content-Type': 'application/json' },
  });
}
