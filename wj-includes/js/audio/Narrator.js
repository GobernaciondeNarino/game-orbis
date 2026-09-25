/**
 * Narrator — narración por audio de cada cuerpo.
 *
 * Dos motores, en este orden:
 *   1. api/tts.php, que devuelve el MP3 generado con ElevenLabs y cacheado en
 *      el servidor. Es la voz buena.
 *   2. SpeechSynthesis del navegador, si el primero no está disponible. Suena
 *      peor, pero la narración no desaparece por un problema de despliegue.
 *
 * En ambos casos hay subtítulos. No son opcionales: son la única forma de
 * seguir la narración para quien no oye, y también para quien tiene el volumen
 * apagado, que son muchos más.
 *
 * SINCRONIZACIÓN DE LOS SUBTÍTULOS. Con la voz del navegador se usan los
 * eventos `boundary`, que dan la posición exacta de la palabra que se está
 * leyendo. Con el MP3 no hay marcas de tiempo, así que se reparte la duración
 * real del audio entre las frases en proporción a su número de caracteres. No
 * es sincronización palabra a palabra, pero con frases de una o dos líneas el
 * desfase es de décimas y se corrige en cada cambio de frase.
 *
 * DE DÓNDE SALEN LOS TEXTOS. Del conocimiento publicado de cada cuerpo
 * (api/conocimiento.php): las narraciones del catálogo más las que se añaden
 * desde el panel, y sus datos sueltos. Cuantas más haya, más tarda en repetirse
 * nada. Si el servidor no contesta, se usan las del catálogo, que vienen con la
 * página. El audio se pide por la HUELLA del texto y no por su posición, para
 * que el sonido y los subtítulos no se desacompasen si la lista cambia desde el
 * panel mientras alguien navega.
 */

import { App } from '../core/App.js';
import { rutaApi, rutaApp } from '../utils/rutas.js';
import { log, aviso } from '../utils/debug.js';
import { cargarConocimiento, conocimientoEnMemoria } from '../utils/conocimiento.js';

/** Milisegundos del fundido de entrada y de salida. */
const FUNDIDO_ENTRADA = 320;
const FUNDIDO_SALIDA = 180;

/** Cuántos vecinos de la tira se precargan a cada lado. */
const VECINOS_PRECARGADOS = 2;

export class Narrator {
  /**
   * @param {object[]} catalogo entradas del catálogo, en orden de navegación
   * @param {import('../ui/Subtitles.js').Subtitles} subtitulos
   */
  /**
   * @param {object[]} catalogo entradas del catálogo, en orden de navegación
   * @param {import('../ui/Subtitles.js').Subtitles} subtitulos
   * @param {object|null} salud respuesta de api/health.php, si se obtuvo
   */
  constructor(catalogo, subtitulos, salud = null) {
    this.catalogo = catalogo;
    this.subtitulos = subtitulos;
    this.porId = new Map(catalogo.map((c) => [c.id, c]));
    this.orden = catalogo.map((c) => c.id);

    /** Elemento de audio único: reutilizarlo evita acumular reproductores. */
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = 0;

    /** Elementos de precarga de los vecinos, por id. */
    this.precargas = new Map();

    /**
     * Cuántas veces se ha narrado ya cada cuerpo, para ir alternando entre sus
     * narraciones. Vive en memoria y solo en memoria: el pliego prohíbe
     * localStorage, así que al recargar la página se empieza otra vez por la
     * primera. Es lo correcto además de lo obligado —la gracia es no repetirse
     * dentro de una misma visita, no llevar un historial de nadie—.
     */
    this.visitas = new Map();

    // Turno de cada familia de entradilla («presentacion», «regreso»), aparte
    // del de las narraciones. Ver _turnoEntradilla.
    this._turnosEntradilla = new Map();

    // Qué dato suelto toca decir tras la narración de cada cuerpo. Rotación,
    // como todo lo demás: el mismo dato no vuelve hasta haberlos dicho todos.
    this._turnosDato = new Map();
    /** Cuerpo cuya narración, al terminar entera, lleva un dato detrás. */
    this._datoPendiente = null;
    /** Número de la última narración pedida: detecta que otra se adelantó. */
    this._pedidoNarracion = 0;

    // Si el diagnóstico de arranque ya nos dijo que el servidor no puede
    // sintetizar, se empieza directamente con la voz del navegador. Así se
    // evita una petición condenada al fracaso —y su error en consola— por cada
    // cuerpo que se visite.
    this.motor = this._motorSegunSalud(salud);
    this.idActual = null;
    this.reproduciendo = false;
    this._fundido = null;
    this._locucion = null;         // SpeechSynthesisUtterance en curso

    this._alTerminar = () => this._terminar();
    this._alFallar = () => this._recurrirANavegador();
    this._alActualizarTiempo = () => this._sincronizarSubtitulos();

    this.audio.addEventListener('ended', this._alTerminar);
    this.audio.addEventListener('error', this._alFallar);
    this.audio.addEventListener('timeupdate', this._alActualizarTiempo);

    App.preferencias.alCambiar((clave) => {
      if (clave === 'volumenNarracion' || clave === 'narracionSilenciada') {
        this._aplicarVolumen();
      }
      if (clave === 'subtitulos') this.subtitulos.establecerActivos(App.preferencias.get('subtitulos'));
    });
  }

