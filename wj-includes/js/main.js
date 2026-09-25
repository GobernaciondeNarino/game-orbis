/**
 * ORBIS — punto de entrada.
 *
 * Arranca la aplicación: diagnostica el entorno, carga el catálogo, construye
 * la escena tridimensional y pone en marcha el bucle de render.
 *
 * Fases 1 a 9 implementadas: escena tridimensional con órbitas keplerianas
 * reales, HUD en DOM con paneles persistentes, las dos vistas con transición
 * interrumpible, narración con subtítulos, control por gestos y por voz, y un
 * asistente conversacional que responde sin inventarse un dato.
 *
 * Idea original y diseño: Jonnathan Bucheli Galindo.
 */

import { App } from './core/App.js';
import { ejecutarDiagnostico, titularDeFallo } from './core/Diagnostico.js';
import { SceneManager } from './core/SceneManager.js';
import { PostFX } from './core/PostFX.js';
import { CameraRig } from './core/CameraRig.js';
import { Loop, VELOCIDADES } from './core/Loop.js';
import { SolarSystem } from './system/SolarSystem.js';
import { FallbackControls } from './input/FallbackControls.js';
import { HUD } from './ui/HUD.js';
import { Narrator } from './audio/Narrator.js';
import { SFX } from './audio/SFX.js';
import { HandTracking } from './input/HandTracking.js';
import { GestureRecognizer } from './input/GestureRecognizer.js';
import { Bienvenida, pareceNombre } from './ui/Bienvenida.js';
import { Preguntas } from './input/Preguntas.js';
import { EstrellaFugaz } from './ui/EstrellaFugaz.js';
import { ReconocedorGuino, ojosDesdeResultado } from './input/ReconocedorGuino.js';
import { CursorGestual } from './ui/CursorGestual.js';
import { VoiceCommands } from './input/VoiceCommands.js';
import { $, crear, anunciar } from './utils/dom.js';
import { RAIZ, rutaApi, rutaApp, rutaDatos } from './utils/rutas.js';
import { depuracion, log, error } from './utils/debug.js';
import { iniciarAnalitica, medir } from './utils/analitica.js';

const relleno = $('#arranque-relleno');
const detalle = $('#arranque-detalle');
const barra = relleno?.parentElement;

/** Refleja el progreso real de carga en la pantalla de arranque. */
function progresar(fraccion, texto) {
  const porcentaje = Math.round(Math.min(1, Math.max(0, fraccion)) * 100);
  if (relleno) relleno.style.width = `${porcentaje}%`;
  if (barra) barra.setAttribute('aria-valuenow', String(porcentaje));
  if (detalle && texto) detalle.textContent = texto;
}

/**
 * Deja la pantalla de arranque en estado de fallo irrecuperable.
 * El mensaje debe decir qué pasa y qué hacer, nunca un genérico que culpe al
 * navegador de quien visita la página cuando el problema es del despliegue.
 */
function fallar(titular, detalles = []) {
  $('.arranque__marco')?.setAttribute('data-fallo', '');
  progresar(1, titular);

  const aviso = $('.arranque__aviso');
  if (aviso) {
    aviso.innerHTML = '';
    aviso.append(
      crear('strong', { text: 'Cada punto en rojo indica qué falta. ' }),
      'La guía completa está en docs/DESPLIEGUE-PLESK.md, apartado «Resolución de problemas».',
    );
  }

  anunciar(`Error de arranque: ${titular}`);
  error(titular, ...detalles);
}

/**
 * Espera a que terminen de cargar las texturas, informando del progreso REAL
 * del LoadingManager de Three.js. Nunca una barra simulada.
 */
function esperarTexturas(gestor, desde, hasta) {
  return new Promise((resolver) => {
    let pendientes = 0;
    let terminadas = 0;
    let cerrado = false;

    const acabar = () => {
      if (cerrado) return;
      cerrado = true;
      resolver();
    };

    gestor.gestorCarga.onStart = (_, cargadas, total) => {
      pendientes = total;
    };
    gestor.gestorCarga.onProgress = (_, cargadas, total) => {
      pendientes = total;
      terminadas = cargadas;
      progresar(desde + (hasta - desde) * (cargadas / Math.max(1, total)),
        `Cargando texturas… ${cargadas} de ${total}`);
    };
    gestor.gestorCarga.onLoad = acabar;
    gestor.gestorCarga.onError = (url) => {
      error('No se pudo cargar', url);
      // Una textura que falta no debe impedir arrancar: el cuerpo se verá con
      // su color plano, marcado como SIMULACIÓN.
      if (++terminadas >= pendientes) acabar();
    };

    // Red de seguridad: si ninguna textura llega a registrarse (por ejemplo
    // porque todas estaban en caché) el gestor no dispara onLoad.
    setTimeout(() => {
      if (pendientes === 0) acabar();
    }, 60);

    // Tope absoluto: la escena arranca aunque el servidor se atasque.
    setTimeout(acabar, 20000);
  });
}

