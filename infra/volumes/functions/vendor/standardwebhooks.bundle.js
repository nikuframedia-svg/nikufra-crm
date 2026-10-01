var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// deno:https://esm.sh/@stablelib/base64@1.0.1?target=denonext
var base64_1_0_exports = {};
__export(base64_1_0_exports, {
  Coder: () => N,
  URLSafeCoder: () => Y,
  __esModule: () => k,
  decode: () => V,
  decodeURLSafe: () => z,
  decodedLength: () => H,
  default: () => J,
  encode: () => T,
  encodeURLSafe: () => q,
  encodedLength: () => F,
  maxDecodedLength: () => G
});

// deno:https://esm.sh/@stablelib/base64@1.0.1/denonext/base64.mjs
var S = Object.create;
var v = Object.defineProperty;
var m = Object.getOwnPropertyDescriptor;
var B = Object.getOwnPropertyNames;
var A = Object.getPrototypeOf;
var U = Object.prototype.hasOwnProperty;
var w = (r, e) => () => (e || r((e = {
  exports: {}
}).exports, e), e.exports);
var R = (r, e, t, n) => {
  if (e && typeof e == "object" || typeof e == "function") for (let o of B(e)) !U.call(r, o) && o !== t && v(r, o, {
    get: () => e[o],
    enumerable: !(n = m(e, o)) || n.enumerable
  });
  return r;
};
var x = (r, e, t) => (t = r != null ? S(A(r)) : {}, R(e || !r || !r.__esModule ? v(t, "default", {
  value: r,
  enumerable: true
}) : t, r));
var l = w((h) => {
  "use strict";
  var D3 = h && h.__extends || /* @__PURE__ */ function() {
    var r = function(e, t) {
      return r = Object.setPrototypeOf || {
        __proto__: []
      } instanceof Array && function(n, o) {
        n.__proto__ = o;
      } || function(n, o) {
        for (var i in o) o.hasOwnProperty(i) && (n[i] = o[i]);
      }, r(e, t);
    };
    return function(e, t) {
      r(e, t);
      function n() {
        this.constructor = e;
      }
      e.prototype = t === null ? Object.create(t) : (n.prototype = t.prototype, new n());
    };
  }();
  Object.defineProperty(h, "__esModule", {
    value: true
  });
  var d = 256, C = function() {
    function r(e) {
      e === void 0 && (e = "="), this._paddingCharacter = e;
    }
    return r.prototype.encodedLength = function(e) {
      return this._paddingCharacter ? (e + 2) / 3 * 4 | 0 : (e * 8 + 5) / 6 | 0;
    }, r.prototype.encode = function(e) {
      for (var t = "", n = 0; n < e.length - 2; n += 3) {
        var o = e[n] << 16 | e[n + 1] << 8 | e[n + 2];
        t += this._encodeByte(o >>> 18 & 63), t += this._encodeByte(o >>> 12 & 63), t += this._encodeByte(o >>> 6 & 63), t += this._encodeByte(o >>> 0 & 63);
      }
      var i = e.length - n;
      if (i > 0) {
        var o = e[n] << 16 | (i === 2 ? e[n + 1] << 8 : 0);
        t += this._encodeByte(o >>> 18 & 63), t += this._encodeByte(o >>> 12 & 63), i === 2 ? t += this._encodeByte(o >>> 6 & 63) : t += this._paddingCharacter || "", t += this._paddingCharacter || "";
      }
      return t;
    }, r.prototype.maxDecodedLength = function(e) {
      return this._paddingCharacter ? e / 4 * 3 | 0 : (e * 6 + 7) / 8 | 0;
    }, r.prototype.decodedLength = function(e) {
      return this.maxDecodedLength(e.length - this._getPaddingLength(e));
    }, r.prototype.decode = function(e) {
      if (e.length === 0) return new Uint8Array(0);
      for (var t = this._getPaddingLength(e), n = e.length - t, o = new Uint8Array(this.maxDecodedLength(n)), i = 0, a = 0, c = 0, _3 = 0, u = 0, f = 0, g2 = 0; a < n - 4; a += 4) _3 = this._decodeChar(e.charCodeAt(a + 0)), u = this._decodeChar(e.charCodeAt(a + 1)), f = this._decodeChar(e.charCodeAt(a + 2)), g2 = this._decodeChar(e.charCodeAt(a + 3)), o[i++] = _3 << 2 | u >>> 4, o[i++] = u << 4 | f >>> 2, o[i++] = f << 6 | g2, c |= _3 & d, c |= u & d, c |= f & d, c |= g2 & d;
      if (a < n - 1 && (_3 = this._decodeChar(e.charCodeAt(a)), u = this._decodeChar(e.charCodeAt(a + 1)), o[i++] = _3 << 2 | u >>> 4, c |= _3 & d, c |= u & d), a < n - 2 && (f = this._decodeChar(e.charCodeAt(a + 2)), o[i++] = u << 4 | f >>> 2, c |= f & d), a < n - 3 && (g2 = this._decodeChar(e.charCodeAt(a + 3)), o[i++] = f << 6 | g2, c |= g2 & d), c !== 0) throw new Error("Base64Coder: incorrect characters for decoding");
      return o;
    }, r.prototype._encodeByte = function(e) {
      var t = e;
      return t += 65, t += 25 - e >>> 8 & 6, t += 51 - e >>> 8 & -75, t += 61 - e >>> 8 & -15, t += 62 - e >>> 8 & 3, String.fromCharCode(t);
    }, r.prototype._decodeChar = function(e) {
      var t = d;
      return t += (42 - e & e - 44) >>> 8 & -d + e - 43 + 62, t += (46 - e & e - 48) >>> 8 & -d + e - 47 + 63, t += (47 - e & e - 58) >>> 8 & -d + e - 48 + 52, t += (64 - e & e - 91) >>> 8 & -d + e - 65 + 0, t += (96 - e & e - 123) >>> 8 & -d + e - 97 + 26, t;
    }, r.prototype._getPaddingLength = function(e) {
      var t = 0;
      if (this._paddingCharacter) {
        for (var n = e.length - 1; n >= 0 && e[n] === this._paddingCharacter; n--) t++;
        if (e.length < 4 || t > 2) throw new Error("Base64Coder: incorrect padding");
      }
      return t;
    }, r;
  }();
  h.Coder = C;
  var p2 = new C();
  function P2(r) {
    return p2.encode(r);
  }
  h.encode = P2;
  function j3(r) {
    return p2.decode(r);
  }
  h.decode = j3;
  var L = function(r) {
    D3(e, r);
    function e() {
      return r !== null && r.apply(this, arguments) || this;
    }
    return e.prototype._encodeByte = function(t) {
      var n = t;
      return n += 65, n += 25 - t >>> 8 & 6, n += 51 - t >>> 8 & -75, n += 61 - t >>> 8 & -13, n += 62 - t >>> 8 & 49, String.fromCharCode(n);
    }, e.prototype._decodeChar = function(t) {
      var n = d;
      return n += (44 - t & t - 46) >>> 8 & -d + t - 45 + 62, n += (94 - t & t - 96) >>> 8 & -d + t - 95 + 63, n += (47 - t & t - 58) >>> 8 & -d + t - 48 + 52, n += (64 - t & t - 91) >>> 8 & -d + t - 65 + 0, n += (96 - t & t - 123) >>> 8 & -d + t - 97 + 26, n;
    }, e;
  }(C);
  h.URLSafeCoder = L;
  var y2 = new L();
  function O2(r) {
    return y2.encode(r);
  }
  h.encodeURLSafe = O2;
  function E(r) {
    return y2.decode(r);
  }
  h.decodeURLSafe = E;
  h.encodedLength = function(r) {
    return p2.encodedLength(r);
  };
  h.maxDecodedLength = function(r) {
    return p2.maxDecodedLength(r);
  };
  h.decodedLength = function(r) {
    return p2.decodedLength(r);
  };
});
var s = x(l());
var { __esModule: k, Coder: N, encode: T, decode: V, URLSafeCoder: Y, encodeURLSafe: q, decodeURLSafe: z, encodedLength: F, maxDecodedLength: G, decodedLength: H } = s;
var J = s.default ?? s;