  /** Decide el motor inicial a partir del diagnóstico del servidor. */
  _motorSegunSalud(salud) {
    if (!salud?.comprobaciones) return 'servidor';

    const clave = salud.comprobaciones.find((c) => c.clave === 'clave_elevenlabs');
    const cache = salud.comprobaciones.find((c) => c.clave === 'cache_audio');

    if (clave && clave.resultado !== 'ok') {
      log('Sin clave de ElevenLabs en el servidor: narración con la voz del navegador.');
      return 'navegador';
    }
    if (cache && cache.resultado === 'error') {
      log('cache/audio no es escribible: narración con la voz del navegador.');
      return 'navegador';
    }
    return 'servidor';
  }

  get volumenObjetivo() {
    return App.preferencias.get('narracionSilenciada') ? 0 : App.preferencias.get('volumenNarracion');
  }

  _aplicarVolumen() {
    if (!this._fundido) this.audio.volume = this.volumenObjetivo;
  }

  /**
   * URL del audio de un cuerpo.
   * @param {boolean} soloCache true para las precargas: el servidor devuelve
   *   204 si el audio no está generado, en lugar de generarlo. Precargar no
   *   debe gastar el cupo por hora del visitante ni la cuota de la cuenta.
   */
  _url(id, soloCache = false, variante = 0) {
    // Con el conocimiento ya cargado, se pide por la huella del texto que se va
    // a subtitular: el servidor solo encuentra ese texto, o nada. Sin él, por
    // posición, como antes.
    const publicadas = conocimientoEnMemoria(id)?.narraciones;
    const elegida = publicadas?.length ? publicadas[variante % publicadas.length] : null;
    const base = elegida
      ? `${rutaApi('tts.php')}?bodyId=${encodeURIComponent(id)}&narracion=${elegida.huella}`
      : `${rutaApi('tts.php')}?bodyId=${encodeURIComponent(id)}&variante=${variante}`;
    return soloCache ? `${base}&soloCache=1` : base;
  }

  /**
   * URL de una frase del asistente.
   *
   * El texto lo pone el servidor: aquí solo viaja QUÉ frase, cuál de sus
   * versiones, y el nombre, que allí se valida antes de encajarlo. Nunca sale
   * de aquí una oración para sintetizar.
   */
  _urlFrase(frase, variante = 0, idCuerpo = null) {
    const partes = [
      `frase=${encodeURIComponent(frase)}`,
      `variante=${variante}`,
    ];
    const nombre = App.estado.nombre;
    if (nombre) partes.push(`nombre=${encodeURIComponent(nombre)}`);
    // De qué cuerpo se habla, no qué se dice de él: el servidor mira su tipo y
    // elige el encuadre. Ver Asistente::frase.
    if (idCuerpo) partes.push(`cuerpo=${encodeURIComponent(idCuerpo)}`);
    return `${rutaApi('tts.php')}?${partes.join('&')}`;
  }

