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
      if (l.cod === item.cod && l.pres === item.pres && l.precio === item.precio) {
        l.cant += item.cant;
        return carrito;
      }
    }
    // u: unidades base de la presentacion, para descontar del inventario.
    carrito.push({ cod: item.cod, nombre: item.nombre, pres: item.pres, u: item.u,
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
    if (r.base) lineas.push("Base: " + pesos(r.base));
    lineas.push("Gastos: " + pesos(r.totalGastos));
    lineas.push("Efectivo esperado: " + pesos(r.efectivoEsperado));
    if (contado !== null && contado !== undefined) {
      var dif = contado - r.efectivoEsperado;
      lineas.push("Efectivo contado: " + pesos(contado));
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
      (obj.movimientos === undefined || Array.isArray(obj.movimientos));
  }

  // Lo que se agrego despues (el inventario) puede faltar en datos guardados
  // antes de que existiera. Se completa aqui y no en cada lugar que lo lee.
  function normalizar(obj) {
    if (!obj.movimientos) obj.movimientos = [];
    if (typeof obj.siguienteSec !== "number") obj.siguienteSec = 1;
    if (obj.ultimoRespaldo === undefined) obj.ultimoRespaldo = null;
    return obj;
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
  // ===================================================================

  var MOTIVOS_SALIDA = ["Rotura", "Vencimiento", "Regalo o consumo", "Se llevó a otro sitio"];

  function presVenta(producto) {
    return producto.pres.filter(function (p) { return p.venta; });
  }

  // Todas sirven para escribir una cantidad, se vendan o no: la codorniz se
  // compra por cajas, pero una rotura se cuenta en huevos sueltos.
  function presCantidad(producto) {
    return producto.pres.slice().sort(function (a, b) { return a.u - b.u; });
  }

  function nombreCorto(nombre) {
    var partes = nombre.split(" ");
    return partes.length > 1 ? partes[partes.length - 1] : nombre.toLowerCase() + "s";
  }

  // El stock como lo cuenta la persona. Es texto_conteo de src/web/app.py:
  // 275 huevos -> "9 cubetas + 5".
  function textoConteo(producto, unidades) {
    if (unidades < 0) return "-" + textoConteo(producto, -unidades);
    var conteo = null;
    producto.pres.forEach(function (p) { if (!conteo && p.conteo) conteo = p; });
    if (!conteo) {
      var vendibles = presVenta(producto);
      if (!vendibles.length) vendibles = producto.pres;
      vendibles.forEach(function (p) { if (!conteo || p.u > conteo.u) conteo = p; });
    }
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

  // Casillas escritas ({ "Cubeta": 2, "Unidad": 5 }) a unidades base.
  function unidadesDeCasillas(producto, casillas) {
    var total = 0;
    producto.pres.forEach(function (p) { total += (casillas[p.nombre] || 0) * p.u; });
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
  function eventosInventario(datos) {
    var eventos = [];
    datos.ventas.forEach(function (v) {
      if (v.anulada) return;
      v.items.forEach(function (it) {
        eventos.push({ fecha: v.fecha, sec: v.sec || 0, cod: it.cod, tipo: "venta", unidades: it.cant * it.u });
      });
    });
    (datos.movimientos || []).forEach(function (m) {
      if (!m.anulado) eventos.push({ fecha: m.fecha, sec: m.sec || 0, cod: m.cod, tipo: m.tipo, unidades: m.unidades });
    });
    eventos.sort(function (a, b) {
      return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.sec - b.sec;
    });
    return eventos;
  }

  // Por producto: con cuanto amanecio, que entro, que se vendio, que salio,
  // cuanto ajusto el conteo y con cuanto cerro ese dia.
  function inventarioDia(datos, fecha) {
    var res = {};
    function de(cod) {
      if (!res[cod]) res[cod] = { inicial: 0, entro: 0, vendido: 0, salio: 0, ajuste: 0, final: 0, movio: false };
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
    });
    return res;
  }

  function textoInventario(productos, inv, fecha) {
    var lineas = ["*Inventario " + fecha + "*"];
    productos.forEach(function (p) {
      var r = inv[p.cod];
      if (!r || (!r.movio && r.final === 0)) return;
      var t = function (n) { return textoConteo(p, n); };
      var detalle = [];
      if (r.vendido) detalle.push("vendido " + t(r.vendido));
      if (r.entro) detalle.push("entró " + t(r.entro));
      if (r.salio) detalle.push("salió " + t(r.salio));
      if (r.ajuste) detalle.push("ajuste " + (r.ajuste > 0 ? "+" : "") + t(r.ajuste));
      lineas.push(p.nombre + ": " + t(r.final) + (detalle.length ? " (" + detalle.join(", ") + ")" : ""));
    });
    return lineas.length > 1 ? lineas.join("\n") : "";
  }

  var Logica = {
    MEDIOS_PAGO: MEDIOS_PAGO, BILLETES: BILLETES,
    fechaLocal: fechaLocal, horaLocal: horaLocal, pesos: pesos,
    agregarAlCarrito: agregarAlCarrito, totalCarrito: totalCarrito, cambio: cambio,
    resumenDia: resumenDia, textoCierre: textoCierre, csvDia: csvDia,
    respaldoValido: respaldoValido, normalizar: normalizar, siguienteSec: siguienteSec,
    MOTIVOS_SALIDA: MOTIVOS_SALIDA, presVenta: presVenta, presCantidad: presCantidad,
    textoConteo: textoConteo, unidadesDeCasillas: unidadesDeCasillas,
    inventarioDia: inventarioDia, textoInventario: textoInventario
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Logica;
  else raiz.Logica = Logica;
})(this);