// deno:https://esm.sh/fast-sha256@1.3.0?target=denonext
var fast_sha256_1_3_exports = {};
__export(fast_sha256_1_3_exports, {
  default: () => O
});

// deno:https://esm.sh/fast-sha256@1.3.0/denonext/fast-sha256.mjs
var I = Object.create;
var _ = Object.defineProperty;
var K = Object.getOwnPropertyDescriptor;
var P = Object.getOwnPropertyNames;
var q2 = Object.getPrototypeOf;
var D = Object.prototype.hasOwnProperty;
var F2 = (h, b) => () => (b || h((b = {
  exports: {}
}).exports, b), b.exports);
var G2 = (h, b, v3, p2) => {
  if (b && typeof b == "object" || typeof b == "function") for (let y2 of P(b)) !D.call(h, y2) && y2 !== v3 && _(h, y2, {
    get: () => b[y2],
    enumerable: !(p2 = K(b, y2)) || p2.enumerable
  });
  return h;
};
var J2 = (h, b, v3) => (v3 = h != null ? I(q2(h)) : {}, G2(b || !h || !h.__esModule ? _(v3, "default", {
  value: h,
  enumerable: true
}) : v3, h));
var j = F2((H3, U2) => {
  (function(h, b) {
    var v3 = {};
    b(v3);
    var p2 = v3.default;
    for (var y2 in v3) p2[y2] = v3[y2];
    typeof U2 == "object" && typeof U2.exports == "object" ? U2.exports = p2 : typeof define == "function" && define.amd ? define(function() {
      return p2;
    }) : h.sha256 = p2;
  })(H3, function(h) {
    "use strict";
    h.__esModule = true, h.digestLength = 32, h.blockSize = 64;
    var b = new Uint32Array([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]);
    function v3(f, t, e, i, u) {
      for (var s2, n, r, l3, o, a, g2, c, d, x2, w2, A2, S3; u >= 64; ) {
        for (s2 = t[0], n = t[1], r = t[2], l3 = t[3], o = t[4], a = t[5], g2 = t[6], c = t[7], x2 = 0; x2 < 16; x2++) w2 = i + x2 * 4, f[x2] = (e[w2] & 255) << 24 | (e[w2 + 1] & 255) << 16 | (e[w2 + 2] & 255) << 8 | e[w2 + 3] & 255;
        for (x2 = 16; x2 < 64; x2++) d = f[x2 - 2], A2 = (d >>> 17 | d << 15) ^ (d >>> 19 | d << 13) ^ d >>> 10, d = f[x2 - 15], S3 = (d >>> 7 | d << 25) ^ (d >>> 18 | d << 14) ^ d >>> 3, f[x2] = (A2 + f[x2 - 7] | 0) + (S3 + f[x2 - 16] | 0);
        for (x2 = 0; x2 < 64; x2++) A2 = (((o >>> 6 | o << 26) ^ (o >>> 11 | o << 21) ^ (o >>> 25 | o << 7)) + (o & a ^ ~o & g2) | 0) + (c + (b[x2] + f[x2] | 0) | 0) | 0, S3 = ((s2 >>> 2 | s2 << 30) ^ (s2 >>> 13 | s2 << 19) ^ (s2 >>> 22 | s2 << 10)) + (s2 & n ^ s2 & r ^ n & r) | 0, c = g2, g2 = a, a = o, o = l3 + A2 | 0, l3 = r, r = n, n = s2, s2 = A2 + S3 | 0;
        t[0] += s2, t[1] += n, t[2] += r, t[3] += l3, t[4] += o, t[5] += a, t[6] += g2, t[7] += c, i += 64, u -= 64;
      }
      return i;
    }
    var p2 = function() {
      function f() {
        this.digestLength = h.digestLength, this.blockSize = h.blockSize, this.state = new Int32Array(8), this.temp = new Int32Array(64), this.buffer = new Uint8Array(128), this.bufferLength = 0, this.bytesHashed = 0, this.finished = false, this.reset();
      }
      return f.prototype.reset = function() {
        return this.state[0] = 1779033703, this.state[1] = 3144134277, this.state[2] = 1013904242, this.state[3] = 2773480762, this.state[4] = 1359893119, this.state[5] = 2600822924, this.state[6] = 528734635, this.state[7] = 1541459225, this.bufferLength = 0, this.bytesHashed = 0, this.finished = false, this;
      }, f.prototype.clean = function() {
        for (var t = 0; t < this.buffer.length; t++) this.buffer[t] = 0;
        for (var t = 0; t < this.temp.length; t++) this.temp[t] = 0;
        this.reset();
      }, f.prototype.update = function(t, e) {
        if (e === void 0 && (e = t.length), this.finished) throw new Error("SHA256: can't update because hash was finished.");
        var i = 0;
        if (this.bytesHashed += e, this.bufferLength > 0) {
          for (; this.bufferLength < 64 && e > 0; ) this.buffer[this.bufferLength++] = t[i++], e--;
          this.bufferLength === 64 && (v3(this.temp, this.state, this.buffer, 0, 64), this.bufferLength = 0);
        }
        for (e >= 64 && (i = v3(this.temp, this.state, t, i, e), e %= 64); e > 0; ) this.buffer[this.bufferLength++] = t[i++], e--;
        return this;
      }, f.prototype.finish = function(t) {
        if (!this.finished) {
          var e = this.bytesHashed, i = this.bufferLength, u = e / 536870912 | 0, s2 = e << 3, n = e % 64 < 56 ? 64 : 128;
          this.buffer[i] = 128;
          for (var r = i + 1; r < n - 8; r++) this.buffer[r] = 0;
          this.buffer[n - 8] = u >>> 24 & 255, this.buffer[n - 7] = u >>> 16 & 255, this.buffer[n - 6] = u >>> 8 & 255, this.buffer[n - 5] = u >>> 0 & 255, this.buffer[n - 4] = s2 >>> 24 & 255, this.buffer[n - 3] = s2 >>> 16 & 255, this.buffer[n - 2] = s2 >>> 8 & 255, this.buffer[n - 1] = s2 >>> 0 & 255, v3(this.temp, this.state, this.buffer, 0, n), this.finished = true;
        }
        for (var r = 0; r < 8; r++) t[r * 4 + 0] = this.state[r] >>> 24 & 255, t[r * 4 + 1] = this.state[r] >>> 16 & 255, t[r * 4 + 2] = this.state[r] >>> 8 & 255, t[r * 4 + 3] = this.state[r] >>> 0 & 255;
        return this;
      }, f.prototype.digest = function() {
        var t = new Uint8Array(this.digestLength);
        return this.finish(t), t;
      }, f.prototype._saveState = function(t) {
        for (var e = 0; e < this.state.length; e++) t[e] = this.state[e];
      }, f.prototype._restoreState = function(t, e) {
        for (var i = 0; i < this.state.length; i++) this.state[i] = t[i];
        this.bytesHashed = e, this.finished = false, this.bufferLength = 0;
      }, f;
    }();
    h.Hash = p2;
    var y2 = function() {
      function f(t) {
        this.inner = new p2(), this.outer = new p2(), this.blockSize = this.inner.blockSize, this.digestLength = this.inner.digestLength;
        var e = new Uint8Array(this.blockSize);
        if (t.length > this.blockSize) new p2().update(t).finish(e).clean();
        else for (var i = 0; i < t.length; i++) e[i] = t[i];
        for (var i = 0; i < e.length; i++) e[i] ^= 54;
        this.inner.update(e);
        for (var i = 0; i < e.length; i++) e[i] ^= 106;
        this.outer.update(e), this.istate = new Uint32Array(8), this.ostate = new Uint32Array(8), this.inner._saveState(this.istate), this.outer._saveState(this.ostate);
        for (var i = 0; i < e.length; i++) e[i] = 0;
      }
      return f.prototype.reset = function() {
        return this.inner._restoreState(this.istate, this.inner.blockSize), this.outer._restoreState(this.ostate, this.outer.blockSize), this;
      }, f.prototype.clean = function() {
        for (var t = 0; t < this.istate.length; t++) this.ostate[t] = this.istate[t] = 0;
        this.inner.clean(), this.outer.clean();
      }, f.prototype.update = function(t) {
        return this.inner.update(t), this;
      }, f.prototype.finish = function(t) {
        return this.outer.finished ? this.outer.finish(t) : (this.inner.finish(t), this.outer.update(t, this.digestLength).finish(t)), this;
      }, f.prototype.digest = function() {
        var t = new Uint8Array(this.digestLength);
        return this.finish(t), t;
      }, f;
    }();
    h.HMAC = y2;
    function k2(f) {
      var t = new p2().update(f), e = t.digest();
      return t.clean(), e;
    }
    h.hash = k2, h.default = k2;
    function z2(f, t) {
      var e = new y2(f).update(t), i = e.digest();
      return e.clean(), i;
    }
    h.hmac = z2;
    function M2(f, t, e, i) {
      var u = i[0];
      if (u === 0) throw new Error("hkdf: cannot expand more");
      t.reset(), u > 1 && t.update(f), e && t.update(e), t.update(i), t.finish(f), i[0]++;
    }
    var C = new Uint8Array(h.digestLength);
    function B2(f, t, e, i) {
      t === void 0 && (t = C), i === void 0 && (i = 32);
      for (var u = new Uint8Array([
        1
      ]), s2 = z2(t, f), n = new y2(s2), r = new Uint8Array(n.digestLength), l3 = r.length, o = new Uint8Array(i), a = 0; a < i; a++) l3 === r.length && (M2(r, n, e, u), l3 = 0), o[a] = r[l3++];
      return n.clean(), r.fill(0), u.fill(0), o;
    }
    h.hkdf = B2;
    function E(f, t, e, i) {
      for (var u = new y2(f), s2 = u.digestLength, n = new Uint8Array(4), r = new Uint8Array(s2), l3 = new Uint8Array(s2), o = new Uint8Array(i), a = 0; a * s2 < i; a++) {
        var g2 = a + 1;
        n[0] = g2 >>> 24 & 255, n[1] = g2 >>> 16 & 255, n[2] = g2 >>> 8 & 255, n[3] = g2 >>> 0 & 255, u.reset(), u.update(t), u.update(n), u.finish(l3);
        for (var c = 0; c < s2; c++) r[c] = l3[c];
        for (var c = 2; c <= e; c++) {
          u.reset(), u.update(l3).finish(l3);
          for (var d = 0; d < s2; d++) r[d] ^= l3[d];
        }
        for (var c = 0; c < s2 && a * s2 + c < i; c++) o[a * s2 + c] = r[c];
      }
      for (var a = 0; a < s2; a++) r[a] = l3[a] = 0;
      for (var a = 0; a < 4; a++) n[a] = 0;
      return u.clean(), o;
    }
    h.pbkdf2 = E;
  });
});
var m2 = J2(j());
var O = m2.default ?? m2;