  /**
   * Dice una frase del asistente y devuelve una promesa que se resuelve al
   * terminar. Usa un reproductor aparte a propósito: el principal lleva
   * enganchada la sincronización de subtítulos con su tiempo de reproducción, y
   * meter aquí una segunda pista descuadraría los subtítulos de la narración.
   *
   * Si algo falla —no hay clave, no hay red, el navegador bloquea el audio— se
   * resuelve igualmente. Una frase de cortesía no puede impedir que se oiga la
   * narración, que es lo que de verdad importa.
   */
  async decirFrase(frase, variante = 0, idCuerpo = null) {
    if (this.motor === 'ninguno') return false;
    if (App.preferencias.get('narracionSilenciada')) return false;

    // El texto se pide siempre, lo diga quien lo diga: hace falta para el
    // subtítulo, que es obligatorio, y para la voz del navegador cuando no hay
    // síntesis en el servidor. Es una consulta sin coste ni credenciales.
    const texto = await this._textoFrase(frase, variante, idCuerpo);
    if (!texto) return false;

    this.subtitulos.mostrarFrase(texto);

    if (this.motor !== 'servidor') return this._decirFraseConNavegador(texto);

    return new Promise((resolver) => {
      const reproductor = new Audio();
      reproductor.preload = 'auto';
      reproductor.volume = this.volumenObjetivo;
      if (reproductor.volume <= 0) { resolver(false); return; }

      let terminado = false;
      const acabar = (ok) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(temporizador);
        reproductor.src = '';
        // Solo se limpia si sigue siendo ESTA frase: entre medias puede haber
        // empezado otra —cambiar de cuerpo mientras suena la entradilla— y
        // borrarla aquí dejaría la nueva sin poder cortarse.
        if (this._fraseEnCurso === reproductor) this._fraseEnCurso = null;
        resolver(ok);
      };

      // Red de seguridad: si el audio no llega en unos segundos, se sigue sin
      // él en lugar de dejar al usuario mirando un planeta en silencio.
      const temporizador = setTimeout(() => acabar(false), 6000);

      reproductor.addEventListener('ended', () => acabar(true), { once: true });
      reproductor.addEventListener('error', () => acabar(false), { once: true });

      this._fraseEnCurso = reproductor;
      reproductor.src = this._urlFrase(frase, variante, idCuerpo);
      reproductor.play().catch(() => acabar(false));
    });
  }

  /**
   * Dice la respuesta a una pregunta y devuelve lo que compuso el servidor.
   *
   * El texto no se genera aquí: se pide con dos identificadores y llega hecho,
   * con su fuente. Así la respuesta que se oye, la que se lee en el subtítulo y
   * la que se muestra en el panel son literalmente la misma cadena, y no tres
   * versiones que puedan desincronizarse.
   *
   * @returns {Promise<object|null>} { texto, fuente, valor, sinDato }
   */
  async responder(idCuerpo, atributo) {
    const consulta =
      `bodyId=${encodeURIComponent(idCuerpo)}&atributo=${encodeURIComponent(atributo)}`;

    const datos = await this._pedirJson(`${rutaApi('respuesta.php')}?${consulta}`);
    if (!datos?.texto) return null;

    this.detener();
    this.subtitulos.mostrarFrase(datos.texto, 9000);
    this._decirConVozDelServidor(consulta, datos.texto);

    return datos;
  }

  /**
   * Dice en voz alta una respuesta de la conversación.
   *
   * Se pide por su HASH, no por su texto: api/tts.php no sintetiza texto que
   * venga del navegador —sería un proxy abierto a una API de pago— y la
   * respuesta la escribió el propio servidor en api/chat.php, que la guardó y
   * devolvió su huella. Así el asistente habla con la voz buena sin abrir ese
   * agujero. Sin huella, o si falla, lo dice el navegador.
   */
  decirRespuestaLibre(texto, huella) {
    if (!texto) return;
    this.detener();
    this.subtitulos.mostrarFrase(texto, 12000);

    if (this.motor !== 'servidor' || !huella) {
      if (this.motor !== 'ninguno') this._decirFraseConNavegador(texto);
      return;
    }

    this._decirConVozDelServidor(`respuesta=${encodeURIComponent(huella)}`, texto);
  }

  /**
   * Cuenta qué lluvia de meteoros está activa en la fecha simulada.
   *
   * @param {Date} fecha la fecha de la escena, no la del reloj de pared
   * @returns {Promise<object|null>} { texto, fuente, lluvia, datos }
   */
  async contarMeteoros(fecha) {
    const mes = fecha.getUTCMonth() + 1;
    const dia = fecha.getUTCDate();

    const datos = await this._pedirJson(`${rutaApi('meteoros.php')}?mes=${mes}&dia=${dia}`);
    if (!datos?.texto) return null;

    this.detener();
    this.subtitulos.mostrarFrase(datos.texto, 12000);
    this._decirConVozDelServidor(`meteoros=${mes}-${dia}`, datos.texto);

    return datos;
  }

  /** Pide el texto de una frase. Devuelve null si no hay versión aplicable. */
  async _textoFrase(frase, variante, idCuerpo = null) {
    const partes = [`frase=${encodeURIComponent(frase)}`, `variante=${variante}`];
    const nombre = App.estado.nombre;
    if (nombre) partes.push(`nombre=${encodeURIComponent(nombre)}`);
    if (idCuerpo) partes.push(`cuerpo=${encodeURIComponent(idCuerpo)}`);

    const datos = await this._pedirJson(`${rutaApi('frase.php')}?${partes.join('&')}`);
    return typeof datos?.texto === 'string' ? datos.texto : null;
  }

  /**
   * Pide JSON a un endpoint de ORBIS. Devuelve null ante cualquier problema.
   *
   * Lo repetían `responder`, `contarMeteoros` y `_textoFrase` con el mismo
   * try/catch. Que un endpoint no conteste NUNCA debe romper la interfaz: la
   * narración es un extra y sin ella se sigue navegando, leyendo y comparando.
   */
  async _pedirJson(url) {
    try {
      const respuesta = await fetch(url);
      // 204 es «no hay versión aplicable», no un fallo: llega sin cuerpo.
      if (respuesta.status === 204 || !respuesta.ok) return null;
      return await respuesta.json();
    } catch {
      return null;
    }
  }

  /**
   * Dice un texto con la voz buena, y si no puede, con la del navegador.
   *
   * Estaba copiado tres veces —respuesta a una pregunta, respuesta del
   * asistente y lluvia de meteoros— idéntico salvo la consulta que se le pasa
   * a api/tts.php. Tres copias de una cadena de reserva son tres sitios donde
   * se puede quedar muda de formas distintas.
   *
   * @param {string} consulta lo que va tras la «?» de api/tts.php
   * @param {string} texto    lo mismo que se está diciendo, para la reserva
   */
  _decirConVozDelServidor(consulta, texto) {
    if (this.motor !== 'servidor') {
      if (this.motor === 'navegador') this._decirFraseConNavegador(texto);
      return;
    }

    const reproductor = new Audio();
    reproductor.volume = this.volumenObjetivo;
    // Silenciado: no se pide el audio siquiera. Generarlo costaría dinero y
    // nadie lo iba a oír.
    if (reproductor.volume <= 0) return;

    this._fraseEnCurso = reproductor;
    reproductor.addEventListener('error', () => {
      // Sin síntesis en el servidor, lo dice el navegador: la respuesta no
      // puede quedarse muda solo porque falte una clave de API.
      if (this._fraseEnCurso === reproductor) this._fraseEnCurso = null;
      this._decirFraseConNavegador(texto);
    }, { once: true });
    reproductor.src = `${rutaApi('tts.php')}?${consulta}`;
    reproductor.play().catch(() => this._decirFraseConNavegador(texto));
  }

  /** La entradilla con la voz del navegador, para cuando no hay ElevenLabs. */
  _decirFraseConNavegador(texto) {
    if (!('speechSynthesis' in window)) return Promise.resolve(false);

    return new Promise((resolver) => {
      const locucion = new SpeechSynthesisUtterance(texto);
      locucion.lang = 'es-ES';
      locucion.rate = 1.02;         // Un pelo más viva que la narración.
      locucion.volume = this.volumenObjetivo;

      let terminado = false;
      const acabar = (ok) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(temporizador);
        if (this._locucionFrase === locucion) this._locucionFrase = null;
        resolver(ok);
      };
      const temporizador = setTimeout(() => acabar(false), 6000);

      locucion.onend = () => acabar(true);
      locucion.onerror = () => acabar(false);

      this._locucionFrase = locucion;
      window.speechSynthesis.speak(locucion);
    });
  }

  /** Corta la frase del asistente si hubiera una sonando. */
  _cortarFrase() {
    if (this._locucionFrase) {
      window.speechSynthesis?.cancel();
      this._locucionFrase = null;
    }
    if (!this._fraseEnCurso) return;
    this._fraseEnCurso.pause();
    this._fraseEnCurso.src = '';
    this._fraseEnCurso = null;
  }

  /**
   * Las narraciones de un cuerpo: las publicadas si ya llegaron —catálogo más
   * panel, sin las retiradas—, y si no, las del catálogo que trae la página.
   */
  _narraciones(id) {
    const publicadas = conocimientoEnMemoria(id)?.narraciones;
    if (publicadas?.length) return publicadas.map((n) => n.texto);
    const lista = this.porId.get(id)?.narraciones;
    return Array.isArray(lista) ? lista.filter(Boolean) : [];
  }

  /**
   * Qué narración toca la PRÓXIMA vez que se narre este cuerpo.
   *
   * Rotación, no azar. Con tres textos al azar hay una posibilidad entre tres
   * de oír el mismo dos veces seguidas, que es justo lo que se quiere evitar;
   * rotando, no puede pasar hasta haberlos oído todos. Y siendo determinista se
   * puede probar, cosa que con Math.random() no.
   */
  _siguienteVariante(id) {
    const total = this._narraciones(id).length;
    return total ? (this.visitas.get(id) ?? 0) % total : 0;
  }

  /**
   * Turno de la ENTRADILLA, que no tiene nada que ver con el de la narración.
   *
   * AQUÍ ESTABA EL FALLO QUE HACÍA QUE SONASE A GRABACIÓN
   * ────────────────────────────────────────────────────
   * La entradilla pedía la misma variante que la narración. Como la primera
   * visita a cualquier cuerpo usa siempre la narración 0, la entradilla era
   * siempre la 0 también: «Mira esto» en Mercurio, «Mira esto» en Venus, «Mira
   * esto» en Marte. Cinco versiones escritas y una sola sonando.
   *
   * Con un contador propio que avanza en CADA entradilla, dos cuerpos seguidos
   * no pueden abrirse igual. Sigue siendo rotación y no azar, por lo mismo de
   * siempre: con azar puede salir la misma dos veces seguidas, y además no se
   * podría probar.
   *
   * El contador no se acota aquí a propósito. Quien conoce el tamaño de cada
   * lista es el servidor —depende del tipo de cuerpo y de si hay nombre—, y allí
   * se envuelve con un módulo. Que crezca sin límite tampoco gasta de más: la
   * caché de audio se indexa por el TEXTO resultante, no por el número, así que
   * la vuelta 1 y la vuelta 50 comparten el mismo MP3.
   *
   * POR QUÉ UN CONTADOR POR TIPO Y NO UNO SOLO
   * ──────────────────────────────────────────
   * El servidor pone las versiones propias del tipo delante de las generales.
   * Con un contador único, para cuando se llega a la primera luna el contador ya
   * va por el siete y el encuadre —«bajamos a una luna»— no sale nunca: se ve al
   * probarlo, quince cuerpos seguidos y las de satélite sin aparecer una sola
   * vez. Llevando la cuenta por tipo, la primera luna estrena las suyas, la
   * segunda sigue, y cuando se agotan pasa a las generales.
   *
   * El tipo se usa AQUÍ solo para elegir contador. Qué se dice lo sigue
   * decidiendo el servidor a partir del identificador del cuerpo.
   */
  _turnoEntradilla(frase, tipo = null) {
    const clave = `${frase}:${tipo ?? 'general'}`;
    const turno = this._turnosEntradilla.get(clave) ?? 0;
    this._turnosEntradilla.set(clave, turno + 1);
    return turno;
  }

  /**
   * Narra un cuerpo. Si ya se estaba narrando otro, se corta de inmediato:
   * dos voces solapadas son peores que ninguna.
   */
  async narrar(id, varianteForzada = null) {
    if (this.idActual === id && this.reproduciendo) return;

    // El conocimiento publicado, si llega a tiempo (el módulo se rinde a los
    // dos segundos y medio). Mientras se espera, el usuario puede haber
    // cambiado de cuerpo: si otra narración se ha pedido después, esta ya no
    // toca.
    const pedido = ++this._pedidoNarracion;
    await cargarConocimiento(id);
    if (pedido !== this._pedidoNarracion) return;

    const cuerpo = this.porId.get(id);
    const narraciones = this._narraciones(id);
    if (!cuerpo || !narraciones.length) {
      this.detener();
      return;
    }

    if (varianteForzada === null) {
      // Se avanza el contador al empezar, no al terminar: quien corta la
      // narración a los dos segundos y vuelve más tarde también merece oír otra.
      this.varianteActual = this._siguienteVariante(id);
      this.visitas.set(id, (this.visitas.get(id) ?? 0) + 1);
    } else {
      this.varianteActual = varianteForzada % narraciones.length;
    }
    const texto = narraciones[this.varianteActual];

    this.detener();
    this.idActual = id;
    // Solo la narración que llega sola —al abrir el cuerpo— lleva un dato
    // detrás. Quien pide «repetir» quiere oír lo mismo, no algo más.
    this._datoPendiente = varianteForzada === null ? id : null;
    this.subtitulos.preparar(texto, cuerpo.nombre);

    // Entradilla del asistente: «Mira esto, Ana» la primera vez, «otra vez por
    // aquí» al volver. Es corta y se sintetiza aparte, así que no obliga a
    // regenerar las 105 narraciones una vez por cada nombre; las narraciones
    // siguen siendo las mismas para todo el mundo y comparten caché.
    if (varianteForzada === null) {
      const primeraVez = this.varianteActual === 0 && (this.visitas.get(id) ?? 0) <= 1;
      const frase = primeraVez ? 'presentacion' : 'regreso';
      // No se espera a que termine si el usuario cambia de cuerpo mientras
      // tanto: `idActual` habrá cambiado y la narración de este ya no toca.
      await this.decirFrase(frase, this._turnoEntradilla(frase, cuerpo.tipo), id);
      if (this.idActual !== id) return;
    }

    if (this.motor === 'navegador') {
      this._narrarConNavegador(cuerpo, texto);
      this._precargarVecinos(id);
      return;
    }

    this.audio.src = this._url(id, false, this.varianteActual);
    this.audio.currentTime = 0;

    try {
      await this.audio.play();
      this.reproduciendo = true;
      this._fundir(this.volumenObjetivo, FUNDIDO_ENTRADA);
      App.emitir('narracion:inicio', { id, motor: this.motor, variante: this.varianteActual });
    } catch (err) {
      // Los navegadores bloquean la reproducción automática hasta que hay una
      // interacción del usuario. No es un error del servidor y no debe hacer
      // que la aplicación cambie de motor.
      if (err?.name === 'NotAllowedError') {
        aviso('El navegador bloquea el audio hasta la primera interacción del usuario.');
        App.emitir('narracion:bloqueada', { id });
        return;
      }
      this._recurrirANavegador();
    }

    this._precargarVecinos(id);
  }

  /**
   * Precarga los vecinos en la tira de navegación. El usuario que va pasando
   * cuerpos con las flechas encuentra el audio ya descargado.
   *
   * Solo se precarga con el motor del servidor y con la red en buen estado: en
   * una conexión lenta, bajar tres MP3 a la vez retrasaría el que se quiere oír.
   */
  _precargarVecinos(id) {
    if (this.motor !== 'servidor') return;
    if (navigator.connection?.saveData) return;
    const tipo = navigator.connection?.effectiveType;
    if (tipo && ['slow-2g', '2g'].includes(tipo)) return;

    const indice = this.orden.indexOf(id);
    if (indice < 0) return;

    const deseados = new Set();
    for (let d = 1; d <= VECINOS_PRECARGADOS; d++) {
      deseados.add(this.orden[(indice + d) % this.orden.length]);
      deseados.add(this.orden[(indice - d + this.orden.length) % this.orden.length]);
    }

    // Se descartan las precargas que ya no hacen falta: si no, al recorrer el
    // catálogo entero quedarían treinta elementos de audio en memoria.
    for (const [clave, elemento] of this.precargas) {
      if (!deseados.has(clave)) {
        elemento.src = '';
        this.precargas.delete(clave);
      }
    }

    for (const vecino of deseados) {
      if (this.precargas.has(vecino)) continue;
      // Se pide ya su conocimiento, sin esperarlo: cuando le toque, estará.
      cargarConocimiento(vecino);
      if (!this._narraciones(vecino).length) continue;
      const elemento = new Audio();
      elemento.preload = 'auto';
      // Un 204 hace que el elemento dispare `error`. Es lo esperado y no debe
      // cambiar el motor de narración ni ensuciar la consola.
      elemento.addEventListener('error', (e) => e.stopPropagation(), { once: true });
      // La que le tocará a ese vecino cuando le llegue el turno, que es la que
      // de verdad se va a pedir: precargar otra sería descargar para nada.
      elemento.src = this._url(vecino, true, this._siguienteVariante(vecino));
      this.precargas.set(vecino, elemento);
    }
  }

  /** Voz del navegador: peor calidad, pero siempre disponible. */
  _narrarConNavegador(cuerpo, texto = null) {
    if (!('speechSynthesis' in window)) {
      this.motor = 'ninguno';
      App.emitir('narracion:sin-motor', {});
      return;
    }

    window.speechSynthesis.cancel();

    const locucion = new SpeechSynthesisUtterance(
      texto ?? this._narraciones(cuerpo.id)[this.varianteActual ?? 0] ?? '',
    );
    locucion.lang = 'es-ES';
    locucion.rate = 0.98;
    locucion.pitch = 1;
    locucion.volume = this.volumenObjetivo;

    // `boundary` da la posición del carácter que se está leyendo: con eso los
    // subtítulos van exactos, sin estimaciones.
    locucion.onboundary = (evento) => {
      if (evento.name === 'word' || evento.charIndex !== undefined) {
        this.subtitulos.mostrarEnCaracter(evento.charIndex);
      }
    };
    locucion.onend = () => this._terminar();
    locucion.onerror = () => this._terminar(false);

    this._locucion = locucion;
    this.reproduciendo = true;
    window.speechSynthesis.speak(locucion);
    App.emitir('narracion:inicio', { id: cuerpo.id, motor: 'navegador', variante: this.varianteActual ?? 0 });
  }

  /** Cambia al motor del navegador y reintenta con el cuerpo actual. */
  _recurrirANavegador() {
    if (this.motor === 'navegador') return;
    aviso('La narración con voz del servidor no está disponible; se usa la del navegador.');
    this.motor = 'navegador';
    App.emitir('narracion:motor', { motor: 'navegador' });

    const cuerpo = this.idActual ? this.porId.get(this.idActual) : null;
    if (cuerpo) this._narrarConNavegador(cuerpo);
  }

  _sincronizarSubtitulos() {
    if (!this.reproduciendo || !Number.isFinite(this.audio.duration)) return;
    this.subtitulos.mostrarEnFraccion(this.audio.currentTime / this.audio.duration);
  }

  /** @param {boolean} completa false si terminó por un error, no por llegar al final */
  _terminar(completa = true) {
    this.reproduciendo = false;
    this.subtitulos.limpiar();
    App.emitir('narracion:fin', { id: this.idActual });

    const pendiente = this._datoPendiente;
    this._datoPendiente = null;
    if (completa && pendiente && pendiente === this.idActual) this._decirDato(pendiente);
  }

  /**
   * «Un dato más»: tras la narración, uno de los datos sueltos del cuerpo.
   *
   * Es lo que convierte el conocimiento de cada cuerpo en algo que se OYE, y
   * no solo en algo que el asistente consulta. Rota por cuerpo —el mismo no
   * vuelve hasta haberlos dicho todos— y se pide por su huella, igual que la
   * narración: api/tts.php solo encuentra datos publicados de ese cuerpo.
   */
  async _decirDato(id) {
    const datos = conocimientoEnMemoria(id)?.datos ?? [];
    if (!datos.length || this.motor === 'ninguno') return;
    if (App.preferencias.get('narracionSilenciada')) return;

    const turno = this._turnosDato.get(id) ?? 0;
    this._turnosDato.set(id, turno + 1);
    const dato = datos[turno % datos.length];

    await this.decirFrase('dato', this._turnoEntradilla('dato', this.porId.get(id)?.tipo), id);
    // Mientras sonaba la entradilla se puede haber cambiado de cuerpo, o
    // empezado otra narración: entonces este dato ya no toca.
    if (this.idActual !== id || this.reproduciendo) return;

    this.subtitulos.mostrarFrase(dato.texto, Math.max(5000, dato.texto.length * 70));
    App.emitir('conocimiento:dato', { id, dato });
    this._decirConVozDelServidor(`bodyId=${encodeURIComponent(id)}&dato=${dato.huella}`, dato.texto);
  }

  /** Interrupción inmediata, con un fundido muy corto para que no chasquee. */
  detener() {
    // Quien corta la narración no quiere que siga un dato detrás.
    this._datoPendiente = null;
    this._cortarFrase();
    if (this._locucion) {
      window.speechSynthesis?.cancel();
      this._locucion = null;
    }

    if (!this.audio.paused) {
      this._fundir(0, FUNDIDO_SALIDA, () => {
        this.audio.pause();
        this.audio.currentTime = 0;
      });
    }

    this.reproduciendo = false;
    this.subtitulos.limpiar();
  }

  /** Repite la narración del cuerpo actual desde el principio. */
  /**
   * Repite lo que se acaba de decir. La MISMA narración, no la siguiente: quien
   * pide repetir es porque no ha entendido algo, y darle otro texto distinto
   * sería exactamente lo contrario de lo que ha pedido.
   */
  repetir() {
    if (this.idActual) {
      const id = this.idActual;
      const variante = this.varianteActual ?? 0;
      this.idActual = null;
      this.narrar(id, variante);
    }
  }

  silenciar(silenciada) {
    App.preferencias.set('narracionSilenciada', silenciada);
    if (silenciada) this.detener();
  }

  establecerVolumen(volumen) {
    App.preferencias.set('volumenNarracion', Math.min(1, Math.max(0, volumen)));
  }

  /** Fundido lineal del volumen. */
  _fundir(destino, duracion, alTerminar) {
    if (this._fundido) clearInterval(this._fundido);

    const inicio = this.audio.volume;
    const arranque = performance.now();

    this._fundido = setInterval(() => {
      const t = Math.min(1, (performance.now() - arranque) / duracion);
      this.audio.volume = inicio + (destino - inicio) * t;
      if (t >= 1) {
        clearInterval(this._fundido);
        this._fundido = null;
        alTerminar?.();
      }
    }, 16);
  }

  destruir() {
    this.detener();
    this.audio.removeEventListener('ended', this._alTerminar);
    this.audio.removeEventListener('error', this._alFallar);
    this.audio.removeEventListener('timeupdate', this._alActualizarTiempo);
    this.audio.src = '';
    for (const elemento of this.precargas.values()) elemento.src = '';
    this.precargas.clear();
    log('Narrador destruido.');
  }
}
