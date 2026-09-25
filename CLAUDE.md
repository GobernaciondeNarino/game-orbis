# ORBIS — Instrucciones del proyecto

**Idea original y diseño: Jonnathan Bucheli Galindo.**

Interfaz web 3D del Sistema Solar con control por gestos y voz. Se despliega en
un hosting **Plesk (Apache + PHP)**: sin Node.js en producción, sin procesos en
segundo plano, sin acceso root.

## Idioma

**Todo en español**: comentarios, nombres de variables y funciones, textos de
interfaz, documentación y mensajes de commit. Los nombres de archivo de módulos
que representan clases van en `PascalCase` en inglés solo cuando replican una
API de Three.js (`SceneManager.js`, `CameraRig.js`); el resto, en español.

## Reglas que no se negocian

1. **Sin paso de compilación.** Nada de bundlers, npm en producción,
   TypeScript ni JSX. Módulos ES resueltos por el `importmap` de `index.html`.
2. **Sin CDN de terceros en tiempo de ejecución.** Todo se sirve desde
   `/vendor` y `/assets`. `tools/vendor.mjs` genera esas copias.
3. **Ninguna credencial en el cliente.** Ni en HTML, ni en JS, ni en JSON, ni
   versionada. La clave de ElevenLabs se lee de una variable de entorno o de
   `wj-config.php`. Antes de cada commit: `bash tools/comprobar-secretos.sh`.
4. **Ningún dato astronómico inventado.** Todo sale de `wj-content/data/sistema-solar.json`
   con su campo `fuente`. Lo que falte va a `null` y se muestra como
   `SIN DATOS`. Lo decorativo se etiqueta `SIMULACIÓN`. Nunca `Math.random()`
   presentado como información real.
5. **La cámara y el micrófono son opcionales.** La aplicación debe ser
   completamente usable con ratón y teclado. No se piden permisos al cargar.
6. **Sin `localStorage` ni `sessionStorage`.** El estado de sesión vive en
   memoria (`js/utils/storage.js`).
7. **Un único global: `App`** (`js/core/App.js`). Todo lo demás son módulos ES
   de responsabilidad única.
8. **Liberar recursos de Three.js.** Toda geometría, material y textura creada
   se destruye con `dispose()` al cambiar de vista.
9. **Nunca ejecutar la inferencia de manos dentro del bucle de render.**
10. **Respetar `prefers-reduced-motion`** en cualquier animación nueva.
11. **Contraste AA como mínimo.** `node tools/contraste.mjs` no puede fallar.
    `--texto-decorativo` es la única ficha por debajo del umbral y solo vale
    para elementos ornamentales que no transmiten información.

## Comprobaciones antes de dar por buena una fase

```bash
bash tools/comprobar-secretos.sh           # credenciales en el cliente
node tools/contraste.mjs                   # contraste WCAG 2.1 AA
node tools/pruebas-gestos.mjs              # reconocedor de gestos
node tools/pruebas-guino.mjs               # guiño frente a parpadeo
node tools/pruebas-narracion.mjs           # las tres narraciones de cada cuerpo
php  tools/pruebas-asistente.php           # validación del nombre y frases
node tools/pruebas-preguntas.mjs           # reconocedor de preguntas
node tools/pruebas-datos.mjs               # coherencia del catálogo (masa vs d×V)
node tools/pruebas-sol.mjs                 # flujo del plasma en la superficie
node tools/pruebas-interfaz.mjs            # mandos, espejo de la cámara y hoja de comandos
php  tools/pruebas-horizons.php            # parseo de las tablas de JPL (sin red)
php  tools/pruebas-conversacion.php        # herramientas del asistente (sin red)
php  tools/pruebas-config.php              # claves documentadas, y ninguna filtrada
php  tools/pruebas-admin.php               # panel: lista cerrada, precedencia y cerradura
php  tools/pruebas-limites.php             # cupo por IP y techo diario del sitio
php  tools/pruebas-meteoros.php            # calendario de lluvias de meteoros
node tools/pruebas-voz.mjs                 # parser de intenciones de voz
node tools/csp-hash.mjs --verificar        # hash CSP del importmap al día
find api config -name '*.php' -exec php -l {} \;
php -S localhost:8080                      # y abrir http://localhost:8080
```

Fuera de la lista obligatoria, porque sale a internet y tarda medio minuto:

```bash
php tools/verificar-horizons.php           # contrasta el catálogo con JPL en vivo
php tools/verificar-voz.php                # qué es de verdad la voz configurada
```

## Fichas de diseño

Están en `wj-includes/css/nucleo.css`. Usa siempre las variables, nunca un color literal:
`--cian-brillante`, `--ambar-seleccion`, `--panel-fondo`, `--curva`…

La skill `ui-ux-pro-max` está vendorizada en `.claude/skills/` y debe usarse
para cualquier decisión de diseño de la HUD.

## Grafo de conocimiento del código (Graphify)

La skill `graphify` está en `.claude/skills/graphify/`. Convierte el proyecto en
un grafo consultable en `graphify-out/` (no versionado). La primera vez que se
usa en una sesión instala el CLI sola (`uv tool install graphifyy`).

```bash
graphify update .                      # reconstruye el grafo del código, sin LLM ni coste
graphify query "¿qué lee la narración?"   # subgrafo acotado para una pregunta
graphify path "HUD" "Narrador"            # cómo se conectan dos piezas
graphify explain "SceneManager"           # una pieza y sus vecinas
```

`.graphifyignore` deja fuera el código de terceros: el grafo es de ORBIS.

**No se instalan sus hooks `PreToolUse`** (`graphify claude install`), a
propósito: interceptan cada `Read`, `Grep` y `Bash`, y en un contenedor nuevo,
sin el CLI instalado todavía, cada llamada ejecutaría un comando inexistente
con diez segundos de espera. La skill se invoca con `/graphify` cuando hace
falta, y ya está.

## Estado

Las nueve fases completadas. Queda por comprobar a mano, y no se puede hacer
en este contenedor: la pasada en **Safari y iPad** (el WebKit de Playwright no
arranca aquí) y los **60 fps en hardware real** (aquí solo hay render por
software). Ver el plan de fases en `README.md`.