// deno:https://esm.sh/standardwebhooks@1.0.0/denonext/standardwebhooks.mjs
var require2 = (n) => {
  const e = (m3) => typeof m3.default < "u" ? m3.default : m3, c = (m3) => Object.assign({
    __esModule: true
  }, m3);
  switch (n) {
    case "@stablelib/base64":
      return c(base64_1_0_exports);
    case "fast-sha256":
      return e(fast_sha256_1_3_exports);
    default:
      console.error('module "' + n + '" not found');
      return null;
  }
};
var D2 = Object.create;
var p = Object.defineProperty;
var M = Object.getOwnPropertyDescriptor;
var N2 = Object.getOwnPropertyNames;
var T2 = Object.getPrototypeOf;
var _2 = Object.prototype.hasOwnProperty;
var l2 = ((t) => typeof require2 < "u" ? require2 : typeof Proxy < "u" ? new Proxy(t, {
  get: (e, o) => (typeof require2 < "u" ? require2 : e)[o]
}) : t)(function(t) {
  if (typeof require2 < "u") return require2.apply(this, arguments);
  throw Error('Dynamic require of "' + t + '" is not supported');
});
var y = (t, e) => () => (e || t((e = {
  exports: {}
}).exports, e), e.exports);
var j2 = (t, e, o, r) => {
  if (e && typeof e == "object" || typeof e == "function") for (let i of N2(e)) !_2.call(t, i) && i !== o && p(t, i, {
    get: () => e[i],
    enumerable: !(r = M(e, i)) || r.enumerable
  });
  return t;
};
var W = (t, e, o) => (o = t != null ? D2(T2(t)) : {}, j2(e || !t || !t.__esModule ? p(o, "default", {
  value: t,
  enumerable: true
}) : o, t));
var S2 = y((u) => {
  "use strict";
  Object.defineProperty(u, "__esModule", {
    value: true
  });
  u.timingSafeEqual = void 0;
  function E(t, e = "") {
    if (!t) throw new Error(e);
  }
  function A2(t, e) {
    if (t.byteLength !== e.byteLength) return false;
    t instanceof DataView || (t = new DataView(ArrayBuffer.isView(t) ? t.buffer : t)), e instanceof DataView || (e = new DataView(ArrayBuffer.isView(e) ? e.buffer : e)), E(t instanceof DataView), E(e instanceof DataView);
    let o = t.byteLength, r = 0, i = -1;
    for (; ++i < o; ) r |= t.getUint8(i) ^ e.getUint8(i);
    return r === 0;
  }
  u.timingSafeEqual = A2;
});
var v2 = y((s2) => {
  "use strict";
  Object.defineProperty(s2, "__esModule", {
    value: true
  });
  s2.Webhook = s2.WebhookVerificationError = void 0;
  var B2 = S2(), b = l2("@stablelib/base64"), L = l2("fast-sha256"), k2 = 300, w2 = class t extends Error {
    constructor(e) {
      super(e), Object.setPrototypeOf(this, t.prototype), this.name = "ExtendableError", this.stack = new Error(e).stack;
    }
  }, n = class t extends w2 {
    constructor(e) {
      super(e), Object.setPrototypeOf(this, t.prototype), this.name = "WebhookVerificationError";
    }
  };
  s2.WebhookVerificationError = n;
  var h = class t {
    constructor(e, o) {
      if (!e) throw new Error("Secret can't be empty.");
      if (o?.format === "raw") e instanceof Uint8Array ? this.key = e : this.key = Uint8Array.from(e, (r) => r.charCodeAt(0));
      else {
        if (typeof e != "string") throw new Error("Expected secret to be of type string");
        e.startsWith(t.prefix) && (e = e.substring(t.prefix.length)), this.key = b.decode(e);
      }
    }
    verify(e, o) {
      let r = {};
      for (let f of Object.keys(o)) r[f.toLowerCase()] = o[f];
      let i = r["webhook-id"], a = r["webhook-signature"], c = r["webhook-timestamp"];
      if (!a || !i || !c) throw new n("Missing required headers");
      let m3 = this.verifyTimestamp(c), x2 = this.sign(i, m3, e).split(",")[1], O2 = a.split(" "), d = new globalThis.TextEncoder();
      for (let f of O2) {
        let [V2, q3] = f.split(",");
        if (V2 === "v1" && (0, B2.timingSafeEqual)(d.encode(q3), d.encode(x2))) return JSON.parse(e.toString());
      }
      throw new n("No matching signature found");
    }
    sign(e, o, r) {
      if (typeof r != "string") if (r.constructor.name === "Buffer") r = r.toString();
      else throw new Error("Expected payload to be of type string or Buffer.");
      let i = new TextEncoder(), a = Math.floor(o.getTime() / 1e3), c = i.encode(`${e}.${a}.${r}`);
      return `v1,${b.encode(L.hmac(this.key, c))}`;
    }
    verifyTimestamp(e) {
      let o = Math.floor(Date.now() / 1e3), r = parseInt(e, 10);
      if (isNaN(r)) throw new n("Invalid Signature Headers");
      if (o - r > k2) throw new n("Message timestamp too old");
      if (r > o + k2) throw new n("Message timestamp too new");
      return new Date(r * 1e3);
    }
  };
  s2.Webhook = h;
  h.prefix = "whsec_";
});
var g = W(v2());
var { __esModule: $, Webhook: H2, WebhookVerificationError: J3 } = g;
var K2 = g.default ?? g;
export {
  H2 as Webhook,
  J3 as WebhookVerificationError,
  $ as __esModule,
  K2 as default
};
