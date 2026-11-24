# SITMAP · Observatorio Telecom GT

Mapa y tablero de telefonía e internet por municipio para la **Superintendencia de Telecomunicaciones (SIT) de Guatemala**, construido en el Datatón InnovaCon 2026.

**Pregunta de decisión:** la SIT necesita saber la calidad del servicio de telefonía e internet para decidir qué y dónde auditar en el territorio nacional, en tiempo real.

**Ver en línea:** https://lemus-code.github.io/SITMAP/

## Qué hace

La app tiene tres modos, cada uno con vista **Mapa** y **Tablero**:

| Modo | Datos | Qué muestra |
| --- | --- | --- |
| **Actual** | Reales | IDM (Índice de Desarrollo por Municipio) de 2014 a 2026 con línea de tiempo; antenas por habitante, líneas fijas, operadores; capas de celdas observadas (OpenCelliD) y lugares poblados. |
| **Escuelas** | Reales | Cobertura móvil observada en 31,642 escuelas (Giga): cubiertas por 4G, 3G o solo 2G, en el borde, sin cobertura observada; escuelas con potencial y sitios candidatos. |
| **Próximamente** | **Simulados** | Las 21 métricas que la SIT debería solicitar a los operadores y los análisis que habilitarían (saturación, latencia, fallas, perfil de consumo, duplicidad). Todo marcado como simulado. |

## Correr en local

```bash
python -m http.server 8766
```

Luego abrir http://localhost:8766/mapa/ (la app carga sus datos con `fetch`, así que no funciona abriendo el HTML como archivo).

## Estructura

```
mapa/                 la app web (HTML, CSS, JS) y sus datos en mapa/data/
scripts/              extracción y procesamiento reproducibles (Python)
datos/                Excel base, catálogo de municipios, alias y tablas intermedias por semestre
```

### Scripts

| Script | Qué hace |
| --- | --- |
| `extraer_boletin.py` | Extrae de cada Boletín Estadístico de la SIT (PDF) las líneas fijas y radiobases por municipio y las tablas nacionales. |
| `armar_excel.py` | Arma `datos/SIT_telefonia_base.xlsx`; incluye un semestre solo si sus totales cuadran con el boletín. |
| `exportar_dashboard.py` | Exporta del Excel los JSON que usa la app. |
| `construir_limites.py` | Límites municipales y lugares poblados desde los KMZ oficiales. |
| `procesar_opencellid.py` | Celdas observadas de OpenCelliD (MCC 704) asignadas a municipios. |
| `escuelas_cobertura.py` | Clasifica la cobertura observada de cada escuela y propone sitios candidatos. |
| `simular_proximamente.py` | Genera los **datos simulados** del modo Próximamente (semilla fija, supuestos documentados). |

Requiere Python 3 con `pymupdf`, `openpyxl` y `shapely`.

### Fuentes crudas (no incluidas en el repositorio)

Para regenerar todo hay que descargarlas y ubicarlas así:

- `fuentes/SIT/boletines/` · Boletines Estadísticos de Telefonía 2014–2026: https://sit.gob.gt/estadisticas-de-telefonia.html
- `KMZ/` · KMZ de municipios y de lugares poblados 2026.
- `fuentes/opencellid/704.csv.gz` · exportación de Guatemala de OpenCelliD (requiere cuenta gratuita): https://opencellid.org/downloads.php
- `escuelas/` · reporte de escuelas de Guatemala de Giga: https://giga.global
- `piloto-dashboard/data.js` · límites del piloto, usados solo para los 7 municipios creados después de la cartografía del KMZ.

## Limitaciones

- Los boletines miden infraestructura (líneas, radiobases), no calidad (velocidad, latencia, caídas).
- La SIT cambió varias veces la forma de contar radiobases: la serie nacional tiene saltos.
- OpenCelliD tiene muchas más mediciones en ciudades: "sin cobertura observada" no prueba ausencia de señal.
- Población: proyección 2024 para todos los semestres.
- El modo **Próximamente** usa datos **simulados**; no describen la red real.

## Fuentes y licencias

- Boletines Estadísticos de Telefonía, Superintendencia de Telecomunicaciones de Guatemala.
- Celdas: **OpenCelliD**, licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Los archivos derivados de OpenCelliD en `mapa/data/` (`celdas_*`, `escuelas*`, `sim_*`) se comparten bajo la misma licencia.
- Escuelas: **Giga** (UNICEF/UIT); consultar sus términos de uso.
- Límites municipales y lugares poblados: KMZ oficiales.
