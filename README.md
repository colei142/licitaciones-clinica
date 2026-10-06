# Robot de licitaciones

Revisa el buscador de compras estatales (comprasestatales.gub.uy) y arma `licitaciones.json`
con los llamados que piden los estudios de la clínica. La app lo lee de internet y muestra los
que están abiertos, con cuánto falta para que cierren.

- `codigos.json`: qué códigos de artículo del catálogo de ARCE vigila (EEG, EMG, potenciales
  evocados, polisomnografía…) y qué palabras busca entre los llamados vigentes.
- `licitaciones.mjs`: el robot. Se corre con `node robot/licitaciones.mjs salida.json`. Tarda
  unos 3 minutos porque la página del Estado es lenta y se le pide de a una consulta por vez.
- `github/licitaciones.yml`: la tarea programada de GitHub Actions que lo corre dos veces por día.

## Cómo queda andando solo

1. Un repositorio público en GitHub con `robot/codigos.json`, `robot/licitaciones.mjs` y
   `.github/workflows/licitaciones.yml`.
2. GitHub lo corre a las 9:00 y a las 15:00 (hora de Uruguay) y guarda `licitaciones.json`
   en el repositorio. Es gratis: la tarea usa unos 4 minutos por corrida.
3. La app lee `https://raw.githubusercontent.com/<usuario>/<repositorio>/main/licitaciones.json`
   (se configura en Configuración → Clínica y avisos).

Para probar a mano: `node robot/licitaciones.mjs` y abrir el archivo que deja al lado.