async function arrancar() {
  log(`ORBIS v${App.version} — fase implementada: ${App.faseImplementada}`);
  log(`Raíz de la aplicación: ${RAIZ}`);
  progresar(0.02, 'Verificando el entorno…');

  const { ok, resultados, fallos } = await ejecutarDiagnostico((f, t) => progresar(f * 0.35, t));

  const catalogo = resultados.datos?.extra ?? null;
  App.definir('datos', catalogo);

  if (!ok) {
    fallar(titularDeFallo(fallos), fallos.map((f) => f.remedio).filter(Boolean));
    return;
  }

  if (!catalogo?.cuerpos?.length) {
    fallar('El catálogo del Sistema Solar está vacío.', [
      'Ejecuta «node tools/construir-datos.mjs» y sube data/sistema-solar.json.',
    ]);
    return;
  }

  // ---------------------------------------------------------------- escena --
  progresar(0.4, 'Construyendo la escena…');

  const gestor = new SceneManager($('#lienzo'), $('#capa-etiquetas'));
  const sistema = new SolarSystem(catalogo, gestor);
  gestor.escena.add(sistema.grupo);

  const efectos = new PostFX(gestor);
  const rig = new CameraRig(gestor);

  gestor.alRedimensionar = (ancho, alto) => efectos.redimensionar(ancho, alto);

  await esperarTexturas(gestor, 0.45, 0.92);
  progresar(0.95, 'Preparando los controles…');

  // -------------------------------------------------------------- controles --
  const orden = sistema.ordenNavegacion;

  /** Selecciona un cuerpo y viaja hasta él. */
  function seleccionar(id, origen = 'programa') {
    const cuerpo = sistema.obtener(id);
    if (!cuerpo) return;

    App.definir('cuerpoActivo', id);
    App.definir('vista', 'cuerpo');
    rig.viajarA(cuerpo);
    // La textura de 2K se pide justo ahora: durante el viaje de cámara, que
    // dura más de un segundo, da tiempo a que llegue sin que se note.
    sistema.mejorarTexturas(id);
    sfx.reproducir('seleccion');
    // La narración arranca al seleccionar, no al llegar: el viaje dura más de
    // un segundo y el silencio mientras tanto se hace largo.
    narrador?.narrar(id);
    anunciar(`${cuerpo.datos.nombre} seleccionado.`);
    App.emitir('cuerpo:seleccionado', { id, origen, cuerpo });
  }

  function vistaGeneral() {
    App.definir('cuerpoActivo', null);
    App.definir('vista', 'sistema');
    rig.volverAVistaGeneral();
    narrador?.detener();
    sfx.reproducir('transicion');
    anunciar('Vista general del Sistema Solar.');
    App.emitir('vista:general', {});
  }

  /**
   * Vista galáctica: aleja la cámara hasta ver el Sistema Solar entero.
   *
   * Pasadas las 700 unidades aparece el disco de la Vía Láctea —lo controla
   * Galaxy.actualizarSegunDistancia—, pero a esa distancia el disco queda a los
   * lados y fuera del encuadre: está centrado a 4.950 unidades, porque el
   * Sistema Solar se sitúa en el brazo de Orión y no en el centro galáctico. A
   * 3.000 el sistema entero cabe compacto en medio y el disco lo rodea, que es
   * el encuadre que se buscaba. Se eligió mirando capturas a 1.500, 3.000,
   * 5.000, 7.000 y 9.000, no a ojo. Los paneles de datos siguen alrededor.
   */
  function vistaGalactica() {
    App.definir('cuerpoActivo', null);
    App.definir('vista', 'galaxia');
    rig.volverAVistaGeneral(3000);
    narrador?.detener();
    sfx.reproducir('transicion');
    anunciar('Vista galáctica. El Sistema Solar completo, con el disco de la Vía Láctea al fondo.');
    App.emitir('vista:galactica', {});
  }

  function vecino(direccion) {
    const actual = App.estado.cuerpoActivo;
    const indice = actual ? orden.indexOf(actual) : -1;
    const siguiente = (indice + direccion + orden.length) % orden.length;
    seleccionar(orden[siguiente], 'teclado');
  }

  function alternarPausa() {
    const v = bucle.alternarPausa();
    anunciar(v.factor === 0 ? 'Tiempo en pausa.' : `Tiempo a ${v.etiqueta}.`);
    App.emitir('tiempo:velocidad', v);
    return v;
  }

  function cambiarVelocidad(direccion) {
    const v = bucle.establecerVelocidad(bucle.indiceVelocidad + direccion);
    anunciar(v.factor === 0 ? 'Tiempo en pausa.' : `Tiempo a ${v.etiqueta}.`);
    App.emitir('tiempo:velocidad', v);
    return v;
  }

  /**
   * Cambia la escala de la escena y reencuadra la cámara: tras el cambio, las
   * distancias son otras y dejar la cámara donde estaba la dejaría dentro de un
   * planeta o a millones de unidades de todo.
   */
  function cambiarEscala(modo) {
    const resultado = sistema.establecerEscala(modo);
    App.preferencias.set('escala', modo);

    const activo = App.estado.cuerpoActivo;
    if (activo) {
      rig.viajarA(sistema.obtener(activo));
    } else {
      // El sistema entero cabe a 300 unidades en didáctico y a nueve millones
      // en real: la vista general tiene que adaptarse.
      rig.volverAVistaGeneral(modo === 'real' ? 9_000_000 : 300);
    }

    anunciar(resultado.aviso);
    App.emitir('escena:escala', resultado);
    return resultado;
  }

  function mostrarOrbitas(visible) {
    App.preferencias.set('mostrarOrbitas', visible);
    sistema.establecerVisibilidadOrbitas(visible);
    anunciar(visible ? 'Órbitas visibles.' : 'Órbitas ocultas.');
  }

  const controles = new FallbackControls(gestor, sistema, {
    alSeleccionar: seleccionar,
    alPedirVistaGeneral: vistaGeneral,
    alPedirVecino: vecino,
    alAlternarPausa: alternarPausa,
    alAlternarOrbitas: () => mostrarOrbitas(!App.preferencias.get('mostrarOrbitas')),
    alPedirAyuda: () => hud.mostrarAyuda(),
    cambiarEscala,
    alAlternarSilencio: () => {
      const silenciada = !App.preferencias.get('narracionSilenciada');
      narrador?.silenciar(silenciada);
      hud.actualizarSilencio(silenciada);
      anunciar(silenciada ? 'Narración silenciada.' : 'Narración activada.');
    },
  });

  // ------------------------------------------------------------------- HUD --
  const sfx = new SFX();

  // El narrador se crea antes que la HUD para poder pasarle sus acciones, pero
  // necesita los subtítulos, que viven en la HUD. Se conecta justo después.
  let narrador = null;

  const hud = new HUD(catalogo, {
    vistaGalactica,
    seleccionar,
    // Pulsar una pregunta del panel de curiosidades es exactamente lo mismo que
    // decirla: entra por el mismo reconocedor y la contesta el mismo servidor.
    // No hay una segunda vía que pudiera responder otra cosa.
    preguntar: (texto) => intentarResponder(texto),
    cambiarNombre: () => abrirBienvenida(),
    conversar: (turnos) => conversar(turnos),
    dictar: () => App.emitir('entrada:solicitar-microfono', {}),
    vistaGeneral,
    vecino,
    alternarPausa,
    cambiarVelocidad,
    mostrarOrbitas,
    // Faltaba, y el interruptor de «Escala real» llevaba desde la fase 2 sin
    // hacer nada: `this.acciones.cambiarEscala` no existía, la casilla se
    // marcaba y el `TypeError` moría en la consola sin que se viera un solo
    // cambio en la escena. El resto de acciones sí estaban; esta se quedó solo
    // en `FallbackControls`, que es quien atiende la tecla, no la casilla.
    cambiarEscala,
    // La HUD necesita la malla del cuerpo para anclar las anotaciones a su
    // superficie; se la pide al sistema en lugar de guardar una referencia.
    obtenerCuerpo3D: (id) => sistema.obtener(id),
    alternarSilencio: () => {
      const silenciada = !App.preferencias.get('narracionSilenciada');
      narrador?.silenciar(silenciada);
      hud.actualizarSilencio(silenciada);
      anunciar(silenciada ? 'Narración silenciada.' : 'Narración activada.');
    },
    establecerVolumen: (v) => narrador?.establecerVolumen(v),
    repetirNarracion: () => narrador?.repetir(),
  }, { capaEtiquetas: $('#capa-etiquetas'), gestor });

  narrador = new Narrator(
    catalogo.cuerpos.filter((c) => c.tipo !== 'cinturon'),
    hud.subtitulos,
    resultados.backend?.extra ?? null,
  );

  // ------------------------------------------------------------- medición --
  // Qué pasa, nunca quién: sin cookies, sin script de Google y con los
  // identificadores solo en memoria (ver utils/analitica.js). Se engancha a los
  // eventos que la aplicación ya emite, para que medir no se meta en la lógica.
  iniciarAnalitica();
  App.al('cuerpo:seleccionado', ({ id }) => medir('ver_cuerpo', { cuerpo: id }));
  App.al('narracion:inicio', ({ id, motor }) => medir('narracion', { cuerpo: id, motor }));
  App.al('voz:activa', ({ motor }) => medir('usar_voz', { motor }));
  App.al('manos:activa', () => medir('usar_gestos'));
  App.al('escena:escala', ({ modo }) => medir('cambiar_escala', { modo }));
  App.al('hud:seccion', ({ id }) => medir('cambiar_seccion', { seccion: id }));

  // ------------------------------------------------------- control por manos --
  // Se construye siempre, pero no toca la cámara hasta que el usuario la
  // enciende explícitamente. Es una capa que se suma a ratón y teclado, nunca
  // un requisito.
  const cursorGestual = new CursorGestual(document.body);
  const reconocedor = new GestureRecognizer();
  const guino = new ReconocedorGuino();

  const manos = new HandTracking({
    video: hud.entradas.video,
    lienzoEsqueleto: hud.entradas.esqueleto,
    alDetectar: (landmarks) => {
      const estado = reconocedor.procesar(landmarks);
      cursorGestual.actualizar(estado);
      for (const accion of estado.acciones) ejecutarGesto(accion);
    },
    // Un guiño sostenido calla la narración, igual que el puño. Es la misma
    // acción por otra vía: quien tiene las manos ocupadas cierra un ojo.
    alMirar: (resultado) => {
      const { disparo } = guino.procesar(ojosDesdeResultado(resultado), performance.now());
      if (disparo) ejecutarGesto({ tipo: 'callar' });
    },
  });

  /**
   * Traduce una acción del reconocedor en una operación sobre la escena.
   *
   * Son tres, y no habrá más: rotar, acercar o alejar, y pasar al cuerpo
   * siguiente. Seleccionar apuntando y volver a la vista general con la palma
   * se retiraron porque se disparaban solos al abrir la mano; para eso están
   * el ratón, el teclado y la voz.
   */
  function ejecutarGesto(accion) {
    switch (accion.tipo) {
      case 'orbitar':
        // El factor convierte fracción de imagen en radianes. La x va invertida
        // porque la cámara refleja: mover la mano a la derecha debe girar la
        // escena hacia la derecha.
        controles.orbitarPor(-accion.dx * 6, accion.dy * 4);
        break;

      case 'zoom':
        controles.acercarPor(1 + accion.delta * 2.5);
        break;

      case 'vecino':
        vecino(accion.direccion);
        break;

      case 'callar':
        // Callar no es silenciar: corta lo que se está diciendo, pero la
        // siguiente narración vuelve a sonar. Silenciar del todo es la M o
        // decir «silencio».
        narrador?.detener();
        anunciar('Narración detenida.');
        break;

      default:
        break;
    }
  }

  App.al('entrada:solicitar-camara', async () => {
    if (manos.activa) {
      manos.desactivar();
      return;
    }
    hud.entradas.mostrarEstado('Pidiendo permiso de cámara…', 'info', 'camara');
    await manos.activar();
  });

  App.al('rostro:no-disponible', ({ mensaje }) => {
    hud.entradas.mostrarEstado(mensaje, 'aviso', 'camara');
  });

  App.al('manos:cargando', ({ paso }) => {
    hud.entradas.mostrarEstado(
      paso === 'modelo'
        ? 'Cargando el modelo de manos (7,6 MB)…'
        : paso === 'rostro'
          ? 'Cargando el modelo de rostro (3,8 MB)…'
          : 'Esperando el permiso de la cámara…',
      'info', 'camara',
    );
  });

  App.al('manos:activa', () => {
    hud.entradas.mostrarEstado('', 'info', 'camara');
    hud.entradas.establecerCamara(true);
    hud.barra.establecerIndicador('camara', 'activo', 'on');
    anunciar('Cámara activada. El vídeo se procesa en tu navegador y no se envía a ningún servidor.');
  });

  App.al('manos:inactiva', () => {
    hud.entradas.establecerCamara(false);
    hud.barra.establecerIndicador('camara', 'inactivo', 'off');
    cursorGestual.ocultar();
    reconocedor.reiniciar();
    anunciar('Cámara apagada.');
  });

  App.al('manos:error', ({ mensaje }) => {
    hud.entradas.mostrarEstado(mensaje, 'error', 'camara');
    hud.entradas.establecerCamara(false);
    hud.barra.establecerIndicador('camara', 'alerta', 'error');
    anunciar(mensaje);
  });

  // -------------------------------------------------------- control por voz --
  let voz = null;
  let preguntas = null;
  try {
    const [vocabulario, vocabularioPreguntas] = await Promise.all([
      (await fetch(rutaDatos('comandos-voz.json'))).json(),
      (await fetch(rutaDatos('preguntas.json'))).json(),
    ]);
    voz = new VoiceCommands(vocabulario, ejecutarIntencion);
    // El parser de intenciones lo crea VoiceCommands; Preguntas lo reutiliza
    // para reconocer los nombres de los cuerpos en lugar de duplicar esa lógica.
    preguntas = new Preguntas(vocabularioPreguntas, catalogo.cuerpos, voz.parser ?? null);
    // La ayuda se construye con el mismo vocabulario que entiende el parser,
    // así que la lista de comandos nunca puede quedar desfasada.
    hud.mostrarAyuda(vocabulario);
    hud.panelAyuda.hidden = true;
    // Las preguntas del panel de curiosidades salen del mismo vocabulario que
    // acaba de entender el reconocedor, no de una lista escrita a mano: así no
    // pueden ofrecerse preguntas que luego no se entiendan.
    hud.curiosidades.establecerVocabulario(preguntas.atributosDisponibles());
  } catch (err) {
    error('No se pudo cargar el vocabulario de voz:', err);
  }

  /** Ejecuta una intención reconocida por voz. */
  /**
   * ¿Era una pregunta sobre un cuerpo? Se prueba ANTES de rendirse.
   *
   * El parser de intenciones entiende órdenes; las preguntas son otra cosa y
   * tienen su propio vocabulario. Se consulta cuando la intención no ha
   * quedado clara, para no robarle «háblame de Marte» al comando de siempre.
   *
   * @returns {boolean} true si se ha respondido algo
   */
  async function intentarResponder(texto) {
    if (!preguntas || !texto) return false;

    const pregunta = preguntas.interpretar(texto, App.estado.cuerpoActivo);
    if (!pregunta.atributo || !pregunta.cuerpo) return false;

    const datos = await narrador?.responder(pregunta.cuerpo, pregunta.atributo);
    if (!datos) return false;
    medir('preguntar', { via: 'catalogo', cuerpo: pregunta.cuerpo });

    hud.mostrarRespuesta({
      ...datos,
      cuerpo: catalogo.cuerpos.find((c) => c.id === pregunta.cuerpo)?.nombre ?? pregunta.cuerpo,
      etiqueta: pregunta.etiqueta,
    });
    anunciar(datos.texto);
    return true;
  }

  /**
   * Abre el diálogo de bienvenida. Se llama al arrancar y cada vez que alguien
   * quiere cambiar cómo se le llama, desde el panel de curiosidades.
   *
   * El saludo en voz alta va DESPUÉS de cerrarlo, no antes, porque hasta ese
   * momento no se sabe a quién hay que saludar, y porque los navegadores no
   * dejan sonar nada hasta que ha habido una interacción: pulsar el botón es
   * justamente esa interacción.
   */
  function abrirBienvenida() {
    return new Bienvenida({
      alTerminar: (nombre) => {
        hud.barra.establecerSubtitulo(
          nombre ? `Sesión de ${nombre}` : 'Estado del sistema: activo',
        );
        narrador.decirFrase('bienvenida', 0);
        anunciar(nombre ? `Hola, ${nombre}.` : 'Hola.');
      },
    });
  }

  /**
   * Habla con el asistente de verdad.
   *
   * Manda la conversación entera —el servidor la recorta— y ejecuta lo que
   * decida: si dice «mostrar Encélado», la cámara viaja mientras la respuesta
   * se oye. Ese es el punto de que la escena sea parte de la respuesta y no un
   * mando aparte.
   *
   * El historial no se guarda en ninguna parte: vive en el panel, viaja en cada
   * turno y se olvida al recargar. Ni localStorage —prohibido— ni sesión en el
   * servidor, que obligaría a identificar a quien pregunta.
   */
  async function conversar(turnos) {
    let datos = null;
    try {
      const peticion = await fetch(rutaApi('chat.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: turnos,
          cuerpo: App.estado.cuerpoActivo,
          nombre: App.estado.nombre,
        }),
      });
      datos = await peticion.json().catch(() => null);

      if (!peticion.ok) {
        // Un 503 no es un fallo: es un despliegue sin clave de Anthropic. Se
        // dice con esas palabras en lugar de un error genérico, porque la
        // diferencia entre «está roto» y «falta configurarlo» importa.
        return { texto: null, motivo: datos?.mensaje ?? 'El asistente no está disponible ahora mismo.' };
      }
    } catch (err) {
      error('La conversación falló:', err);
      return { texto: null, motivo: 'No he podido conectar con el servidor.' };
    }

    if (!datos?.texto) return { texto: null, motivo: 'El asistente no ha devuelto respuesta.' };
    medir('preguntar', App.estado.cuerpoActivo
      ? { via: 'conversacion', cuerpo: App.estado.cuerpoActivo }
      : { via: 'conversacion' });

    for (const accion of datos.acciones ?? []) {
      if (accion.tipo === 'mostrar' && accion.cuerpo) seleccionar(accion.cuerpo, 'asistente');
      else if (accion.tipo === 'vista_general') vistaGeneral();
    }

    narrador?.decirRespuestaLibre(datos.texto, datos.voz);
    return datos;
  }

  /**
   * ¿Esto es una PREGUNTA disfrazada de orden de navegación?
   *
   * EL FALLO QUE ESTO ARREGLA
   * ─────────────────────────
   * El parser tiene una regla de reserva razonable: una frase que solo nombra
   * un cuerpo significa «llévame ahí». La reconoce con confianza 0,90, frente
   * al 1,00 de las órdenes escritas de verdad.
   *
   * El problema es que esa regla se tragaba las preguntas, porque una pregunta
   * también nombra un cuerpo. «¿Cuál es el tamaño del Sol?» viajaba al Sol y se
   * ponía a narrarlo en lugar de responder; y estando en Marte, «¿cuál es la
   * distancia de Marte al Sol?» se iba al Sol —el cuerpo equivocado, además—.
   * Medido: las dos frases daban «ir_a» con confianza 0,90.
   *
   * La regla nueva es estrecha a propósito: solo se le quita el turno a la
   * REGLA DE RESERVA, nunca a una orden reconocida al 100 %. «Háblame de
   * Marte» y «llévame a Júpiter» marcan 1,00 y siguen navegando; ninguna de
   * las dos resuelve un atributo, así que tampoco entrarían aquí.
   */
  function esPreguntaDisfrazada(intencion) {
    const debil = (intencion.confianza ?? 1) < 1;
    if (!debil || !preguntas) return false;

    const texto = intencion.transcripcion;
    if (!texto || !Preguntas.pareceProbable(texto)) return false;

    return Boolean(preguntas.interpretar(texto, App.estado.cuerpoActivo).atributo);
  }

  function ejecutarIntencion(intencion) {
    const { intencion: tipo, cuerpo, cuerpoB } = intencion;

    switch (tipo) {
      case 'ir_a':
      case 'hablame_de':
        // Antes de viajar: comprobar que no era una pregunta. Ir al cuerpo y
        // narrarlo cuando se ha preguntado un dato concreto no solo no
        // responde, sino que además tapa la respuesta con la narración.
        if (esPreguntaDisfrazada(intencion)) {
          intentarResponder(intencion.transcripcion);
          break;
        }
        if (cuerpo) seleccionar(cuerpo, 'voz');
        break;

      case 'vista_general': vistaGeneral(); break;
      case 'siguiente': vecino(1); break;
      case 'anterior': vecino(-1); break;

      case 'satelites_de': {
        const datos = catalogo.cuerpos.find((c) => c.id === cuerpo);
        const lunas = (datos?.satelites ?? [])
          .map((id) => catalogo.cuerpos.find((c) => c.id === id)?.nombre)
          .filter(Boolean);
        anunciar(
          lunas.length
            ? `${datos.nombre} tiene ${lunas.length} satélites en ORBIS: ${lunas.join(', ')}.`
            : `${datos?.nombre ?? 'Ese cuerpo'} no tiene satélites catalogados en ORBIS.`,
        );
        if (cuerpo) seleccionar(cuerpo, 'voz');
        break;
      }

      case 'comparar':
        if (cuerpo && cuerpoB && hud.compararCuerpos(cuerpo, cuerpoB)) {
          anunciar(
            `Comparando ${catalogo.cuerpos.find((c) => c.id === cuerpo)?.nombre} ` +
            `con ${catalogo.cuerpos.find((c) => c.id === cuerpoB)?.nombre}.`,
          );
        } else if (cuerpo) {
          seleccionar(cuerpo, 'voz');
          anunciar('No he entendido con qué compararlo. Prueba: «comparar Marte con Venus».');
        }
        break;

      case 'pausar': if (!bucle.pausado) alternarPausa(); break;
      case 'reanudar': if (bucle.pausado) alternarPausa(); break;
      case 'acelerar': cambiarVelocidad(1); break;
      case 'frenar': cambiarVelocidad(-1); break;
      case 'mostrar_orbitas': mostrarOrbitas(true); break;
      case 'ocultar_orbitas': mostrarOrbitas(false); break;

      case 'modo_real': cambiarEscala('real'); break;
      case 'modo_didactico': cambiarEscala('didactico'); break;

      case 'repetir': narrador?.repetir(); break;
      case 'silencio':
        narrador?.silenciar(true);
        hud.actualizarSilencio(true);
        break;
      case 'detener_narracion': narrador?.detener(); break;

      case 'decir_nombre': {
        // El parser normaliza a minúsculas y sin tildes, así que «josé» llega
        // como «jose». Se recapitaliza para que al menos se escriba con mayúscula
        // inicial; recuperar la tilde no es posible y no merece adivinar.
        const crudo = (intencion.resto ?? '')
          .split(' ')
          .filter(Boolean)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(' ');
        const nombre = pareceNombre(crudo);
        if (!nombre) {
          sfx.reproducir('error');
          // El aviso lleva la salida: un error que solo dice que algo falló
          // deja a quien lo lee sin saber qué hacer a continuación.
          hud.avisar('No he entendido el nombre. Prueba con «me llamo» y tu nombre.', {
            tono: 'alerta', clave: 'nombre',
          });
          break;
        }
        App.definir('nombre', nombre);
        hud.barra.establecerSubtitulo(`Sesión de ${nombre}`);
        anunciar(`De acuerdo, ${nombre}.`);
        narrador?.decirFrase('bienvenida', 1);
        break;
      }
      case 'ayuda': hud.mostrarAyuda(); break;

      default:
        break;
    }

    sfx.reproducir('seleccion');
  }

  App.al('entrada:solicitar-microfono', async () => {
    if (!voz) return;
    if (voz.activo) {
      voz.desactivar();
      return;
    }
    // El aviso de privacidad se muestra ANTES de pedir el permiso, no después.
    hud.entradas.mostrarEstado(voz.avisoPrivacidad, 'info', 'microfono');
    await voz.activar();
  });

  App.al('voz:activa', ({ motor }) => {
    hud.entradas.establecerMicrofono(true);
    hud.barra.establecerIndicador('microfono', 'activo', motor === 'navegador' ? 'on' : 'servidor');
    anunciar('Micrófono activado. Di «ayuda» para saber qué puedes pedir.');
  });

  App.al('voz:inactiva', () => {
    hud.entradas.establecerMicrofono(false);
    hud.barra.establecerIndicador('microfono', 'inactivo', 'off');
    hud.entradas.mostrarEstado('', 'info', 'microfono');
  });

  App.al('voz:error', ({ mensaje }) => {
    hud.entradas.mostrarEstado(mensaje, 'error', 'microfono');
    hud.barra.establecerIndicador('microfono', 'alerta', 'error');
    anunciar(mensaje);
  });

  App.al('voz:no-entendido', async ({ texto, sugerencias }) => {
    // Con el módulo ASISTENTE abierto, cualquier cosa que no sea una orden es
    // una pregunta para la conversación. Eso es lo que significa un chatbot por
    // voz: no hay que acertar con la fórmula, se habla y ya.
    //
    // Y solo con ese módulo abierto, a propósito. Quien está mirando los
    // paneles de datos no ha pedido conversar, y mandar cada frase suelta a una
    // API de pago sin que nadie lo haya pedido sería cobrarle por equivocarse.
    if (document.body.dataset.modulo === 'asistente' && hud.charla && !hud.charla.desactivado) {
      hud.charla.preguntar(texto);
      return;
    }

    // Fuera de ese módulo: puede que no fuera una orden sino una de las
    // preguntas del catálogo. El parser de intenciones solo entiende órdenes,
    // así que aquí es donde tiene sentido probar el otro vocabulario, y no
    // antes: «háblame de Marte» debe seguir siendo el comando de siempre.
    if (await intentarResponder(texto)) return;

    sfx.reproducir('error');
    hud.mostrarSugerencias(texto, sugerencias);
  });

  // El panel de conversación refleja si el micrófono está escuchando, para que
  // el botón de dictar diga la verdad y no solo parpadee.
  App.al('voz:activa', () => hud.charla?.establecerDictado(true));
  App.al('voz:inactiva', () => hud.charla?.establecerDictado(false));

  // Y si el servidor no tiene clave configurada, se dice una sola vez al abrir
  // el módulo, en lugar de dejar que falle pregunta a pregunta.
  App.al('hud:modulo', async ({ id }) => {
    if (id !== 'asistente' || hud.charla?.comprobado) return;
    hud.charla.comprobado = true;
    try {
      const r = await fetch(rutaApi('chat.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: [] }),
      });
      if (r.status === 503) {
        const datos = await r.json().catch(() => null);
        hud.charla.desactivar(datos?.mensaje
          ?? 'La conversación libre no está configurada en este servidor. Prueba el módulo Curiosidades.');
      }
    } catch {
      // Sin red no se desactiva nada: puede ser un corte momentáneo y la
      // siguiente pregunta lo dirá con más precisión que un aviso adelantado.
    }
  });

  // ------------------------------------------------------------------ bucle --
  let usuarioInteractuando = false;
  gestor.controles.addEventListener('start', () => {
    usuarioInteractuando = true;
  });
  gestor.controles.addEventListener('end', () => {
    usuarioInteractuando = false;
  });

  const bucle = new Loop({
    alActualizar: (delta, deltaSimulado, fecha, deltaReal) => {
      sistema.actualizar(fecha, delta);
      // La cámara se mueve con el tiempo real (acotado a medio segundo para
      // que volver de una pestaña en segundo plano no la teletransporte).
      rig.actualizar(Math.min(0.5, deltaReal), usuarioInteractuando);
      gestor.controles.update();
      sistema.actualizarEntorno(
        gestor.camara.position.distanceTo(gestor.controles.target),
        delta,
      );
      App.estado.tiempoSimulado = fecha;
    },
    alRenderizar: (delta) => {
      efectos.render(delta);
      gestor.renderizadorEtiquetas.render(gestor.escena, gestor.camara);
      // Las anotaciones y la retícula se recolocan después de renderizar, con
      // la cámara ya en su posición definitiva de este fotograma.
      hud.actualizarRapido(delta);
    },
    alActualizarLento: (_, fps) => {
      App.definir('fps', fps);
      hud.actualizarLento(fps, bucle.fechaSimulada);
      ajustarCalidad(fps);
    },
  });

  /**
   * Degradación automática. Si los fotogramas no llegan, se sacrifica primero
   * la resolución del post-procesado y después el bloom entero, antes que
   * dejar la escena a trompicones.
   */
  let calidad = 'alta';
  let muestrasBajas = 0;
  function ajustarCalidad(fps) {
    if (App.preferencias.get('calidad') !== 'auto') return;

    if (fps < 32) muestrasBajas++;
    else if (fps > 52) muestrasBajas = Math.max(0, muestrasBajas - 1);

    if (muestrasBajas > 12 && calidad === 'alta') {
      calidad = 'media';
      efectos.establecerCalidad('media');
      log('Calidad reducida a media por rendimiento.');
    } else if (muestrasBajas > 30 && calidad === 'media') {
      calidad = 'baja';
      efectos.establecerCalidad('baja');
      log('Post-procesado desactivado por rendimiento.');
    }
  }

  // -------------------------------------------------------------- exposición --
  Object.assign(App.subsistemas, {
    escena: gestor, sistema, efectos, rig, bucle, controles, hud, narrador, sfx,
    manos, reconocedor, voz,
  });
  // Superficie pública para la consola del navegador y las pruebas.
  App.acciones = {
    seleccionar, vistaGeneral, vistaGalactica, vecino,
    alternarPausa, cambiarVelocidad, mostrarOrbitas, cambiarEscala,
    ejecutarIntencion,
    comparar: (a, b) => hud.compararCuerpos(a, b),
    preguntar: (texto) => intentarResponder(texto),
  };
  App.faseImplementada = 7;

  sistema.establecerVisibilidadOrbitas(App.preferencias.get('mostrarOrbitas'));
  bucle.iniciar();

  // El cielo de alta resolución se pide con la escena ya en marcha: llega
  // cuando llegue y hasta entonces se ve el de 512 px, que en un fondo
  // desenfocado por el bloom apenas se distingue.
  setTimeout(() => sistema.mejorarEntorno(), 1200);

  App.definir('cargando', false);
  progresar(1, 'Listo.');
  document.body.dataset.estado = 'listo';
  anunciar('Sistema Solar cargado. Use Tab para navegar o haga clic sobre un cuerpo.');

  // -------------------------------------------------------- estrellas fugaces --
  // Cruza una cada cuarto de hora. Al pulsarla, el asistente cuenta qué lluvia
  // de meteoros está activa EN LA FECHA SIMULADA, no en la de hoy: si el
  // usuario ha adelantado el reloj a diciembre, le tocan las Gemínidas.
  // Solo se encienden si hay catálogo de lluvias que contar. Sin él, el trazo
  // cruzaría la pantalla para decir «no tengo datos» al pulsarlo, que es peor
  // que no cruzar. Es la misma regla de siempre: si no hay dato, no se finge.
  let hayMeteoros = false;
  try {
    const catalogoMeteoros = await (await fetch(rutaDatos('meteoros.json'))).json();
    hayMeteoros = Array.isArray(catalogoMeteoros?.lluvias) && catalogoMeteoros.lluvias.length > 0;
  } catch {
    hayMeteoros = false;
  }

  const fugaces = hayMeteoros ? new EstrellaFugaz(document.body, {
    alObservar: async () => {
      const fecha = App.estado.tiempoSimulado ?? new Date();
      const datos = await narrador?.contarMeteoros(fecha);
      if (!datos) {
        anunciar('No he podido recuperar los datos de la lluvia.');
        return;
      }
      hud.mostrarRespuesta({
        texto: datos.texto,
        fuente: datos.fuente,
        // «100 meteoros/hora» a secas se lee como una promesa de lo que se va a
        // ver, y el THZ no es eso: es la tasa que habría con el radiante en el
        // cénit y un cielo perfecto. La etiqueta va pegada al número, no en una
        // nota al pie que nadie mira.
        valor: datos.datos?.thz ? `${datos.datos.thz}/hora · tasa teórica` : null,
        sinDato: false,
        cuerpo: datos.lluvia ?? 'Fondo esporádico',
        etiqueta: datos.datos?.radiante ? `radiante en ${datos.datos.radiante}` : 'lluvia de meteoros',
      });
      anunciar(datos.texto);
    },
  }) : null;
  App.subsistemas.fugaces = fugaces;
  if (!hayMeteoros) {
    log('Sin data/meteoros.json: las estrellas fugaces quedan desactivadas.');
  }

  // ------------------------------------------------------------ bienvenida --
  // El asistente se presenta y pregunta el nombre. No bloquea: se puede seguir
  // sin darlo, y entonces habla en general. El saludo en voz alta va DESPUÉS de
  // cerrar el diálogo, no antes, porque hasta ese momento no se sabe a quién
  // hay que saludar, y porque los navegadores no dejan sonar nada hasta que ha
  // habido una interacción: pulsar el botón es justamente esa interacción.
  abrirBienvenida();

  if (depuracion.activo) {
    log('Diagnóstico:', resultados);
    log('Estadísticas de render:', gestor.estadisticas);
    log('Velocidades disponibles:', VELOCIDADES.map((v) => v.etiqueta).join(', '));
    const { montarPanelDepuracion } = await import('./utils/panel-depuracion.js');
    montarPanelDepuracion({ App, gestor, efectos, bucle, sistema });
  }

  // Liberar todo al cerrar la pestaña: evita que el contexto WebGL quede
  // colgado si el navegador conserva la página en la caché de retroceso.
  window.addEventListener('pagehide', () => {
    bucle.detener();
    fugaces?.destruir();
    manos.destruir();
    voz?.destruir();
    cursorGestual.destruir();
    narrador.destruir();
    sfx.destruir();
    hud.destruir();
    controles.destruir();
    sistema.destruir();
    efectos.destruir();
    gestor.destruir();
  }, { once: true });
}

window.addEventListener('error', (e) => error('Error no capturado:', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => error('Promesa rechazada:', e.reason));

arrancar().catch((err) => {
  fallar(err.message ?? 'Fallo desconocido durante el arranque.');
  console.error(err);
});
