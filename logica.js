/*
 * Las cuentas de la app del celular, sin nada de pantalla.
 *
 * Estan aparte de index.html para que herramientas/probar_movil.py las pueda
 * correr con Node y comprobar que el cierre suma bien sin abrir un navegador.
 * Todo va en pesos enteros: no hay centavos, asi que no hay errores de coma.
 *
 * Las reglas son las mismas del programa de escritorio (cierre_caja en
 * src/web/app.py): una venta anulada no suma, un gasto anulado no resta, y en
 * el cajon solo cuenta el efectivo, porque Nequi y Daviplata estan en el banco.
 */
(function (raiz) {
  "use strict";

  var MEDIOS_PAGO = ["Efectivo", "Nequi", "Daviplata"];
  var BILLETES = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

  function dosDigitos(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // La fecha del dia en hora del celular, no en UTC: a las 8 de la noche en
  // Colombia ya es el dia siguiente en UTC, y la venta caeria en otro cierre.
  function fechaLocal(d) {
    return d.getFullYear() + "-" + dosDigitos(d.getMonth() + 1) + "-" + dosDigitos(d.getDate());
  }

  function horaLocal(d) {
    return dosDigitos(d.getHours()) + ":" + dosDigitos(d.getMinutes());
  }

  function pesos(valor) {
    var n = Math.round(valor || 0);
    var signo = n < 0 ? "-" : "";
    var texto = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return signo + "$" + texto;
  }

  // La misma presentacion al mismo precio se suma en una sola linea. Si el
  // precio se cambio a mano (un descuento), queda en una linea aparte para que
  // el detalle diga la verdad sobre a cuanto se vendio cada cosa.
  function agregarAlCarrito(carrito, item) {
    for (var i = 0; i < carrito.length; i++) {
      var l = carrito[i];
      if (l.cod === item.cod && l.pres === item.pres && l.pid === item.pid && l.precio === item.precio) {
        l.cant += item.cant;
        return carrito;
      }
    }
    // u: unidades base de la presentacion, para descontar del inventario.
    // pid: la llave de la presentacion (idPres), para el inventario de los
    // productos que se cuentan por presentacion.
    carrito.push({ cod: item.cod, nombre: item.nombre, pres: item.pres, pid: item.pid, u: item.u,
                   cant: item.cant, precio: item.precio });
    return carrito;
  }

  function totalCarrito(carrito) {
    var total = 0;
    for (var i = 0; i < carrito.length; i++) total += carrito[i].cant * carrito[i].precio;
    return total;
  }

  // Lo que hay que devolver. null si lo recibido no alcanza: la pantalla no
  // deja registrar una venta en efectivo pagada a medias.
  function cambio(total, recibido) {
    return recibido >= total ? recibido - total : null;
  }

  function delDia(lista, fecha) {
    return lista.filter(function (x) { return x.fecha.slice(0, 10) === fecha; });
  }

  function resumenDia(ventas, gastos, fecha, base) {
    var porMedio = {};
    MEDIOS_PAGO.forEach(function (m) { porMedio[m] = 0; });
    var productos = {};
    var orden = [];
    var num = 0;

    delDia(ventas, fecha).forEach(function (v) {
      if (v.anulada) return;
      num++;
      porMedio[v.medio] = (porMedio[v.medio] || 0) + v.total;
      v.items.forEach(function (it) {
        var llave = it.cod + "|" + it.pres;
        if (!productos[llave]) {
          productos[llave] = { nombre: it.nombre, pres: it.pres, cant: 0, total: 0 };
          orden.push(llave);
        }
        productos[llave].cant += it.cant;
        productos[llave].total += it.cant * it.precio;
      });
    });

    var totalGastos = 0;
    delDia(gastos, fecha).forEach(function (g) { if (!g.anulado) totalGastos += g.valor; });

    var totalVendido = 0;
    Object.keys(porMedio).forEach(function (m) { totalVendido += porMedio[m]; });

    var porProducto = orden.map(function (k) { return productos[k]; });
    porProducto.sort(function (a, b) { return b.total - a.total; });

    return {
      fecha: fecha,
      num: num,
      porMedio: porMedio,
      totalVendido: totalVendido,
      totalGastos: totalGastos,
      base: base || 0,
      efectivoEsperado: (base || 0) + porMedio.Efectivo - totalGastos,
      porProducto: porProducto
    };
  }

  // El resumen que se manda por WhatsApp. Texto plano a proposito: se lee
  // igual en cualquier celular y se puede reenviar sin que se desarme.
  function textoCierre(r, contado) {
    var lineas = [
      "*Cierre de caja " + r.fecha + "*",
      "Ventas: " + r.num,
      ""
    ];
    MEDIOS_PAGO.forEach(function (m) { lineas.push(m + ": " + pesos(r.porMedio[m])); });
    lineas.push("*Total vendido: " + pesos(r.totalVendido) + "*");
    lineas.push("");
    // La base se queda siempre en el cajon para abrir el dia siguiente. A
    // quien recibe el cierre le interesa lo que se hizo, asi que el esperado
    // y el contado van SIN la base. La diferencia es la misma con o sin ella.
    lineas.push("Gastos: " + pesos(r.totalGastos));
    lineas.push("Efectivo esperado: " + pesos(r.efectivoEsperado - r.base));
    if (contado !== null && contado !== undefined) {
      var dif = contado - r.efectivoEsperado;
      lineas.push("Efectivo contado: " + pesos(contado - r.base));
      lineas.push(dif === 0 ? "Caja cuadrada" : (dif > 0 ? "Sobra: " : "Falta: ") + pesos(Math.abs(dif)));
    }
    if (r.porProducto.length) {
      lineas.push("");
      lineas.push("*Vendido*");
      r.porProducto.forEach(function (p) {
        lineas.push(p.cant + " x " + p.nombre + " (" + p.pres + "): " + pesos(p.total));
      });
    }
    return lineas.join("\n");
  }

  function campoCsv(valor) {
    var t = String(valor);
    return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  // Una linea por producto vendido, con punto y coma porque es lo que el Excel
  // en espanol abre en columnas sin preguntar.
  function csvDia(ventas, fecha) {
    var filas = [["venta", "fecha", "hora", "medio", "producto", "presentacion",
                  "cantidad", "precio", "subtotal", "anulada"]];
    delDia(ventas, fecha).forEach(function (v) {
      v.items.forEach(function (it) {
        filas.push([v.num, v.fecha.slice(0, 10), v.fecha.slice(11, 16), v.medio,
                    it.nombre, it.pres, it.cant, it.precio, it.cant * it.precio,
                    v.anulada ? "SI" : "NO"]);
      });
    });
    return filas.map(function (f) { return f.map(campoCsv).join(";"); }).join("\r\n");
  }

  // Un respaldo que se va a cargar encima de todo lo que hay tiene que tener
  // la forma correcta. Si no, se rechaza entero en vez de cargar la mitad.
  function respaldoValido(obj) {
    return !!obj && obj.app === "pos-movil" &&
      Array.isArray(obj.ventas) && Array.isArray(obj.gastos) &&
      typeof obj.bases === "object" && obj.bases !== null &&
      typeof obj.siguienteNum === "number" &&
      (obj.movimientos === undefined || Array.isArray(obj.movimientos)) &&
      (obj.precios === undefined || (typeof obj.precios === "object" && obj.precios !== null)) &&
      (obj.productos === undefined || Array.isArray(obj.productos)) &&
      (obj.cambiosCatalogo === undefined || (typeof obj.cambiosCatalogo === "object" && obj.cambiosCatalogo !== null));
  }

  // Lo que se agrego despues (el inventario) puede faltar en datos guardados
  // antes de que existiera. Se completa aqui y no en cada lugar que lo lee.
  function normalizar(obj) {
    if (!obj.movimientos) obj.movimientos = [];
    if (typeof obj.siguienteSec !== "number") obj.siguienteSec = 1;
    if (!obj.precios) obj.precios = {};
    if (!obj.productos) obj.productos = [];
    if (!obj.cambiosCatalogo) obj.cambiosCatalogo = {};
    if (obj.ultimoRespaldo === undefined) obj.ultimoRespaldo = null;
    return obj;
  }

  // ===================================================================
  // PRECIOS CAMBIADOS EN EL CELULAR
  //
  // En la tienda cambian los precios de una semana a otra, y alla no hay
  // computador para volver a generar catalogo.js. Por eso el celular guarda
  // sus propios precios ENCIMA del catalogo: solo los que se cambiaron, con
  // la llave "codigo|presentacion". El catalogo queda como el precio
  // "original", y volver a el es borrar la llave.
  //
  // El precio cambiado manda siempre, aunque despues se publique un catalogo
  // nuevo: lo ultimo que se decidio en la tienda es lo que se cobra.
  // ===================================================================

  function llavePrecio(producto, pres) {
    return producto.cod + "|" + pres.nombre;
  }

  function precioDe(precios, producto, pres) {
    var k = llavePrecio(producto, pres);
    return Object.prototype.hasOwnProperty.call(precios, k) ? precios[k] : pres.precio;
  }

  // nuevo = null, o igual al del catalogo, vuelve al precio original.
  function cambiarPrecio(precios, producto, pres, nuevo) {
    var k = llavePrecio(producto, pres);
    if (nuevo === null || nuevo === pres.precio) delete precios[k];
    else precios[k] = nuevo;
    return precios;
  }

  function precioCambiado(precios, producto, pres) {
    return Object.prototype.hasOwnProperty.call(precios, llavePrecio(producto, pres));
  }

  // ===================================================================
  // PRODUCTOS CREADOS EN EL CELULAR
  //
  // A la tienda llegan productos nuevos para probar, y alla no hay computador.
  // Igual que los precios, se guardan en el celular (datos.productos) y se
  // suman al catalogo al leerlo. Sus ventas e inventario funcionan igual que
  // los del catalogo, porque todo va por el codigo.
  //
  // - El codigo es "CEL1", "CEL2"...: un prefijo que el catalogo no usa, para
  //   que un producto del celular nunca se confunda con uno de la base.
  // - No se borran, se OCULTAN: un producto con ventas guardadas tiene que
  //   seguir existiendo para que el historial y el inventario se lean bien.
  // - Contando suelto, se muestra en su presentacion mas pequena.
  //
  // Las presentaciones de cualquier producto se pueden cambiar despues. Las
  // de los del catalogo se guardan en datos.cambiosCatalogo encima de
  // catalogo.js, como los precios: lo decidido en la tienda manda.
  // ===================================================================

  function unirProductos(catalogo, propios, cambios) {
    cambios = cambios || {};
    var base = catalogo.map(function (p) {
      var c = cambios[p.cod];
      return c ? { cod: p.cod, cat: p.cat, nombre: p.nombre, pres: c.pres, porPres: c.porPres, cambiado: true } : p;
    });
    var cats = [];
    base.concat(propios).forEach(function (p) { if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
    var propiosOrdenados = propios.slice().sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; });
    var todos = [];
    cats.forEach(function (c) {
      base.forEach(function (p) { if (p.cat === c) todos.push(p); });
      propiosOrdenados.forEach(function (p) { if (p.cat === c) todos.push(p); });
    });
    return todos;
  }

  function normalizarTexto(t) {
    return String(t || "").trim().replace(/\s+/g, " ");
  }

  // pres = [{nombre, u, precio}] como se escribieron. Una sin precio no se
  // vende y solo sirve para escribir cantidades (como la torre de huevos),
  // pero al menos una se tiene que poder vender.
  function validarPresentaciones(pres) {
    if (!pres.length) return "Agregue al menos una presentación.";
    var vistos = {};
    for (var j = 0; j < pres.length; j++) {
      var pr = pres[j];
      var n = normalizarTexto(pr.nombre);
      if (!n) return "A una presentación le falta el nombre.";
      if (vistos[n.toLowerCase()]) return "La presentación " + n + " está repetida.";
      vistos[n.toLowerCase()] = true;
      if (!(pr.u >= 1) || Math.floor(pr.u) !== pr.u) return "Las unidades de " + n + " deben ser un número entero (1 o más).";
    }
    if (!pres.some(function (x) { return x.precio > 0; })) return "Falta el precio de " + normalizarTexto(pres[0].nombre) + ".";
    return null;
  }

  // nuevo = { nombre, cat, pres: [{nombre, u, precio}] }. Devuelve el
  // problema en palabras, o null si esta bien.
  function validarProducto(todos, nuevo) {
    var nombre = normalizarTexto(nuevo.nombre).toUpperCase();
    if (!nombre) return "Escriba el nombre del producto.";
    if (!normalizarTexto(nuevo.cat)) return "Escoja o escriba la categoría.";
    for (var i = 0; i < todos.length; i++) {
      if (todos[i].nombre.toUpperCase() === nombre) return "Ya existe un producto llamado " + nombre + ".";
    }
    return validarPresentaciones(nuevo.pres);
  }

  // Las filas del formulario ({id?, nombre, u, precio}) a presentaciones.
  // Una fila que viene de una presentacion que ya existia trae su id y lo
  // conserva aunque le cambien el nombre: es la llave de su inventario. Una
  // nueva toma su nombre como id (con "#2" si ese id ya lo tiene otra).
  function armarPresentaciones(anteriores, filas) {
    var viejas = {};
    anteriores.forEach(function (pr) { viejas[idPres(pr)] = pr; });
    var usados = {};
    filas.forEach(function (f) { if (f.id && viejas[f.id]) usados[f.id] = true; });
    var pres = filas.map(function (f) {
      var nombre = normalizarTexto(f.nombre);
      var vieja = f.id ? viejas[f.id] : null;
      var id = f.id;
      if (!vieja) {
        id = nombre;
        for (var n = 2; usados[id]; n++) id = nombre + "#" + n;
        usados[id] = true;
      }
      return { id: id, nombre: nombre, u: f.u, precio: f.precio, venta: f.precio > 0,
               conteo: !!(vieja && vieja.conteo) };
    }).sort(function (a, b) { return a.u - b.u; });
    if (!pres.some(function (pr) { return pr.conteo; })) pres[0].conteo = true;
    return pres;
  }

  function crearProducto(datos, nuevo) {
    var mayor = 0;
    datos.productos.forEach(function (p) { mayor = Math.max(mayor, parseInt(p.cod.slice(3), 10) || 0); });
    var producto = { cod: "CEL" + (mayor + 1), cat: normalizarTexto(nuevo.cat).toUpperCase(),
                     nombre: normalizarTexto(nuevo.nombre).toUpperCase(),
                     pres: armarPresentaciones([], nuevo.pres), propio: true, oculto: false };
    if (typeof nuevo.porPres === "boolean") producto.porPres = nuevo.porPres;
    datos.productos.push(producto);
    return producto;
  }

  // cambio = { pres: filas del formulario, porPres }. Los del celular se
  // cambian en su sitio; los del catalogo van a datos.cambiosCatalogo. Los
  // precios del formulario quedan como los de cada presentacion, asi que los
  // cambiados sueltos de ese producto (datos.precios) se borran: si no,
  // taparian lo que se acaba de escribir.
  function editarPresentaciones(datos, producto, cambio) {
    var pres = armarPresentaciones(producto.pres, cambio.pres);
    if (producto.propio) {
      datos.productos.forEach(function (p) {
        if (p.cod === producto.cod) { p.pres = pres; p.porPres = cambio.porPres; }
      });
    } else {
      datos.cambiosCatalogo[producto.cod] = { pres: pres, porPres: cambio.porPres };
    }
    Object.keys(datos.precios).forEach(function (k) {
      if (k.indexOf(producto.cod + "|") === 0) delete datos.precios[k];
    });
    return pres;
  }

  // ===================================================================
  // INVENTARIO
  //
  // Igual que en el escritorio, todo se guarda en UNIDADES BASE: una cubeta
  // son 30 huevos, una libra de cafe son 4 cuartos. Las presentaciones solo
  // sirven para escribir y para leer cantidades.
  //
  // El stock no se guarda: se calcula repasando lo que paso, en orden. Asi
  // una venta anulada devuelve su mercancia sola, sin que nadie tenga que
  // acordarse de devolverla, y el numero nunca queda distinto de la historia.
  //
  // Un CONTEO no suma ni resta: dice "aqui hay tanto". La diferencia con lo
  // que el sistema creia es el AJUSTE, que es lo que se perdio o aparecio sin
  // que nadie lo anotara.
  //
  // POR PRESENTACION. Las unidades base sirven para los huevos, porque la
  // media cubeta se arma con huevos de una cubeta. Pero el cafe viene en
  // bolsas ya empacadas: 6 cuartos no son una libra y media, son 6 bolsas
  // de cuarto. Esos productos llevan ADEMAS la cuenta de cada presentacion
  // (r.pres), que es la que se muestra. Cada venta y cada movimiento guardan
  // el detalle por presentacion para poder llevarla.
  // ===================================================================

  var MOTIVOS_SALIDA = ["Rotura", "Vencimiento", "Regalo o consumo", "Se llevó a otro sitio"];

  function presVenta(producto) {
    return producto.pres.filter(function (p) { return p.venta; });
  }

  // La llave con que se lleva el inventario de una presentacion. Las del
  // catalogo no traen id y usan su nombre; las editadas en el celular
  // conservan su id aunque cambie el nombre, para no perder lo contado.
  function idPres(pr) {
    return pr.id || pr.nombre;
  }

  // Si el producto no lo dice (el catalogo no trae esa marca), se cuenta por
  // presentacion cuando tiene varias de venta y ninguna es cubeta.
  function porPresentacion(producto) {
    if (typeof producto.porPres === "boolean") return producto.porPres;
    return presVenta(producto).length > 1 &&
      !producto.pres.some(function (p) { return /cubeta/i.test(p.nombre); });
  }

  // Las casillas para escribir una cantidad, de la mas pequena a la mas
  // grande. Contando suelto sirven todas, se vendan o no: llegan torres de
  // huevos aunque la torre no se venda. Por presentacion, solo las de venta:
  // de una arroba de cafe no se sabe en que bolsas va a quedar.
  function presParaContar(producto) {
    var lista = producto.pres;
    if (porPresentacion(producto) && presVenta(producto).length) lista = presVenta(producto);
    return lista.slice().sort(function (a, b) { return a.u - b.u; });
  }

  function nombreCorto(nombre) {
    var partes = nombre.split(" ");
    return partes.length > 1 ? partes[partes.length - 1] : nombre.toLowerCase() + "s";
  }

  // En la que se muestra el stock contado suelto: la marcada para conteo o,
  // si ninguna lo esta, la de venta mas grande.
  function presConteo(producto) {
    var conteo = null;
    producto.pres.forEach(function (p) { if (!conteo && p.conteo) conteo = p; });
    if (!conteo) {
      var vendibles = presVenta(producto);
      if (!vendibles.length) vendibles = producto.pres;
      vendibles.forEach(function (p) { if (!conteo || p.u > conteo.u) conteo = p; });
    }
    return conteo;
  }

  // El stock como lo cuenta la persona. Es texto_conteo de src/web/app.py:
  // 275 huevos -> "9 cubetas + 5".
  function textoConteo(producto, unidades) {
    if (unidades < 0) return "-" + textoConteo(producto, -unidades);
    var conteo = presConteo(producto);
    if (!conteo) return unidades + " u";
    if (conteo.u <= 1) {
      return conteo.nombre.toLowerCase().indexOf("unidad") === 0
        ? unidades + " u" : unidades + " " + nombreCorto(conteo.nombre);
    }
    var enteros = Math.floor(unidades / conteo.u);
    var resto = unidades % conteo.u;
    var etiqueta = nombreCorto(conteo.nombre);
    if (enteros && resto) return enteros + " " + etiqueta + " + " + resto;
    if (enteros) return enteros + " " + etiqueta;
    return resto + " u";
  }

  // Casillas escritas ({ "Cubeta": 2, "Unidad": 5 }, por idPres) a unidades base.
  function unidadesDeCasillas(producto, casillas) {
    var total = 0;
    producto.pres.forEach(function (p) { total += (casillas[idPres(p)] || 0) * p.u; });
    return total;
  }

  // El numero de orden que lleva cada venta y cada movimiento al crearse.
  // Es el que desempata dos registros del mismo segundo: contar y vender en
  // el mismo segundo no puede depender de cual lista se repasa primero, o el
  // conteo quedaria "despues" de una venta que paso despues de el.
  function siguienteSec(datos) {
    return datos.siguienteSec++;
  }

  // Todo lo que movio mercancia, en el orden en que paso. La fecha va como
  // "AAAA-MM-DD HH:MM:SS", que ordenada como texto queda en orden de tiempo.
  // detalle: cuanto de cada presentacion (por idPres). Una venta vieja sin
  // pid usa el nombre, que era su id; un movimiento viejo no lo tiene.
  function eventosInventario(datos) {
    var eventos = [];
    datos.ventas.forEach(function (v) {
      if (v.anulada) return;
      v.items.forEach(function (it) {
        var detalle = {};
        detalle[it.pid || it.pres] = it.cant;
        eventos.push({ fecha: v.fecha, sec: v.sec || 0, cod: it.cod, tipo: "venta",
                       unidades: it.cant * it.u, detalle: detalle });
      });
    });
    (datos.movimientos || []).forEach(function (m) {
      if (!m.anulado) eventos.push({ fecha: m.fecha, sec: m.sec || 0, cod: m.cod, tipo: m.tipo,
                                     unidades: m.unidades, detalle: m.detalle || null });
    });
    eventos.sort(function (a, b) {
      return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.sec - b.sec;
    });
    return eventos;
  }

  // Suma en un mapa {idPres: cantidad} sin dejar ceros guardados, para que
  // "no hay nada" sea simplemente el mapa vacio.
  function sumar(mapa, k, n) {
    var v = (mapa[k] || 0) + n;
    if (v) mapa[k] = v; else delete mapa[k];
  }

  var CAMPO_DIA = { entrada: "entro", venta: "vendido", salida: "salio" };

  // Un movimiento anotado antes de que existiera el detalle solo trae el
  // total. Si el producto tiene una sola presentacion se sabe de cual es; si
  // tiene varias no, y queda fuera de la cuenta por presentacion.
  function detalleDe(producto, e) {
    if (e.detalle) return e.detalle;
    var casillas = presParaContar(producto);
    if (casillas.length !== 1) return null;
    var d = {};
    d[idPres(casillas[0])] = e.unidades / casillas[0].u;
    return d;
  }

  function moverPorPresentacion(rp, e, hoy, producto) {
    var det = detalleDe(producto, e);
    if (!det) return;
    if (e.tipo === "conteo") {
      // Lo que no se escribio en el conteo es que no hay.
      var nuevo = {};
      Object.keys(det).forEach(function (k) { sumar(nuevo, k, det[k]); });
      if (hoy) {
        var dif = {};
        Object.keys(nuevo).forEach(function (k) { sumar(dif, k, nuevo[k]); });
        Object.keys(rp.final).forEach(function (k) { sumar(dif, k, -rp.final[k]); });
        Object.keys(dif).forEach(function (k) { sumar(rp.ajuste, k, dif[k]); });
      }
      rp.final = nuevo;
    } else {
      var signo = e.tipo === "entrada" ? 1 : -1;
      Object.keys(det).forEach(function (k) {
        sumar(rp.final, k, signo * det[k]);
        if (hoy) sumar(rp[CAMPO_DIA[e.tipo]], k, det[k]);
      });
    }
  }

  // Por producto: con cuanto amanecio, que entro, que se vendio, que salio,
  // cuanto ajusto el conteo y con cuanto cerro ese dia. Con la lista de
  // productos, los que se cuentan por presentacion traen ademas r.pres.
  function inventarioDia(datos, fecha, productos) {
    var porCod = {};
    (productos || []).forEach(function (p) { porCod[p.cod] = p; });
    var res = {};
    function de(cod) {
      if (!res[cod]) {
        res[cod] = { inicial: 0, entro: 0, vendido: 0, salio: 0, ajuste: 0, final: 0, movio: false };
        if (porCod[cod] && porPresentacion(porCod[cod])) {
          res[cod].pres = { entro: {}, vendido: {}, salio: {}, ajuste: {}, final: {} };
        }
      }
      return res[cod];
    }
    eventosInventario(datos).forEach(function (e) {
      var dia = e.fecha.slice(0, 10);
      if (dia > fecha) return;
      var r = de(e.cod);
      var hoy = dia === fecha;
      if (hoy) r.movio = true;
      if (e.tipo === "conteo") {
        if (hoy) r.ajuste += e.unidades - r.final;
        r.final = e.unidades;
      } else {
        var signo = e.tipo === "entrada" ? 1 : -1;
        r.final += signo * e.unidades;
        if (hoy && e.tipo === "entrada") r.entro += e.unidades;
        if (hoy && e.tipo === "venta") r.vendido += e.unidades;
        if (hoy && e.tipo === "salida") r.salio += e.unidades;
      }
      if (!hoy) r.inicial = r.final;
      if (r.pres) moverPorPresentacion(r.pres, e, hoy, porCod[e.cod]);
    });
    return res;
  }

  // Como se escriben las presentaciones en el inventario que se manda a mano.
  var ETIQUETAS = { "libra": "LB", "media libra": "1/2", "cuarto de libra": "1/4", "kilo": "KG" };

  function etiquetaPres(nombre) {
    var n = nombre.trim().toLowerCase();
    var paquete = /^paquete\s*x\s*(\d+)$/.exec(n);
    return ETIQUETAS[n] || (paquete ? "X" + paquete[1] : nombre);
  }

  // Una fila por presentacion, de la mas grande a la mas pequena, mas las
  // que ya no existen pero aun tienen algo (se quito la presentacion con
  // mercancia contada): eso no se esconde, se ve hasta el proximo conteo.
  function filasPorPresentacion(producto, mapa) {
    var filas = [];
    var vistas = {};
    presParaContar(producto).slice().reverse().forEach(function (pr) {
      vistas[idPres(pr)] = true;
      filas.push({ etiqueta: etiquetaPres(pr.nombre), n: mapa[idPres(pr)] || 0 });
    });
    Object.keys(mapa).forEach(function (k) {
      if (vistas[k] || !mapa[k]) return;
      var nombre = k.replace(/#\d+$/, "");
      producto.pres.forEach(function (pr) { if (idPres(pr) === k) nombre = pr.nombre; });
      filas.push({ etiqueta: etiquetaPres(nombre), n: mapa[k] });
    });
    return filas;
  }

  // Para la pantalla: "LB 2 · 1/4 6", solo lo que no es cero.
  function textoMapa(producto, mapa, conSigno) {
    var partes = filasPorPresentacion(producto, mapa).filter(function (f) { return f.n; }).map(function (f) {
      return f.etiqueta + " " + (conSigno && f.n > 0 ? "+" : "") + f.n;
    });
    return partes.length ? partes.join(" · ") : "0";
  }

  function textoStock(producto, r) {
    return r.pres ? textoMapa(producto, r.pres.final) : textoConteo(producto, r.final);
  }

  function stockNegativo(r) {
    if (!r.pres) return r.final < 0;
    return Object.keys(r.pres.final).some(function (k) { return r.pres.final[k] < 0; });
  }

  // Lo que paso ese dia, para la pantalla: ["vendido 2 cubetas", "ajuste -5 u"].
  function detalleDia(producto, r) {
    var hay = function (campo) { return r.pres ? Object.keys(r.pres[campo]).length > 0 : r[campo] !== 0; };
    var t = function (campo, conSigno) {
      return r.pres ? textoMapa(producto, r.pres[campo], conSigno)
        : (conSigno && r[campo] > 0 ? "+" : "") + textoConteo(producto, r[campo]);
    };
    var detalle = [];
    if (hay("vendido")) detalle.push("vendido " + t("vendido"));
    if (hay("entro")) detalle.push("entró " + t("entro"));
    if (hay("salio")) detalle.push("salió " + t("salio"));
    if (hay("ajuste")) detalle.push("ajuste " + t("ajuste", true));
    return detalle;
  }

  function textoMovimiento(producto, m) {
    return porPresentacion(producto) && m.detalle ? textoMapa(producto, m.detalle) : textoConteo(producto, m.unidades);
  }

  // Un conteo escrito (casillas) frente a lo que decia el celular, por
  // presentacion: {idPres: diferencia}, vacio si cuadra.
  function diferenciaConteo(r, casillas) {
    var dif = {};
    Object.keys(casillas).forEach(function (k) { sumar(dif, k, casillas[k]); });
    Object.keys(r.pres.final).forEach(function (k) { sumar(dif, k, -r.pres.final[k]); });
    return dif;
  }

  // Contado suelto, como se escribe a mano: "45q - 16u" (cubetas y huevos
  // sueltos). La media cubeta no sale: es media cubeta de huevos sueltos.
  // Si solo se vende en esa presentacion (el cafe premium, en libras) va el
  // numero solo: "3", no "3 LB".
  function textoSuelto(producto, unidades) {
    if (unidades < 0) return "-" + textoSuelto(producto, -unidades);
    var conteo = presConteo(producto);
    if (!conteo || conteo.u <= 1) return String(unidades);
    var enteros = Math.floor(unidades / conteo.u);
    var resto = unidades % conteo.u;
    var etiqueta = /cubeta/i.test(conteo.nombre) ? "q"
      : presVenta(producto).length > 1 ? " " + etiquetaPres(conteo.nombre) : "";
    var partes = [];
    if (enteros) partes.push(enteros + etiqueta);
    if (resto) partes.push(resto + "u");
    return partes.length ? partes.join(" - ") : "0";
  }

  // "TIPO AA CRIOLLO" -> "Tipo AA criollo". Se dejan en mayuscula las
  // palabras cortas (A, AA, LB, KG) y las que llevan numeros (1/2LB).
  var PALABRAS_MINUSCULA = ["DE", "LA", "EL", "EN", "Y"];

  function nombreBonito(nombre) {
    return nombre.split(" ").map(function (w, i) {
      if (/\d/.test(w) || (/^[A-ZÑ]{1,2}$/.test(w) && PALABRAS_MINUSCULA.indexOf(w) < 0)) return w;
      var min = w.toLowerCase();
      return i === 0 ? min.charAt(0).toUpperCase() + min.slice(1) : min;
    }).join(" ");
  }

  // Lo que va despues del "=", o una fila por presentacion si tiene varias.
  function valorInventario(producto, r) {
    if (!r.pres) return { valor: textoSuelto(producto, r.final) };
    var filas = filasPorPresentacion(producto, r.pres.final);
    return filas.length === 1 ? { valor: String(filas[0].n) } : { filas: filas };
  }

  // El inventario que se manda por WhatsApp: SOLO con cuanto hay, en el
  // formato en que se mandaba a mano. Lo vendido y los ajustes se ven en la
  // pantalla; a quien lo recibe le interesa lo que queda.
  //
  //   Tipo A               "X" y "X CRIOLLO" van juntos
  //   Normal = 45q - 16u
  //   Criollo = 3u
  //   Leche = 7            una sola presentacion
  //   Cafe dorado          una fila por presentacion
  //   LB = 0
  //   1/4 = 6
  //
  // Sale todo lo que ya tiene inventario aunque este en cero: el cero dice
  // que se acabo. Lo que nunca se ha contado ni movido no sale, porque un
  // cero ahi haria creer que no hay. Cada categoria va separada.
  function textoInventario(productos, inv, fecha) {
    var visibles = productos.filter(function (p) { return !p.oculto; });
    var porNombre = {};
    visibles.forEach(function (p) { porNombre[p.nombre] = p; });
    var valor = function (p) { return p && inv[p.cod] ? valorInventario(p, inv[p.cod]) : null; };
    var lineas = [];
    var hecho = {};
    var catActual = null;
    visibles.forEach(function (p) {
      if (hecho[p.cod]) return;
      var normal = / CRIOLLO$/.test(p.nombre) && porNombre[p.nombre.replace(/ CRIOLLO$/, "")] || p;
      var criollo = porNombre[normal.nombre + " CRIOLLO"];
      var a = valor(normal), b = valor(criollo);
      var bloque = [];
      if (criollo && (!a || a.valor) && (!b || b.valor)) {
        hecho[normal.cod] = hecho[criollo.cod] = true;
        if (a || b) bloque.push(nombreBonito(normal.nombre));
        if (a) bloque.push("Normal = " + a.valor);
        if (b) bloque.push("Criollo = " + b.valor);
      } else {
        hecho[p.cod] = true;
        var v = valor(p);
        if (v && v.valor) bloque.push(nombreBonito(p.nombre) + " = " + v.valor);
        else if (v) {
          bloque.push(nombreBonito(p.nombre));
          v.filas.forEach(function (f) { bloque.push(f.etiqueta + " = " + f.n); });
        }
      }
      if (!bloque.length) return;
      if (catActual !== null && p.cat !== catActual) lineas.push("");
      catActual = p.cat;
      lineas = lineas.concat(bloque);
    });
    return lineas.length ? "*Inventario " + fecha + "*\n\n" + lineas.join("\n") : "";
  }

  var Logica = {
    MEDIOS_PAGO: MEDIOS_PAGO, BILLETES: BILLETES,
    fechaLocal: fechaLocal, horaLocal: horaLocal, pesos: pesos,
    agregarAlCarrito: agregarAlCarrito, totalCarrito: totalCarrito, cambio: cambio,
    resumenDia: resumenDia, textoCierre: textoCierre, csvDia: csvDia,
    respaldoValido: respaldoValido, normalizar: normalizar, siguienteSec: siguienteSec,
    precioDe: precioDe, cambiarPrecio: cambiarPrecio, precioCambiado: precioCambiado,
    unirProductos: unirProductos, validarProducto: validarProducto, crearProducto: crearProducto,
    validarPresentaciones: validarPresentaciones, editarPresentaciones: editarPresentaciones,
    MOTIVOS_SALIDA: MOTIVOS_SALIDA, presVenta: presVenta, idPres: idPres,
    porPresentacion: porPresentacion, presParaContar: presParaContar,
    textoConteo: textoConteo, unidadesDeCasillas: unidadesDeCasillas,
    inventarioDia: inventarioDia, textoStock: textoStock, textoMapa: textoMapa,
    stockNegativo: stockNegativo, detalleDia: detalleDia, textoMovimiento: textoMovimiento,
    diferenciaConteo: diferenciaConteo, textoInventario: textoInventario
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Logica;
  else raiz.Logica = Logica;
})(this);
