// deno:https://esm.sh/tslib@2.8.1/denonext/tslib.mjs
function S(e, t2) {
  var r = {};
  for (var n3 in e) Object.prototype.hasOwnProperty.call(e, n3) && t2.indexOf(n3) < 0 && (r[n3] = e[n3]);
  if (e != null && typeof Object.getOwnPropertySymbols == "function") for (var i4 = 0, n3 = Object.getOwnPropertySymbols(e); i4 < n3.length; i4++) t2.indexOf(n3[i4]) < 0 && Object.prototype.propertyIsEnumerable.call(e, n3[i4]) && (r[n3[i4]] = e[n3[i4]]);
  return r;
}
function F(e, t2, r, n3) {
  function i4(o4) {
    return o4 instanceof r ? o4 : new r(function(a) {
      a(o4);
    });
  }
  return new (r || (r = Promise))(function(o4, a) {
    function f5(s) {
      try {
        c3(n3.next(s));
      } catch (l) {
        a(l);
      }
    }
    function p4(s) {
      try {
        c3(n3.throw(s));
      } catch (l) {
        a(l);
      }
    }
    function c3(s) {
      s.done ? o4(s.value) : i4(s.value).then(f5, p4);
    }
    c3((n3 = n3.apply(e, t2 || [])).next());
  });
}

// deno:https://esm.sh/@supabase/auth-js@2.112.3/denonext/auth-js.mjs
var pe = "2.112.3";
var L = 30 * 1e3;
var se = 3;
var ye = se * L;
var Ye = 2 * L;
var Xe = "http://localhost:9999";
var Ze = "supabase.auth.token";
var Qe = {
  "X-Client-Info": `gotrue-js/${pe}`
};
var ne = "X-Supabase-Api-Version";
var Oe = {
  "2024-01-01": {
    timestamp: Date.parse("2024-01-01T00:00:00.0Z"),
    name: "2024-01-01"
  }
};
var et = /^([a-z0-9_-]{4})*($|[a-z0-9_-]{3}$|[a-z0-9_-]{2}$)$/i;
var F2 = "sb_flow_id";
var tt = 5;
var rt = 600 * 1e3;
var B = class extends Error {
  constructor(e, t2, r) {
    super(e), this.__isAuthError = true, this.name = "AuthError", this.status = t2, this.code = r;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code
    };
  }
};
function h(i4) {
  return typeof i4 == "object" && i4 !== null && "__isAuthError" in i4;
}
var ve = class extends B {
  constructor(e, t2, r) {
    super(e, t2, r), this.name = "AuthApiError", this.status = t2, this.code = r;
  }
};
function Ce(i4) {
  return h(i4) && i4.name === "AuthApiError";
}
var x = class extends B {
  constructor(e, t2) {
    super(e), this.name = "AuthUnknownError", this.originalError = t2;
  }
};
var U = class extends B {
  constructor(e, t2, r, s) {
    super(e, r, s), this.name = t2, this.status = r;
  }
};
var E = class extends U {
  constructor() {
    super("Auth session missing!", "AuthSessionMissingError", 400, void 0);
  }
};
function ue(i4) {
  return h(i4) && i4.name === "AuthSessionMissingError";
}
var W = class extends U {
  constructor() {
    super("Auth session or user missing", "AuthInvalidTokenResponseError", 500, void 0);
  }
};
var Y = class extends U {
  constructor(e) {
    super(e, "AuthInvalidCredentialsError", 400, void 0);
  }
};
var X = class extends U {
  constructor(e, t2 = null) {
    super(e, "AuthImplicitGrantRedirectError", 500, void 0), this.details = null, this.details = t2;
  }
  toJSON() {
    return Object.assign(Object.assign({}, super.toJSON()), {
      details: this.details
    });
  }
};
function st(i4) {
  return h(i4) && i4.name === "AuthImplicitGrantRedirectError";
}
var oe = class extends U {
  constructor(e, t2 = null) {
    super(e, "AuthPKCEGrantCodeExchangeError", 500, void 0), this.details = null, this.details = t2;
  }
  toJSON() {
    return Object.assign(Object.assign({}, super.toJSON()), {
      details: this.details
    });
  }
};
var be = class extends U {
  constructor() {
    super("PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device, or if the storage was cleared. For SSR frameworks (Next.js, SvelteKit, etc.), use @supabase/ssr on both the server and client to store the code verifier in cookies.", "AuthPKCECodeVerifierMissingError", 400, "pkce_code_verifier_not_found");
  }
};
function fr(i4) {
  return h(i4) && i4.name === "AuthPKCECodeVerifierMissingError";
}
var Z = class extends U {
  constructor(e, t2) {
    super(e, "AuthRetryableFetchError", t2, void 0);
  }
};
function ce(i4) {
  return h(i4) && i4.name === "AuthRetryableFetchError";
}
var ae = class extends U {
  constructor(e = "Refresh result discarded: session state changed mid-flight (e.g., concurrent signOut)") {
    super(e, "AuthRefreshDiscardedError", 409, void 0);
  }
};
function it(i4) {
  return h(i4) && i4.name === "AuthRefreshDiscardedError";
}
var le = class extends U {
  constructor(e, t2, r) {
    super(e, "AuthWeakPasswordError", t2, "weak_password"), this.reasons = r;
  }
  toJSON() {
    return Object.assign(Object.assign({}, super.toJSON()), {
      reasons: this.reasons
    });
  }
};
function _r(i4) {
  return h(i4) && i4.name === "AuthWeakPasswordError";
}
var V = class extends U {
  constructor(e) {
    super(e, "AuthInvalidJwtError", 400, "invalid_jwt");
  }
};
var me = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("");
var nt = " \t\n\r=".split("");
var Nt = (() => {
  let i4 = new Array(128);
  for (let e = 0; e < i4.length; e += 1) i4[e] = -1;
  for (let e = 0; e < nt.length; e += 1) i4[nt[e].charCodeAt(0)] = -2;
  for (let e = 0; e < me.length; e += 1) i4[me[e].charCodeAt(0)] = e;
  return i4;
})();
function ot(i4, e, t2) {
  if (i4 !== null) for (e.queue = e.queue << 8 | i4, e.queuedBits += 8; e.queuedBits >= 6; ) {
    let r = e.queue >> e.queuedBits - 6 & 63;
    t2(me[r]), e.queuedBits -= 6;
  }
  else if (e.queuedBits > 0) for (e.queue = e.queue << 6 - e.queuedBits, e.queuedBits = 6; e.queuedBits >= 6; ) {
    let r = e.queue >> e.queuedBits - 6 & 63;
    t2(me[r]), e.queuedBits -= 6;
  }
}
function at(i4, e, t2) {
  let r = Nt[i4];
  if (r > -1) for (e.queue = e.queue << 6 | r, e.queuedBits += 6; e.queuedBits >= 8; ) t2(e.queue >> e.queuedBits - 8 & 255), e.queuedBits -= 8;
  else {
    if (r === -2) return;
    throw new Error(`Invalid Base64-URL character "${String.fromCharCode(i4)}"`);
  }
}
function Pe(i4) {
  let e = [], t2 = (o4) => {
    e.push(String.fromCodePoint(o4));
  }, r = {
    utf8seq: 0,
    codepoint: 0
  }, s = {
    queue: 0,
    queuedBits: 0
  }, n3 = (o4) => {
    qt(o4, r, t2);
  };
  for (let o4 = 0; o4 < i4.length; o4 += 1) at(i4.charCodeAt(o4), s, n3);
  return e.join("");
}
function Lt(i4, e) {
  if (i4 <= 127) {
    e(i4);
    return;
  } else if (i4 <= 2047) {
    e(192 | i4 >> 6), e(128 | i4 & 63);
    return;
  } else if (i4 <= 65535) {
    e(224 | i4 >> 12), e(128 | i4 >> 6 & 63), e(128 | i4 & 63);
    return;
  } else if (i4 <= 1114111) {
    e(240 | i4 >> 18), e(128 | i4 >> 12 & 63), e(128 | i4 >> 6 & 63), e(128 | i4 & 63);
    return;
  }
  throw new Error(`Unrecognized Unicode codepoint: ${i4.toString(16)}`);
}
function Dt(i4, e) {
  for (let t2 = 0; t2 < i4.length; t2 += 1) {
    let r = i4.charCodeAt(t2);
    if (r > 55295 && r <= 56319) {
      let s = (r - 55296) * 1024 & 65535;
      r = (i4.charCodeAt(t2 + 1) - 56320 & 65535 | s) + 65536, t2 += 1;
    }
    Lt(r, e);
  }
}
function qt(i4, e, t2) {
  if (e.utf8seq === 0) {
    if (i4 <= 127) {
      t2(i4);
      return;
    }
    for (let r = 1; r < 6; r += 1) if ((i4 >> 7 - r & 1) === 0) {
      e.utf8seq = r;
      break;
    }
    if (e.utf8seq === 2) e.codepoint = i4 & 31;
    else if (e.utf8seq === 3) e.codepoint = i4 & 15;
    else if (e.utf8seq === 4) e.codepoint = i4 & 7;
    else throw new Error("Invalid UTF-8 sequence");
    e.utf8seq -= 1;
  } else if (e.utf8seq > 0) {
    if (i4 <= 127) throw new Error("Invalid UTF-8 sequence");
    e.codepoint = e.codepoint << 6 | i4 & 63, e.utf8seq -= 1, e.utf8seq === 0 && t2(e.codepoint);
  }
}
function z(i4) {
  let e = [], t2 = {
    queue: 0,
    queuedBits: 0
  }, r = (s) => {
    e.push(s);
  };
  for (let s = 0; s < i4.length; s += 1) at(i4.charCodeAt(s), t2, r);
  return new Uint8Array(e);
}
function lt(i4) {
  let e = [];
  return Dt(i4, (t2) => e.push(t2)), new Uint8Array(e);
}
function G(i4) {
  let e = [], t2 = {
    queue: 0,
    queuedBits: 0
  }, r = (s) => {
    e.push(s);
  };
  return i4.forEach((s) => ot(s, t2, r)), ot(null, t2, r), e.join("");
}
function ut(i4) {
  return Math.round(Date.now() / 1e3) + i4;
}
function ct() {
  return Symbol("auth-callback");
}
var A = () => typeof globalThis < "u" && typeof document < "u";
var Q = {
  tested: false,
  writable: false
};
var Re = () => {
  if (!A()) return false;
  try {
    if (typeof globalThis.localStorage != "object") return false;
  } catch {
    return false;
  }
  if (Q.tested) return Q.writable;
  let i4 = `lswt-${Math.random()}${Math.random()}`;
  try {
    globalThis.localStorage.setItem(i4, i4), globalThis.localStorage.removeItem(i4), Q.tested = true, Q.writable = true;
  } catch {
    Q.tested = true, Q.writable = false;
  }
  return Q.writable;
};
function je(i4) {
  let e = {}, t2 = new URL(i4);
  if (t2.hash && t2.hash[0] === "#") try {
    new URLSearchParams(t2.hash.substring(1)).forEach((s, n3) => {
      e[n3] = s;
    });
  } catch {
  }
  return t2.searchParams.forEach((r, s) => {
    e[s] = r;
  }), e;
}
var ke = (i4) => i4 ? (...e) => i4(...e) : (...e) => fetch(...e);
var ht = (i4) => typeof i4 == "object" && i4 !== null && "status" in i4 && "ok" in i4 && "json" in i4 && typeof i4.json == "function";
var D = async (i4, e, t2) => {
  await i4.setItem(e, JSON.stringify(t2));
};
var I = async (i4, e) => {
  let t2 = await i4.getItem(e);
  if (!t2) return null;
  try {
    return JSON.parse(t2);
  } catch {
    return null;
  }
};
var O = async (i4, e) => {
  await i4.removeItem(e);
};
var he = class i {
  constructor() {
    this.promise = new i.promiseConstructor((e, t2) => {
      this.resolve = e, this.reject = t2;
    });
  }
};
he.promiseConstructor = Promise;
function fe(i4) {
  let e = i4.split(".");
  if (e.length !== 3) throw new V("Invalid JWT structure");
  for (let r = 0; r < e.length; r++) if (!et.test(e[r])) throw new V("JWT not in base64url format");
  return {
    header: JSON.parse(Pe(e[0])),
    payload: JSON.parse(Pe(e[1])),
    signature: z(e[2]),
    raw: {
      header: e[0],
      payload: e[1]
    }
  };
}
async function dt(i4) {
  return await new Promise((e) => {
    setTimeout(() => e(null), i4);
  });
}
function ft(i4, e) {
  return new Promise((r, s) => {
    (async () => {
      for (let n3 = 0; n3 < 1 / 0; n3++) try {
        let o4 = await i4(n3);
        if (!e(n3, null, o4)) {
          r(o4);
          return;
        }
      } catch (o4) {
        if (!e(n3, o4)) {
          s(o4);
          return;
        }
      }
    })();
  });
}
function _t(i4) {
  return ("0" + i4.toString(16)).substr(-2);
}
function Kt() {
  let e = new Uint32Array(56);
  if (typeof crypto > "u") {
    let t2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~", r = t2.length, s = "";
    for (let n3 = 0; n3 < 56; n3++) s += t2.charAt(Math.floor(Math.random() * r));
    return s;
  }
  return crypto.getRandomValues(e), Array.from(e, _t).join("");
}
async function Mt(i4) {
  let t2 = new TextEncoder().encode(i4), r = await crypto.subtle.digest("SHA-256", t2), s = new Uint8Array(r);
  return Array.from(s).map((n3) => String.fromCharCode(n3)).join("");
}
async function Ft(i4) {
  if (!(typeof crypto < "u" && typeof crypto.subtle < "u" && typeof TextEncoder < "u")) return console.warn("WebCrypto API is not supported. Code challenge method will default to use plain instead of sha256."), i4;
  let t2 = await Mt(i4);
  return btoa(t2).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
var Wt = /^[a-zA-Z0-9_-]{8,64}$/;
function _e(i4) {
  return typeof i4 == "string" && Wt.test(i4) ? i4 : null;
}
function Gt() {
  if (typeof crypto < "u" && typeof crypto.getRandomValues == "function") {
    let e = new Uint8Array(16);
    return crypto.getRandomValues(e), Array.from(e, _t).join("");
  }
  let i4 = "";
  for (let e = 0; e < 32; e++) i4 += Math.floor(Math.random() * 16).toString(16);
  return i4;
}
var ee = (i4, e) => `${i4}-flow-${e}-code-verifier`;
var de = (i4) => `${i4}-flows-code-verifier`;
async function Ue(i4, e) {
  let t2 = await I(i4, de(e));
  return Array.isArray(t2) ? t2.filter((r) => _e(r) !== null) : [];
}
async function Bt(i4, e, t2, r, s) {
  await D(i4, ee(e, t2), r);
  let n3 = (await Ue(i4, e)).filter((o4) => o4 !== t2);
  for (n3.push(t2); n3.length > tt; ) {
    let o4 = n3.shift();
    await O(i4, ee(e, o4)), s?.(o4);
  }
  await D(i4, de(e), n3), await D(i4, `${e}-code-verifier`, r);
}
async function wt(i4, e, t2) {
  if (t2) {
    let s = await I(i4, ee(e, t2));
    return {
      verifier: typeof s == "string" ? s : null,
      flowId: t2
    };
  }
  let r = await I(i4, `${e}-code-verifier`);
  return {
    verifier: typeof r == "string" ? r : null,
    flowId: null
  };
}
async function $(i4, e, t2) {
  let r = `${e}-code-verifier`;
  if (!t2) {
    await O(i4, r);
    return;
  }
  let s = ee(e, t2), n3 = await I(i4, s);
  await O(i4, s);
  let o4 = await Ue(i4, e), a = o4.filter((l) => l !== t2);
  a.length !== o4.length && (a.length > 0 ? await D(i4, de(e), a) : await O(i4, de(e))), n3 != null && n3 === await I(i4, r) && await O(i4, r);
}
async function gt(i4, e) {
  let t2 = await Ue(i4, e);
  for (let r of t2) await O(i4, ee(e, r));
  await O(i4, de(e)), await O(i4, `${e}-code-verifier`);
}
function pt(i4, e) {
  let t2 = i4.indexOf("#"), r = t2 === -1 ? i4 : i4.slice(0, t2), s = t2 === -1 ? "" : i4.slice(t2), n3 = r.indexOf("?");
  if (n3 !== -1) {
    let a = r.slice(0, n3), l = r.slice(n3 + 1).split("&").filter((u2) => u2 !== "" && u2 !== F2 && !u2.startsWith(`${F2}=`));
    r = l.length > 0 ? `${a}?${l.join("&")}` : a;
  }
  let o4 = r.includes("?") ? "&" : "?";
  return `${r}${o4}${F2}=${encodeURIComponent(e)}${s}`;
}
async function yt(i4, e, t2 = false, r) {
  let s = Kt(), n3 = s;
  t2 && (n3 += "/recovery");
  let o4 = Gt();
  await Bt(i4, e, o4, n3, r);
  let a = await Ft(s);
  return [
    a,
    s === a ? "plain" : "s256",
    o4
  ];
}
var Vt = /^2[0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-9]|3[0-1])$/i;
function vt(i4) {
  let e = i4.headers.get(ne);
  if (!e || !e.match(Vt)) return null;
  try {
    return /* @__PURE__ */ new Date(`${e}T00:00:00.0Z`);
  } catch {
    return null;
  }
}
function bt(i4) {
  if (!i4) throw new Error("Missing exp claim");
  let e = Math.floor(Date.now() / 1e3);
  if (i4 <= e) throw new Error("JWT has expired");
}
function mt(i4) {
  switch (i4) {
    case "RS256":
      return {
        name: "RSASSA-PKCS1-v1_5",
        hash: {
          name: "SHA-256"
        }
      };
    case "ES256":
      return {
        name: "ECDSA",
        namedCurve: "P-256",
        hash: {
          name: "SHA-256"
        }
      };
    default:
      throw new Error("Invalid alg claim");
  }
}
var zt = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function q(i4) {
  if (!zt.test(i4)) throw new Error("@supabase/auth-js: Expected parameter to be UUID but is not");
}
function C(i4) {
  if (!i4.passkey) throw new Error("@supabase/auth-js: the passkey API is experimental and disabled by default. Enable it by passing `auth: { experimental: { passkey: true } }` to createClient (or to the GoTrueClient constructor).");
}
function Se() {
  let i4 = {};
  return new Proxy(i4, {
    get: (e, t2) => {
      if (t2 === "__isUserNotAvailableProxy") return true;
      if (typeof t2 == "symbol") {
        let r = t2.toString();
        if (r === "Symbol(Symbol.toPrimitive)" || r === "Symbol(Symbol.toStringTag)" || r === "Symbol(util.inspect.custom)") return;
      }
      throw new Error(`@supabase/auth-js: client was created with userStorage option and there was no user stored in the user storage. Accessing the "${t2}" property of the session object is not supported. Please use getUser() instead.`);
    },
    set: (e, t2) => {
      throw new Error(`@supabase/auth-js: client was created with userStorage option and there was no user stored in the user storage. Setting the "${t2}" property of the session object is not supported. Please use getUser() to fetch a user object you can manipulate.`);
    },
    deleteProperty: (e, t2) => {
      throw new Error(`@supabase/auth-js: client was created with userStorage option and there was no user stored in the user storage. Deleting the "${t2}" property of the session object is not supported. Please use getUser() to fetch a user object you can manipulate.`);
    }
  });
}
function Rt(i4, e) {
  return new Proxy(i4, {
    get: (t2, r, s) => {
      if (r === "__isInsecureUserWarningProxy") return true;
      if (typeof r == "symbol") {
        let n3 = r.toString();
        if (n3 === "Symbol(Symbol.toPrimitive)" || n3 === "Symbol(Symbol.toStringTag)" || n3 === "Symbol(util.inspect.custom)" || n3 === "Symbol(nodejs.util.inspect.custom)") return Reflect.get(t2, r, s);
      }
      return !e.value && typeof r == "string" && (console.warn("Using the user object as returned from supabase.auth.getSession() or from some supabase.auth.onAuthStateChange() events could be insecure! This value comes directly from the storage medium (usually cookies on the server) and may not be authentic. Use supabase.auth.getUser() instead which authenticates the data by contacting the Supabase Auth server."), e.value = true), Reflect.get(t2, r, s);
    }
  });
}
function $e(i4) {
  return JSON.parse(JSON.stringify(i4));
}
var te = (i4) => {
  if (typeof i4 == "object" && i4 !== null) {
    let e = i4;
    if (typeof e.msg == "string") return e.msg;
    if (typeof e.message == "string") return e.message;
    if (typeof e.error_description == "string") return e.error_description;
    if (typeof e.error == "string") return e.error;
  }
  return JSON.stringify(i4);
};
var kt = [
  500,
  501,
  502,
  503,
  504,
  520,
  521,
  522,
  523,
  524,
  525,
  526,
  527,
  528,
  529,
  530
];
async function St(i4) {
  var e;
  if (!ht(i4)) throw new Z(te(i4), 0);
  let t2;
  try {
    t2 = await i4.json();
  } catch (n3) {
    throw kt.includes(i4.status) ? new Z(i4.statusText || `HTTP ${i4.status}`, i4.status) : new x(te(n3), n3);
  }
  if (kt.includes(i4.status)) throw new Z(te(t2), i4.status);
  let r, s = vt(i4);
  if (s && s.getTime() >= Oe["2024-01-01"].timestamp && typeof t2 == "object" && t2 && typeof t2.code == "string" ? r = t2.code : typeof t2 == "object" && t2 && typeof t2.error_code == "string" && (r = t2.error_code), r) {
    if (r === "weak_password") throw new le(te(t2), i4.status, ((e = t2.weak_password) === null || e === void 0 ? void 0 : e.reasons) || []);
    if (r === "session_not_found") throw new E();
  } else if (typeof t2 == "object" && t2 && typeof t2.weak_password == "object" && t2.weak_password && Array.isArray(t2.weak_password.reasons) && t2.weak_password.reasons.length && t2.weak_password.reasons.reduce((n3, o4) => n3 && typeof o4 == "string", true)) throw new le(te(t2), i4.status, t2.weak_password.reasons);
  throw new ve(te(t2), i4.status || 500, r);
}
var Ht = (i4, e, t2, r) => {
  let s = {
    method: i4,
    headers: e?.headers || {}
  };
  return i4 === "GET" ? s : (s.headers = Object.assign({
    "Content-Type": "application/json;charset=UTF-8"
  }, e?.headers), s.body = JSON.stringify(r), Object.assign(Object.assign({}, s), t2));
};
async function f(i4, e, t2, r) {
  var s;
  let n3 = Object.assign({}, r?.headers);
  n3[ne] || (n3[ne] = Oe["2024-01-01"].name), r?.jwt && (n3.Authorization = `Bearer ${r.jwt}`);
  let o4 = (s = r?.query) !== null && s !== void 0 ? s : {};
  r?.redirectTo && (o4.redirect_to = r.redirectTo);
  let a = Object.keys(o4).length ? "?" + new URLSearchParams(o4).toString() : "", l = await Yt(i4, e, t2 + a, {
    headers: n3,
    noResolveJson: r?.noResolveJson
  }, {}, r?.body);
  return r?.xform ? r?.xform(l) : {
    data: Object.assign({}, l),
    error: null
  };
}
async function Yt(i4, e, t2, r, s, n3) {
  let o4 = Ht(e, r, s, n3), a;
  try {
    a = await i4(t2, Object.assign({}, o4));
  } catch (l) {
    throw new Z(te(l), 0);
  }
  if (a.ok || await St(a), r?.noResolveJson) return a;
  try {
    return await a.json();
  } catch (l) {
    await St(l);
  }
}
function P(i4) {
  var e;
  let t2 = null;
  Xt(i4) && (t2 = Object.assign({}, i4), i4.expires_at || (t2.expires_at = ut(i4.expires_in)));
  let r = (e = i4.user) !== null && e !== void 0 ? e : typeof i4?.id == "string" ? i4 : null;
  return {
    data: {
      session: t2,
      user: r
    },
    error: null
  };
}
function Ne(i4) {
  let e = P(i4);
  return !e.error && i4.weak_password && typeof i4.weak_password == "object" && Array.isArray(i4.weak_password.reasons) && i4.weak_password.reasons.length && i4.weak_password.message && typeof i4.weak_password.message == "string" && i4.weak_password.reasons.reduce((t2, r) => t2 && typeof r == "string", true) && (e.data.weak_password = i4.weak_password), e;
}
function K(i4) {
  var e;
  return {
    data: {
      user: (e = i4.user) !== null && e !== void 0 ? e : i4
    },
    error: null
  };
}
function Et(i4) {
  return {
    data: i4,
    error: null
  };
}
function At(i4) {
  let { action_link: e, email_otp: t2, hashed_token: r, redirect_to: s, verification_type: n3 } = i4, o4 = S(i4, [
    "action_link",
    "email_otp",
    "hashed_token",
    "redirect_to",
    "verification_type"
  ]), a = {
    action_link: e,
    email_otp: t2,
    hashed_token: r,
    redirect_to: s,
    verification_type: n3
  }, l = Object.assign({}, o4);
  return {
    data: {
      properties: a,
      user: l
    },
    error: null
  };
}
function Le(i4) {
  return i4;
}
function Xt(i4) {
  return !!i4.access_token && !!i4.refresh_token && !!i4.expires_in;
}
var Ee = [
  "global",
  "local",
  "others"
];
var J = class {
  constructor({ url: e = "", headers: t2 = {}, fetch: r, experimental: s }) {
    this.url = e, this.headers = t2, this.fetch = ke(r), this.experimental = s ?? {}, this.mfa = {
      listFactors: this._listFactors.bind(this),
      deleteFactor: this._deleteFactor.bind(this)
    }, this.oauth = {
      listClients: this._listOAuthClients.bind(this),
      createClient: this._createOAuthClient.bind(this),
      getClient: this._getOAuthClient.bind(this),
      updateClient: this._updateOAuthClient.bind(this),
      deleteClient: this._deleteOAuthClient.bind(this),
      regenerateClientSecret: this._regenerateOAuthClientSecret.bind(this)
    }, this.customProviders = {
      listProviders: this._listCustomProviders.bind(this),
      createProvider: this._createCustomProvider.bind(this),
      getProvider: this._getCustomProvider.bind(this),
      updateProvider: this._updateCustomProvider.bind(this),
      deleteProvider: this._deleteCustomProvider.bind(this)
    }, this.passkey = {
      listPasskeys: this._adminListPasskeys.bind(this),
      deletePasskey: this._adminDeletePasskey.bind(this)
    };
  }
  async signOut(e, t2 = Ee[0]) {
    if (Ee.indexOf(t2) < 0) throw new Error(`@supabase/auth-js: Parameter scope must be one of ${Ee.join(", ")}`);
    try {
      return await f(this.fetch, "POST", `${this.url}/logout?scope=${t2}`, {
        headers: this.headers,
        jwt: e,
        noResolveJson: true
      }), {
        data: null,
        error: null
      };
    } catch (r) {
      if (h(r)) return {
        data: null,
        error: r
      };
      throw r;
    }
  }
  async inviteUserByEmail(e, t2 = {}) {
    try {
      return await f(this.fetch, "POST", `${this.url}/invite`, {
        body: {
          email: e,
          data: t2.data
        },
        headers: this.headers,
        redirectTo: t2.redirectTo,
        xform: K
      });
    } catch (r) {
      if (h(r)) return {
        data: {
          user: null
        },
        error: r
      };
      throw r;
    }
  }
  async generateLink(e) {
    try {
      let { options: t2 } = e, r = S(e, [
        "options"
      ]), s = Object.assign(Object.assign({}, r), t2);
      return "newEmail" in r && (s.new_email = r?.newEmail, delete s.newEmail), await f(this.fetch, "POST", `${this.url}/admin/generate_link`, {
        body: s,
        headers: this.headers,
        xform: At,
        redirectTo: t2?.redirectTo
      });
    } catch (t2) {
      if (h(t2)) return {
        data: {
          properties: null,
          user: null
        },
        error: t2
      };
      throw t2;
    }
  }
  async createUser(e) {
    try {
      return await f(this.fetch, "POST", `${this.url}/admin/users`, {
        body: e,
        headers: this.headers,
        xform: K
      });
    } catch (t2) {
      if (h(t2)) return {
        data: {
          user: null
        },
        error: t2
      };
      throw t2;
    }
  }
  async listUsers(e) {
    var t2, r, s, n3, o4, a, l;
    try {
      let u2 = {
        nextPage: null,
        lastPage: 0,
        total: 0
      }, c3 = await f(this.fetch, "GET", `${this.url}/admin/users`, {
        headers: this.headers,
        noResolveJson: true,
        query: {
          page: (r = (t2 = e?.page) === null || t2 === void 0 ? void 0 : t2.toString()) !== null && r !== void 0 ? r : "",
          per_page: (n3 = (s = e?.perPage) === null || s === void 0 ? void 0 : s.toString()) !== null && n3 !== void 0 ? n3 : ""
        },
        xform: Le
      });
      if (c3.error) throw c3.error;
      let _6 = await c3.json(), w6 = (o4 = c3.headers.get("x-total-count")) !== null && o4 !== void 0 ? o4 : 0, d = (l = (a = c3.headers.get("link")) === null || a === void 0 ? void 0 : a.split(",")) !== null && l !== void 0 ? l : [];
      return d.length > 0 && (d.forEach((v2) => {
        let y5 = parseInt(v2.split(";")[0].split("=")[1].substring(0, 1)), b3 = JSON.parse(v2.split(";")[1].split("=")[1]);
        u2[`${b3}Page`] = y5;
      }), u2.total = parseInt(w6)), {
        data: Object.assign(Object.assign({}, _6), u2),
        error: null
      };
    } catch (u2) {
      if (h(u2)) return {
        data: {
          users: []
        },
        error: u2
      };
      throw u2;
    }
  }
  async getUserById(e) {
    q(e);
    try {
      return await f(this.fetch, "GET", `${this.url}/admin/users/${e}`, {
        headers: this.headers,
        xform: K
      });
    } catch (t2) {
      if (h(t2)) return {
        data: {
          user: null
        },
        error: t2
      };
      throw t2;
    }
  }
  async updateUserById(e, t2) {
    q(e);
    try {
      return await f(this.fetch, "PUT", `${this.url}/admin/users/${e}`, {
        body: t2,
        headers: this.headers,
        xform: K
      });
    } catch (r) {
      if (h(r)) return {
        data: {
          user: null
        },
        error: r
      };
      throw r;
    }
  }
  async deleteUser(e, t2 = false) {
    q(e);
    try {
      return await f(this.fetch, "DELETE", `${this.url}/admin/users/${e}`, {
        headers: this.headers,
        body: {
          should_soft_delete: t2
        },
        xform: K
      });
    } catch (r) {
      if (h(r)) return {
        data: {
          user: null
        },
        error: r
      };
      throw r;
    }
  }
  async _listFactors(e) {
    q(e.userId);
    try {
      let { data: t2, error: r } = await f(this.fetch, "GET", `${this.url}/admin/users/${e.userId}/factors`, {
        headers: this.headers,
        xform: (s) => ({
          data: {
            factors: s
          },
          error: null
        })
      });
      return {
        data: t2,
        error: r
      };
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _deleteFactor(e) {
    q(e.userId), q(e.id);
    try {
      return {
        data: await f(this.fetch, "DELETE", `${this.url}/admin/users/${e.userId}/factors/${e.id}`, {
          headers: this.headers
        }),
        error: null
      };
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _listOAuthClients(e) {
    var t2, r, s, n3, o4, a, l;
    try {
      let u2 = {
        nextPage: null,
        lastPage: 0,
        total: 0
      }, c3 = await f(this.fetch, "GET", `${this.url}/admin/oauth/clients`, {
        headers: this.headers,
        noResolveJson: true,
        query: {
          page: (r = (t2 = e?.page) === null || t2 === void 0 ? void 0 : t2.toString()) !== null && r !== void 0 ? r : "",
          per_page: (n3 = (s = e?.perPage) === null || s === void 0 ? void 0 : s.toString()) !== null && n3 !== void 0 ? n3 : ""
        },
        xform: Le
      });
      if (c3.error) throw c3.error;
      let _6 = await c3.json(), w6 = (o4 = c3.headers.get("x-total-count")) !== null && o4 !== void 0 ? o4 : 0, d = (l = (a = c3.headers.get("link")) === null || a === void 0 ? void 0 : a.split(",")) !== null && l !== void 0 ? l : [];
      return d.length > 0 && (d.forEach((v2) => {
        let y5 = parseInt(v2.split(";")[0].split("=")[1].substring(0, 1)), b3 = JSON.parse(v2.split(";")[1].split("=")[1]);
        u2[`${b3}Page`] = y5;
      }), u2.total = parseInt(w6)), {
        data: Object.assign(Object.assign({}, _6), u2),
        error: null
      };
    } catch (u2) {
      if (h(u2)) return {
        data: {
          clients: []
        },
        error: u2
      };
      throw u2;
    }
  }
  async _createOAuthClient(e) {
    try {
      return await f(this.fetch, "POST", `${this.url}/admin/oauth/clients`, {
        body: e,
        headers: this.headers,
        xform: (t2) => ({
          data: t2,
          error: null
        })
      });
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _getOAuthClient(e) {
    try {
      return await f(this.fetch, "GET", `${this.url}/admin/oauth/clients/${e}`, {
        headers: this.headers,
        xform: (t2) => ({
          data: t2,
          error: null
        })
      });
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _updateOAuthClient(e, t2) {
    try {
      return await f(this.fetch, "PUT", `${this.url}/admin/oauth/clients/${e}`, {
        body: t2,
        headers: this.headers,
        xform: (r) => ({
          data: r,
          error: null
        })
      });
    } catch (r) {
      if (h(r)) return {
        data: null,
        error: r
      };
      throw r;
    }
  }
  async _deleteOAuthClient(e) {
    try {
      return await f(this.fetch, "DELETE", `${this.url}/admin/oauth/clients/${e}`, {
        headers: this.headers,
        noResolveJson: true
      }), {
        data: null,
        error: null
      };
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _regenerateOAuthClientSecret(e) {
    try {
      return await f(this.fetch, "POST", `${this.url}/admin/oauth/clients/${e}/regenerate_secret`, {
        headers: this.headers,
        xform: (t2) => ({
          data: t2,
          error: null
        })
      });
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _listCustomProviders(e) {
    try {
      let t2 = {};
      return e?.type && (t2.type = e.type), await f(this.fetch, "GET", `${this.url}/admin/custom-providers`, {
        headers: this.headers,
        query: t2,
        xform: (r) => {
          var s;
          return {
            data: {
              providers: (s = r?.providers) !== null && s !== void 0 ? s : []
            },
            error: null
          };
        }
      });
    } catch (t2) {
      if (h(t2)) return {
        data: {
          providers: []
        },
        error: t2
      };
      throw t2;
    }
  }
  async _createCustomProvider(e) {
    try {
      return await f(this.fetch, "POST", `${this.url}/admin/custom-providers`, {
        body: e,
        headers: this.headers,
        xform: (t2) => ({
          data: t2,
          error: null
        })
      });
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _getCustomProvider(e) {
    try {
      return await f(this.fetch, "GET", `${this.url}/admin/custom-providers/${e}`, {
        headers: this.headers,
        xform: (t2) => ({
          data: t2,
          error: null
        })
      });
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _updateCustomProvider(e, t2) {
    try {
      return await f(this.fetch, "PUT", `${this.url}/admin/custom-providers/${e}`, {
        body: t2,
        headers: this.headers,
        xform: (r) => ({
          data: r,
          error: null
        })
      });
    } catch (r) {
      if (h(r)) return {
        data: null,
        error: r
      };
      throw r;
    }
  }
  async _deleteCustomProvider(e) {
    try {
      return await f(this.fetch, "DELETE", `${this.url}/admin/custom-providers/${e}`, {
        headers: this.headers,
        noResolveJson: true
      }), {
        data: null,
        error: null
      };
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _adminListPasskeys(e) {
    C(this.experimental), q(e.userId);
    try {
      return await f(this.fetch, "GET", `${this.url}/admin/users/${e.userId}/passkeys`, {
        headers: this.headers,
        xform: (t2) => ({
          data: t2,
          error: null
        })
      });
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
  async _adminDeletePasskey(e) {
    C(this.experimental), q(e.userId), q(e.passkeyId);
    try {
      return await f(this.fetch, "DELETE", `${this.url}/admin/users/${e.userId}/passkeys/${e.passkeyId}`, {
        headers: this.headers,
        noResolveJson: true
      }), {
        data: null,
        error: null
      };
    } catch (t2) {
      if (h(t2)) return {
        data: null,
        error: t2
      };
      throw t2;
    }
  }
};
function De(i4 = {}) {
  return {
    getItem: (e) => i4[e] || null,
    setItem: (e, t2) => {
      i4[e] = t2;
    },
    removeItem: (e) => {
      delete i4[e];
    }
  };
}
var N = {
  debug: !!(globalThis && Re() && globalThis.localStorage && globalThis.localStorage.getItem("supabase.gotrue-js.locks.debug") === "true")
};
var H = class extends Error {
  constructor(e) {
    super(e), this.isAcquireTimeout = true;
  }
};
var we = class extends H {
};
var qe = class extends H {
};
async function Qt(i4, e, t2) {
  N.debug && console.log("@supabase/gotrue-js: navigatorLock: acquire lock", i4, e);
  let r = new globalThis.AbortController(), s;
  e > 0 && (s = setTimeout(() => {
    r.abort(), N.debug && console.log("@supabase/gotrue-js: navigatorLock acquire timed out", i4);
  }, e)), await Promise.resolve();
  try {
    return await globalThis.navigator.locks.request(i4, e === 0 ? {
      mode: "exclusive",
      ifAvailable: true
    } : {
      mode: "exclusive",
      signal: r.signal
    }, async (n3) => {
      if (n3) {
        clearTimeout(s), N.debug && console.log("@supabase/gotrue-js: navigatorLock: acquired", i4, n3.name);
        try {
          return await t2();
        } finally {
          N.debug && console.log("@supabase/gotrue-js: navigatorLock: released", i4, n3.name);
        }
      } else {
        if (e === 0) throw N.debug && console.log("@supabase/gotrue-js: navigatorLock: not immediately available", i4), new we(`Acquiring an exclusive Navigator LockManager lock "${i4}" immediately failed`);
        if (N.debug) try {
          let o4 = await globalThis.navigator.locks.query();
          console.log("@supabase/gotrue-js: Navigator LockManager state", JSON.stringify(o4, null, "  "));
        } catch (o4) {
          console.warn("@supabase/gotrue-js: Error when querying Navigator LockManager state", o4);
        }
        return console.warn("@supabase/gotrue-js: Navigator LockManager returned a null lock when using #request without ifAvailable set to true, it appears this browser is not following the LockManager spec https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request"), clearTimeout(s), await t2();
      }
    });
  } catch (n3) {
    if (e > 0 && clearTimeout(s), n3 !== null && typeof n3 == "object" && "name" in n3 && n3.name === "AbortError" && e > 0) {
      if (r.signal.aborted) return N.debug && console.log("@supabase/gotrue-js: navigatorLock: acquire timeout, recovering by stealing lock", i4), console.warn(`@supabase/gotrue-js: Lock "${i4}" was not released within ${e}ms. This may indicate an orphaned lock from a component unmount (e.g., React Strict Mode). Forcefully acquiring the lock to recover.`), await Promise.resolve().then(() => globalThis.navigator.locks.request(i4, {
        mode: "exclusive",
        steal: true
      }, async (o4) => {
        if (o4) {
          N.debug && console.log("@supabase/gotrue-js: navigatorLock: recovered (stolen)", i4, o4.name);
          try {
            return await t2();
          } finally {
            N.debug && console.log("@supabase/gotrue-js: navigatorLock: released (stolen)", i4, o4.name);
          }
        } else return console.warn("@supabase/gotrue-js: Navigator LockManager returned null lock even with steal: true"), await t2();
      }));
      throw N.debug && console.log("@supabase/gotrue-js: navigatorLock: lock was stolen by another request", i4), new we(`Lock "${i4}" was released because another request stole it`);
    }
    throw n3;
  }
}
var Tt = {};
async function er(i4, e, t2) {
  var r;
  let s = (r = Tt[i4]) !== null && r !== void 0 ? r : Promise.resolve(), n3 = (async () => {
    try {
      return await s, null;
    } catch {
      return null;
    }
  })(), o4 = (async () => {
    let a = null;
    try {
      let l = e >= 0 ? new Promise((u2, c3) => {
        a = setTimeout(() => {
          console.warn(`@supabase/gotrue-js: Lock "${i4}" acquisition timed out after ${e}ms. This may be caused by another operation holding the lock. Consider increasing lockAcquireTimeout or checking for stuck operations.`), c3(new qe(`Acquiring process lock with name "${i4}" timed out`));
        }, e);
      }) : null;
      await Promise.race([
        n3,
        l
      ].filter((u2) => u2)), a !== null && clearTimeout(a);
    } catch (l) {
      if (a !== null && clearTimeout(a), l instanceof H) throw l;
    }
    return await t2();
  })();
  return Tt[i4] = (async () => {
    try {
      return await o4;
    } catch (a) {
      if (a instanceof H) {
        try {
          await s;
        } catch {
        }
        return null;
      }
      throw a;
    }
  })(), await o4;
}
function It() {
  if (typeof globalThis != "object") try {
    Object.defineProperty(Object.prototype, "__magic__", {
      get: function() {
        return this;
      },
      configurable: true
    }), __magic__.globalThis = __magic__, delete Object.prototype.__magic__;
  } catch {
    typeof self < "u" && (self.globalThis = self);
  }
}
function Ke(i4) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(i4)) throw new Error(`@supabase/auth-js: Address "${i4}" is invalid.`);
  return i4.toLowerCase();
}
function xt(i4) {
  return parseInt(i4, 16);
}
function Ot(i4) {
  let e = new TextEncoder().encode(i4);
  return "0x" + Array.from(e, (r) => r.toString(16).padStart(2, "0")).join("");
}
function Ct(i4) {
  var e;
  let { chainId: t2, domain: r, expirationTime: s, issuedAt: n3 = /* @__PURE__ */ new Date(), nonce: o4, notBefore: a, requestId: l, resources: u2, scheme: c3, uri: _6, version: w6 } = i4;
  {
    if (!Number.isInteger(t2)) throw new Error(`@supabase/auth-js: Invalid SIWE message field "chainId". Chain ID must be a EIP-155 chain ID. Provided value: ${t2}`);
    if (!r) throw new Error('@supabase/auth-js: Invalid SIWE message field "domain". Domain must be provided.');
    if (o4 && o4.length < 8) throw new Error(`@supabase/auth-js: Invalid SIWE message field "nonce". Nonce must be at least 8 characters. Provided value: ${o4}`);
    if (!_6) throw new Error('@supabase/auth-js: Invalid SIWE message field "uri". URI must be provided.');
    if (w6 !== "1") throw new Error(`@supabase/auth-js: Invalid SIWE message field "version". Version must be '1'. Provided value: ${w6}`);
    if (!((e = i4.statement) === null || e === void 0) && e.includes(`
`)) throw new Error(`@supabase/auth-js: Invalid SIWE message field "statement". Statement must not include '\\n'. Provided value: ${i4.statement}`);
  }
  let d = Ke(i4.address), v2 = c3 ? `${c3}://${r}` : r, y5 = i4.statement ? `${i4.statement}
` : "", b3 = `${v2} wants you to sign in with your Ethereum account:
${d}

${y5}`, m4 = `URI: ${_6}
Version: ${w6}
Chain ID: ${t2}${o4 ? `
Nonce: ${o4}` : ""}
Issued At: ${n3.toISOString()}`;
  if (s && (m4 += `
Expiration Time: ${s.toISOString()}`), a && (m4 += `
Not Before: ${a.toISOString()}`), l && (m4 += `
Request ID: ${l}`), u2) {
    let p4 = `
Resources:`;
    for (let g3 of u2) {
      if (!g3 || typeof g3 != "string") throw new Error(`@supabase/auth-js: Invalid SIWE message field "resources". Every resource must be a valid string. Provided value: ${g3}`);
      p4 += `
- ${g3}`;
    }
    m4 += p4;
  }
  return `${b3}
${m4}`;
}
var S2 = class extends Error {
  constructor({ message: e, code: t2, cause: r, name: s }) {
    var n3;
    super(e, {
      cause: r
    }), this.__isWebAuthnError = true, this.name = (n3 = s ?? (r instanceof Error ? r.name : void 0)) !== null && n3 !== void 0 ? n3 : "Unknown Error", this.code = t2;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code
    };
  }
};
var re = class extends S2 {
  constructor(e, t2) {
    super({
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: t2,
      message: e
    }), this.name = "WebAuthnUnknownError", this.originalError = t2;
  }
};
function Pt({ error: i4, options: e }) {
  var t2, r, s;
  let { publicKey: n3 } = e;
  if (!n3) throw Error("options was missing required publicKey property");
  if (i4.name === "AbortError") {
    if (e.signal instanceof AbortSignal) return new S2({
      message: "Registration ceremony was sent an abort signal",
      code: "ERROR_CEREMONY_ABORTED",
      cause: i4
    });
  } else if (i4.name === "ConstraintError") {
    if (((t2 = n3.authenticatorSelection) === null || t2 === void 0 ? void 0 : t2.requireResidentKey) === true) return new S2({
      message: "Discoverable credentials were required but no available authenticator supported it",
      code: "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
      cause: i4
    });
    if (e.mediation === "conditional" && ((r = n3.authenticatorSelection) === null || r === void 0 ? void 0 : r.userVerification) === "required") return new S2({
      message: "User verification was required during automatic registration but it could not be performed",
      code: "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",
      cause: i4
    });
    if (((s = n3.authenticatorSelection) === null || s === void 0 ? void 0 : s.userVerification) === "required") return new S2({
      message: "User verification was required but no available authenticator supported it",
      code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
      cause: i4
    });
  } else {
    if (i4.name === "InvalidStateError") return new S2({
      message: "The authenticator was previously registered",
      code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      cause: i4
    });
    if (i4.name === "NotAllowedError") return new S2({
      message: i4.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: i4
    });
    if (i4.name === "NotSupportedError") return n3.pubKeyCredParams.filter((a) => a.type === "public-key").length === 0 ? new S2({
      message: 'No entry in pubKeyCredParams was of type "public-key"',
      code: "ERROR_MALFORMED_PUBKEYCREDPARAMS",
      cause: i4
    }) : new S2({
      message: "No available authenticator supported any of the specified pubKeyCredParams algorithms",
      code: "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
      cause: i4
    });
    if (i4.name === "SecurityError") {
      let o4 = globalThis.location.hostname;
      if (Me(o4)) {
        if (n3.rp.id !== o4) return new S2({
          message: `The RP ID "${n3.rp.id}" is invalid for this domain`,
          code: "ERROR_INVALID_RP_ID",
          cause: i4
        });
      } else return new S2({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: i4
      });
    } else if (i4.name === "TypeError") {
      if (n3.user.id.byteLength < 1 || n3.user.id.byteLength > 64) return new S2({
        message: "User ID was not between 1 and 64 characters",
        code: "ERROR_INVALID_USER_ID_LENGTH",
        cause: i4
      });
    } else if (i4.name === "UnknownError") return new S2({
      message: "The authenticator was unable to process the specified options, or could not create a new credential",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: i4
    });
  }
  return new S2({
    message: "a Non-Webauthn related error has occurred",
    code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    cause: i4
  });
}
function jt({ error: i4, options: e }) {
  let { publicKey: t2 } = e;
  if (!t2) throw Error("options was missing required publicKey property");
  if (i4.name === "AbortError") {
    if (e.signal instanceof AbortSignal) return new S2({
      message: "Authentication ceremony was sent an abort signal",
      code: "ERROR_CEREMONY_ABORTED",
      cause: i4
    });
  } else {
    if (i4.name === "NotAllowedError") return new S2({
      message: i4.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: i4
    });
    if (i4.name === "SecurityError") {
      let r = globalThis.location.hostname;
      if (Me(r)) {
        if (t2.rpId !== r) return new S2({
          message: `The RP ID "${t2.rpId}" is invalid for this domain`,
          code: "ERROR_INVALID_RP_ID",
          cause: i4
        });
      } else return new S2({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: i4
      });
    } else if (i4.name === "UnknownError") return new S2({
      message: "The authenticator was unable to process the specified options, or could not create a new assertion signature",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: i4
    });
  }
  return new S2({
    message: "a Non-Webauthn related error has occurred",
    code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    cause: i4
  });
}
var Fe = class {
  createNewAbortSignal() {
    if (this.controller) {
      let t2 = new Error("Cancelling existing WebAuthn API call for new one");
      t2.name = "AbortError", this.controller.abort(t2);
    }
    let e = new AbortController();
    return this.controller = e, e.signal;
  }
  cancelCeremony() {
    if (this.controller) {
      let e = new Error("Manually cancelling existing WebAuthn API call");
      e.name = "AbortError", this.controller.abort(e), this.controller = void 0;
    }
  }
};
var Ie = new Fe();
function We(i4) {
  if (!i4) throw new Error("Credential creation options are required");
  if (typeof PublicKeyCredential < "u" && "parseCreationOptionsFromJSON" in PublicKeyCredential && typeof PublicKeyCredential.parseCreationOptionsFromJSON == "function") return PublicKeyCredential.parseCreationOptionsFromJSON(i4);
  let { challenge: e, user: t2, excludeCredentials: r } = i4, s = S(i4, [
    "challenge",
    "user",
    "excludeCredentials"
  ]), n3 = z(e).buffer, o4 = Object.assign(Object.assign({}, t2), {
    id: z(t2.id).buffer
  }), a = Object.assign(Object.assign({}, s), {
    challenge: n3,
    user: o4
  });
  if (r && r.length > 0) {
    a.excludeCredentials = new Array(r.length);
    for (let l = 0; l < r.length; l++) {
      let u2 = r[l];
      a.excludeCredentials[l] = Object.assign(Object.assign({}, u2), {
        id: z(u2.id).buffer,
        type: u2.type || "public-key",
        transports: u2.transports
      });
    }
  }
  return a;
}
function Ge(i4) {
  if (!i4) throw new Error("Credential request options are required");
  if (typeof PublicKeyCredential < "u" && "parseRequestOptionsFromJSON" in PublicKeyCredential && typeof PublicKeyCredential.parseRequestOptionsFromJSON == "function") return PublicKeyCredential.parseRequestOptionsFromJSON(i4);
  let { challenge: e, allowCredentials: t2 } = i4, r = S(i4, [
    "challenge",
    "allowCredentials"
  ]), s = z(e).buffer, n3 = Object.assign(Object.assign({}, r), {
    challenge: s
  });
  if (t2 && t2.length > 0) {
    n3.allowCredentials = new Array(t2.length);
    for (let o4 = 0; o4 < t2.length; o4++) {
      let a = t2[o4];
      n3.allowCredentials[o4] = Object.assign(Object.assign({}, a), {
        id: z(a.id).buffer,
        type: a.type || "public-key",
        transports: a.transports
      });
    }
  }
  return n3;
}
function Be(i4) {
  var e;
  if ("toJSON" in i4 && typeof i4.toJSON == "function") return i4.toJSON();
  let t2 = i4;
  return {
    id: i4.id,
    rawId: i4.id,
    response: {
      attestationObject: G(new Uint8Array(i4.response.attestationObject)),
      clientDataJSON: G(new Uint8Array(i4.response.clientDataJSON))
    },
    type: "public-key",
    clientExtensionResults: i4.getClientExtensionResults(),
    authenticatorAttachment: (e = t2.authenticatorAttachment) !== null && e !== void 0 ? e : void 0
  };
}
function Ve(i4) {
  var e;
  if ("toJSON" in i4 && typeof i4.toJSON == "function") return i4.toJSON();
  let t2 = i4, r = i4.getClientExtensionResults(), s = i4.response;
  return {
    id: i4.id,
    rawId: i4.id,
    response: {
      authenticatorData: G(new Uint8Array(s.authenticatorData)),
      clientDataJSON: G(new Uint8Array(s.clientDataJSON)),
      signature: G(new Uint8Array(s.signature)),
      userHandle: s.userHandle ? G(new Uint8Array(s.userHandle)) : void 0
    },
    type: "public-key",
    clientExtensionResults: r,
    authenticatorAttachment: (e = t2.authenticatorAttachment) !== null && e !== void 0 ? e : void 0
  };
}
function Me(i4) {
  return i4 === "localhost" || /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(i4);
}
function ge() {
  var i4, e;
  return !!(A() && "PublicKeyCredential" in globalThis && globalThis.PublicKeyCredential && "credentials" in navigator && typeof ((i4 = navigator?.credentials) === null || i4 === void 0 ? void 0 : i4.create) == "function" && typeof ((e = navigator?.credentials) === null || e === void 0 ? void 0 : e.get) == "function");
}
async function ze(i4) {
  try {
    let e = await navigator.credentials.create(i4);
    return e ? e instanceof PublicKeyCredential ? {
      data: e,
      error: null
    } : {
      data: null,
      error: new re("Browser returned unexpected credential type", e)
    } : {
      data: null,
      error: new re("Empty credential response", e)
    };
  } catch (e) {
    return {
      data: null,
      error: Pt({
        error: e,
        options: i4
      })
    };
  }
}
async function Je(i4) {
  try {
    let e = await navigator.credentials.get(i4);
    return e ? e instanceof PublicKeyCredential ? {
      data: e,
      error: null
    } : {
      data: null,
      error: new re("Browser returned unexpected credential type", e)
    } : {
      data: null,
      error: new re("Empty credential response", e)
    };
  } catch (e) {
    return {
      data: null,
      error: jt({
        error: e,
        options: i4
      })
    };
  }
}
var tr = {
  hints: [
    "security-key"
  ],
  authenticatorSelection: {
    authenticatorAttachment: "cross-platform",
    requireResidentKey: false,
    userVerification: "preferred",
    residentKey: "discouraged"
  },
  attestation: "direct"
};
var rr = {
  userVerification: "preferred",
  hints: [
    "security-key"
  ],
  attestation: "direct"
};
function Ae(...i4) {
  let e = (s) => s !== null && typeof s == "object" && !Array.isArray(s), t2 = (s) => s instanceof ArrayBuffer || ArrayBuffer.isView(s), r = {};
  for (let s of i4) if (s) for (let n3 in s) {
    let o4 = s[n3];
    if (o4 !== void 0) if (Array.isArray(o4)) r[n3] = o4;
    else if (t2(o4)) r[n3] = o4;
    else if (e(o4)) {
      let a = r[n3];
      e(a) ? r[n3] = Ae(a, o4) : r[n3] = Ae(o4);
    } else r[n3] = o4;
  }
  return r;
}
function sr(i4, e) {
  return Ae(tr, i4, e || {});
}
function ir(i4, e) {
  return Ae(rr, i4, e || {});
}
var Te = class {
  constructor(e) {
    this.client = e, this.enroll = this._enroll.bind(this), this.challenge = this._challenge.bind(this), this.verify = this._verify.bind(this), this.authenticate = this._authenticate.bind(this), this.register = this._register.bind(this);
  }
  async _enroll(e) {
    return this.client.mfa.enroll(Object.assign(Object.assign({}, e), {
      factorType: "webauthn"
    }));
  }
  async _challenge({ factorId: e, webauthn: t2, friendlyName: r, signal: s }, n3) {
    var o4;
    try {
      let { data: a, error: l } = await this.client.mfa.challenge({
        factorId: e,
        webauthn: t2
      });
      if (!a) return {
        data: null,
        error: l
      };
      let u2 = s ?? Ie.createNewAbortSignal();
      if (a.webauthn.type === "create") {
        let { user: c3 } = a.webauthn.credential_options.publicKey;
        if (!c3.name) {
          let _6 = r;
          if (_6) c3.name = `${c3.id}:${_6}`;
          else {
            let d = (await this.client.getUser()).data.user, v2 = ((o4 = d?.user_metadata) === null || o4 === void 0 ? void 0 : o4.name) || d?.email || d?.id || "User";
            c3.name = `${c3.id}:${v2}`;
          }
        }
        c3.displayName || (c3.displayName = c3.name);
      }
      switch (a.webauthn.type) {
        case "create": {
          let c3 = sr(a.webauthn.credential_options.publicKey, n3?.create), { data: _6, error: w6 } = await ze({
            publicKey: c3,
            signal: u2
          });
          return _6 ? {
            data: {
              factorId: e,
              challengeId: a.id,
              webauthn: {
                type: a.webauthn.type,
                credential_response: _6
              }
            },
            error: null
          } : {
            data: null,
            error: w6
          };
        }
        case "request": {
          let c3 = ir(a.webauthn.credential_options.publicKey, n3?.request), { data: _6, error: w6 } = await Je(Object.assign(Object.assign({}, a.webauthn.credential_options), {
            publicKey: c3,
            signal: u2
          }));
          return _6 ? {
            data: {
              factorId: e,
              challengeId: a.id,
              webauthn: {
                type: a.webauthn.type,
                credential_response: _6
              }
            },
            error: null
          } : {
            data: null,
            error: w6
          };
        }
      }
    } catch (a) {
      return h(a) ? {
        data: null,
        error: a
      } : {
        data: null,
        error: new x("Unexpected error in challenge", a)
      };
    }
  }
  async _verify({ challengeId: e, factorId: t2, webauthn: r }) {
    return this.client.mfa.verify({
      factorId: t2,
      challengeId: e,
      webauthn: r
    });
  }
  async _authenticate({ factorId: e, webauthn: { rpId: t2 = typeof globalThis < "u" ? globalThis.location.hostname : void 0, rpOrigins: r = typeof globalThis < "u" ? [
    globalThis.location.origin
  ] : void 0, signal: s } = {} }, n3) {
    if (!t2) return {
      data: null,
      error: new B("rpId is required for WebAuthn authentication")
    };
    try {
      if (!ge()) return {
        data: null,
        error: new x("Browser does not support WebAuthn", null)
      };
      let { data: o4, error: a } = await this.challenge({
        factorId: e,
        webauthn: {
          rpId: t2,
          rpOrigins: r
        },
        signal: s
      }, {
        request: n3
      });
      if (!o4) return {
        data: null,
        error: a
      };
      let { webauthn: l } = o4;
      return this._verify({
        factorId: e,
        challengeId: o4.challengeId,
        webauthn: {
          type: l.type,
          rpId: t2,
          rpOrigins: r,
          credential_response: l.credential_response
        }
      });
    } catch (o4) {
      return h(o4) ? {
        data: null,
        error: o4
      } : {
        data: null,
        error: new x("Unexpected error in authenticate", o4)
      };
    }
  }
  async _register({ friendlyName: e, webauthn: { rpId: t2 = typeof globalThis < "u" ? globalThis.location.hostname : void 0, rpOrigins: r = typeof globalThis < "u" ? [
    globalThis.location.origin
  ] : void 0, signal: s } = {} }, n3) {
    if (!t2) return {
      data: null,
      error: new B("rpId is required for WebAuthn registration")
    };
    try {
      if (!ge()) return {
        data: null,
        error: new x("Browser does not support WebAuthn", null)
      };
      let { data: o4, error: a } = await this._enroll({
        friendlyName: e
      });
      if (!o4) return await this.client.mfa.listFactors().then((c3) => {
        var _6;
        return (_6 = c3.data) === null || _6 === void 0 ? void 0 : _6.all.find((w6) => w6.factor_type === "webauthn" && w6.friendly_name === e && w6.status !== "unverified");
      }).then((c3) => c3 ? this.client.mfa.unenroll({
        factorId: c3?.id
      }) : void 0), {
        data: null,
        error: a
      };
      let { data: l, error: u2 } = await this._challenge({
        factorId: o4.id,
        friendlyName: o4.friendly_name,
        webauthn: {
          rpId: t2,
          rpOrigins: r
        },
        signal: s
      }, {
        create: n3
      });
      return l ? this._verify({
        factorId: o4.id,
        challengeId: l.challengeId,
        webauthn: {
          rpId: t2,
          rpOrigins: r,
          type: l.webauthn.type,
          credential_response: l.webauthn.credential_response
        }
      }) : {
        data: null,
        error: u2
      };
    } catch (o4) {
      return h(o4) ? {
        data: null,
        error: o4
      } : {
        data: null,
        error: new x("Unexpected error in register", o4)
      };
    }
  }
};
It();
var nr = {
  url: Xe,
  storageKey: Ze,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  headers: Qe,
  flowType: "implicit",
  debug: false,
  hasCustomAuthorizationHeader: false,
  throwOnError: false,
  lockAcquireTimeout: 5e3,
  skipAutoInitialize: false,
  experimental: {}
};
var ie = {};
var xe = class i2 {
  get jwks() {
    var e, t2;
    return (t2 = (e = ie[this.storageKey]) === null || e === void 0 ? void 0 : e.jwks) !== null && t2 !== void 0 ? t2 : {
      keys: []
    };
  }
  set jwks(e) {
    ie[this.storageKey] = Object.assign(Object.assign({}, ie[this.storageKey]), {
      jwks: e
    });
  }
  get jwks_cached_at() {
    var e, t2;
    return (t2 = (e = ie[this.storageKey]) === null || e === void 0 ? void 0 : e.cachedAt) !== null && t2 !== void 0 ? t2 : Number.MIN_SAFE_INTEGER;
  }
  set jwks_cached_at(e) {
    ie[this.storageKey] = Object.assign(Object.assign({}, ie[this.storageKey]), {
      cachedAt: e
    });
  }
  constructor(e) {
    var t2, r, s;
    this.userStorage = null, this.memoryStorage = null, this.stateChangeEmitters = /* @__PURE__ */ new Map(), this.autoRefreshTicker = null, this.autoRefreshTickTimeout = null, this.visibilityChangedCallback = null, this.refreshingDeferred = null, this.lastRefreshFailure = null, this._sessionRemovalEpoch = 0, this.initializePromise = null, this._pendingInitNotifications = null, this.detectSessionInUrl = true, this.hasCustomAuthorizationHeader = false, this.suppressGetSessionWarning = false, this.lock = null, this.lockAcquired = false, this.pendingInLock = [], this.broadcastChannel = null, this.logger = console.log;
    let n3 = Object.assign(Object.assign({}, nr), e);
    if (this.storageKey = n3.storageKey, this.instanceID = (t2 = i2.nextInstanceID[this.storageKey]) !== null && t2 !== void 0 ? t2 : 0, i2.nextInstanceID[this.storageKey] = this.instanceID + 1, this.logDebugMessages = !!n3.debug, typeof n3.debug == "function" && (this.logger = n3.debug), this.instanceID > 0 && A()) {
      let o4 = `${this._logPrefix()} Multiple GoTrueClient instances detected in the same browser context. It is not an error, but this should be avoided as it may produce undefined behavior when used concurrently under the same storage key.`;
      console.warn(o4), this.logDebugMessages && console.trace(o4);
    }
    if (this.persistSession = n3.persistSession, this.autoRefreshToken = n3.autoRefreshToken, this.experimental = (r = n3.experimental) !== null && r !== void 0 ? r : {}, this.admin = new J({
      url: n3.url,
      headers: n3.headers,
      fetch: n3.fetch,
      experimental: this.experimental
    }), this.url = n3.url, this.headers = n3.headers, this.fetch = ke(n3.fetch), this.detectSessionInUrl = n3.detectSessionInUrl, this.flowType = n3.flowType, this.hasCustomAuthorizationHeader = n3.hasCustomAuthorizationHeader, this.throwOnError = n3.throwOnError, this.lockAcquireTimeout = n3.lockAcquireTimeout, n3.lock != null && (this.lock = n3.lock), this.jwks || (this.jwks = {
      keys: []
    }, this.jwks_cached_at = Number.MIN_SAFE_INTEGER), this.mfa = {
      verify: this._verify.bind(this),
      enroll: this._enroll.bind(this),
      unenroll: this._unenroll.bind(this),
      challenge: this._challenge.bind(this),
      listFactors: this._listFactors.bind(this),
      challengeAndVerify: this._challengeAndVerify.bind(this),
      getAuthenticatorAssuranceLevel: this._getAuthenticatorAssuranceLevel.bind(this),
      webauthn: new Te(this)
    }, this.oauth = {
      getAuthorizationDetails: this._getAuthorizationDetails.bind(this),
      approveAuthorization: this._approveAuthorization.bind(this),
      denyAuthorization: this._denyAuthorization.bind(this),
      listGrants: this._listOAuthGrants.bind(this),
      revokeGrant: this._revokeOAuthGrant.bind(this)
    }, this.passkey = {
      startRegistration: this._startPasskeyRegistration.bind(this),
      verifyRegistration: this._verifyPasskeyRegistration.bind(this),
      startAuthentication: this._startPasskeyAuthentication.bind(this),
      verifyAuthentication: this._verifyPasskeyAuthentication.bind(this),
      list: this._listPasskeys.bind(this),
      update: this._updatePasskey.bind(this),
      delete: this._deletePasskey.bind(this)
    }, this.persistSession ? (n3.storage ? this.storage = n3.storage : Re() ? this.storage = globalThis.localStorage : (this.memoryStorage = {}, this.storage = De(this.memoryStorage)), n3.userStorage && (this.userStorage = n3.userStorage)) : (this.memoryStorage = {}, this.storage = De(this.memoryStorage)), A() && globalThis.BroadcastChannel && this.persistSession && this.storageKey) {
      try {
        this.broadcastChannel = new globalThis.BroadcastChannel(this.storageKey);
      } catch (o4) {
        console.error("Failed to create a new BroadcastChannel, multi-tab state changes will not be available", o4);
      }
      (s = this.broadcastChannel) === null || s === void 0 || s.addEventListener("message", async (o4) => {
        this._debug("received broadcast notification from other tab or client", o4), (o4.data.event === "TOKEN_REFRESHED" || o4.data.event === "SIGNED_IN") && (this.lastRefreshFailure = null);
        try {
          await this._notifyAllSubscribers(o4.data.event, o4.data.session, false);
        } catch (a) {
          this._debug("#broadcastChannel", "error", a);
        }
      });
    }
    n3.skipAutoInitialize || this.initialize().catch((o4) => {
      this._debug("#initialize()", "error", o4);
    });
  }
  isThrowOnErrorEnabled() {
    return this.throwOnError;
  }
  _returnResult(e) {
    if (this.throwOnError && e && e.error) throw e.error;
    return e;
  }
  _logPrefix() {
    return `GoTrueClient@${this.storageKey}:${this.instanceID} (${pe}) ${(/* @__PURE__ */ new Date()).toISOString()}`;
  }
  _debug(...e) {
    return this.logDebugMessages && this.logger(this._logPrefix(), ...e), this;
  }
  async initialize() {
    var e;
    if (this.initializePromise) return await this.initializePromise;
    this._pendingInitNotifications = [], this.initializePromise = (async () => this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._initialize()) : await this._initialize())();
    let t2 = await this.initializePromise, r = (e = this._pendingInitNotifications) !== null && e !== void 0 ? e : [];
    this._pendingInitNotifications = null;
    for (let s of r) await this._notifyAllSubscribers(s.event, s.session, s.broadcast);
    return t2;
  }
  async _initialize() {
    var e;
    try {
      let t2 = {}, r = "none";
      if (A() && (t2 = je(globalThis.location.href), this._isImplicitGrantCallback(t2) ? r = "implicit" : await this._isPKCECallback(t2) && (r = "pkce")), A() && this.detectSessionInUrl && r !== "none") {
        let { data: s, error: n3 } = await this._getSessionFromURL(t2, r);
        if (n3) {
          if (this._debug("#_initialize()", "error detecting session from URL", n3), st(n3)) {
            let l = (e = n3.details) === null || e === void 0 ? void 0 : e.code;
            if (l === "identity_already_exists" || l === "identity_not_found" || l === "single_identity_not_deletable") return {
              error: n3
            };
          }
          return {
            error: n3
          };
        }
        let { session: o4, redirectType: a } = s;
        return this._debug("#_initialize()", "detected session in URL", o4, "redirect type", a), await this._saveSession(o4), setTimeout(async () => {
          a === "recovery" ? await this._notifyAllSubscribers("PASSWORD_RECOVERY", o4) : await this._notifyAllSubscribers("SIGNED_IN", o4);
        }, 0), {
          error: null
        };
      }
      return await this._recoverAndRefresh(), {
        error: null
      };
    } catch (t2) {
      return h(t2) ? this._returnResult({
        error: t2
      }) : this._returnResult({
        error: new x("Unexpected error during initialization", t2)
      });
    } finally {
      await this._handleVisibilityChange(), this._debug("#_initialize()", "end");
    }
  }
  async signInAnonymously(e) {
    var t2, r, s;
    try {
      let n3 = await f(this.fetch, "POST", `${this.url}/signup`, {
        headers: this.headers,
        body: {
          data: (r = (t2 = e?.options) === null || t2 === void 0 ? void 0 : t2.data) !== null && r !== void 0 ? r : {},
          gotrue_meta_security: {
            captcha_token: (s = e?.options) === null || s === void 0 ? void 0 : s.captchaToken
          }
        },
        xform: P
      }), { data: o4, error: a } = n3;
      if (a || !o4) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: a
      });
      let l = o4.session, u2 = o4.user;
      return o4.session && (await this._saveSession(o4.session), await this._notifyAllSubscribers("SIGNED_IN", l)), this._returnResult({
        data: {
          user: u2,
          session: l
        },
        error: null
      });
    } catch (n3) {
      if (h(n3)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: n3
      });
      throw n3;
    }
  }
  async signUp(e) {
    var t2, r, s;
    let n3 = null;
    try {
      let o4;
      if ("email" in e) {
        let { email: _6, password: w6, options: d } = e, v2 = null, y5 = null;
        this.flowType === "pkce" && ([v2, y5, n3] = await this._getCodeChallengeAndMethod()), o4 = await f(this.fetch, "POST", `${this.url}/signup`, {
          headers: this.headers,
          redirectTo: this._maybeAppendFlowIdToRedirect(d?.emailRedirectTo, n3),
          body: {
            email: _6,
            password: w6,
            data: (t2 = d?.data) !== null && t2 !== void 0 ? t2 : {},
            gotrue_meta_security: {
              captcha_token: d?.captchaToken
            },
            code_challenge: v2,
            code_challenge_method: y5
          },
          xform: P
        });
      } else if ("phone" in e) {
        let { phone: _6, password: w6, options: d } = e;
        o4 = await f(this.fetch, "POST", `${this.url}/signup`, {
          headers: this.headers,
          body: {
            phone: _6,
            password: w6,
            data: (r = d?.data) !== null && r !== void 0 ? r : {},
            channel: (s = d?.channel) !== null && s !== void 0 ? s : "sms",
            gotrue_meta_security: {
              captcha_token: d?.captchaToken
            }
          },
          xform: P
        });
      } else throw new Y("You must provide either an email or phone number and a password");
      let { data: a, error: l } = o4;
      if (l || !a) return await $(this.storage, this.storageKey, n3), this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: l
      });
      let u2 = a.session, c3 = a.user;
      return a.session && (await this._saveSession(a.session), await this._notifyAllSubscribers("SIGNED_IN", u2)), this._returnResult({
        data: {
          user: c3,
          session: u2
        },
        error: null
      });
    } catch (o4) {
      if (await $(this.storage, this.storageKey, n3), h(o4)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: o4
      });
      throw o4;
    }
  }
  async signInWithPassword(e) {
    try {
      let t2;
      if ("email" in e) {
        let { email: n3, password: o4, options: a } = e;
        t2 = await f(this.fetch, "POST", `${this.url}/token?grant_type=password`, {
          headers: this.headers,
          body: {
            email: n3,
            password: o4,
            gotrue_meta_security: {
              captcha_token: a?.captchaToken
            }
          },
          xform: Ne
        });
      } else if ("phone" in e) {
        let { phone: n3, password: o4, options: a } = e;
        t2 = await f(this.fetch, "POST", `${this.url}/token?grant_type=password`, {
          headers: this.headers,
          body: {
            phone: n3,
            password: o4,
            gotrue_meta_security: {
              captcha_token: a?.captchaToken
            }
          },
          xform: Ne
        });
      } else throw new Y("You must provide either an email or phone number and a password");
      let { data: r, error: s } = t2;
      if (s) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: s
      });
      if (!r || !r.session || !r.user) {
        let n3 = new W();
        return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: n3
        });
      }
      return r.session && (await this._saveSession(r.session), await this._notifyAllSubscribers("SIGNED_IN", r.session)), this._returnResult({
        data: Object.assign({
          user: r.user,
          session: r.session
        }, r.weak_password ? {
          weakPassword: r.weak_password
        } : null),
        error: s
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: t2
      });
      throw t2;
    }
  }
  async signInWithOAuth(e) {
    var t2, r, s, n3;
    return await this._handleProviderSignIn(e.provider, {
      redirectTo: (t2 = e.options) === null || t2 === void 0 ? void 0 : t2.redirectTo,
      scopes: (r = e.options) === null || r === void 0 ? void 0 : r.scopes,
      queryParams: (s = e.options) === null || s === void 0 ? void 0 : s.queryParams,
      skipBrowserRedirect: (n3 = e.options) === null || n3 === void 0 ? void 0 : n3.skipBrowserRedirect
    });
  }
  async exchangeCodeForSession(e, t2) {
    return await this.initializePromise, this.lock != null ? this._acquireLock(this.lockAcquireTimeout, async () => this._exchangeCodeForSession(e, t2)) : this._exchangeCodeForSession(e, t2);
  }
  async signInWithWeb3(e) {
    let { chain: t2 } = e;
    switch (t2) {
      case "ethereum":
        return await this.signInWithEthereum(e);
      case "solana":
        return await this.signInWithSolana(e);
      default:
        throw new Error(`@supabase/auth-js: Unsupported chain "${t2}"`);
    }
  }
  async signInWithEthereum(e) {
    var t2, r, s, n3, o4, a, l, u2, c3, _6, w6;
    let d, v2;
    if ("message" in e) d = e.message, v2 = e.signature;
    else {
      let { chain: y5, wallet: b3, statement: m4, options: p4 } = e, g3;
      if (A()) if (typeof b3 == "object") g3 = b3;
      else {
        let M5 = globalThis;
        if ("ethereum" in M5 && typeof M5.ethereum == "object" && "request" in M5.ethereum && typeof M5.ethereum.request == "function") g3 = M5.ethereum;
        else throw new Error("@supabase/auth-js: No compatible Ethereum wallet interface on the window object (window.ethereum) detected. Make sure the user already has a wallet installed and connected for this app. Prefer passing the wallet interface object directly to signInWithWeb3({ chain: 'ethereum', wallet: resolvedUserWallet }) instead.");
      }
      else {
        if (typeof b3 != "object" || !p4?.url) throw new Error("@supabase/auth-js: Both wallet and url must be specified in non-browser environments.");
        g3 = b3;
      }
      let k5 = new URL((t2 = p4?.url) !== null && t2 !== void 0 ? t2 : globalThis.location.href), j6 = await g3.request({
        method: "eth_requestAccounts"
      }).then((M5) => M5).catch(() => {
        throw new Error("@supabase/auth-js: Wallet method eth_requestAccounts is missing or invalid");
      });
      if (!j6 || j6.length === 0) throw new Error("@supabase/auth-js: No accounts available. Please ensure the wallet is connected.");
      let R5 = Ke(j6[0]), T6 = (r = p4?.signInWithEthereum) === null || r === void 0 ? void 0 : r.chainId;
      if (!T6) {
        let M5 = await g3.request({
          method: "eth_chainId"
        });
        T6 = xt(M5);
      }
      let $t = {
        domain: k5.host,
        address: R5,
        statement: m4,
        uri: k5.href,
        version: "1",
        chainId: T6,
        nonce: (s = p4?.signInWithEthereum) === null || s === void 0 ? void 0 : s.nonce,
        issuedAt: (o4 = (n3 = p4?.signInWithEthereum) === null || n3 === void 0 ? void 0 : n3.issuedAt) !== null && o4 !== void 0 ? o4 : /* @__PURE__ */ new Date(),
        expirationTime: (a = p4?.signInWithEthereum) === null || a === void 0 ? void 0 : a.expirationTime,
        notBefore: (l = p4?.signInWithEthereum) === null || l === void 0 ? void 0 : l.notBefore,
        requestId: (u2 = p4?.signInWithEthereum) === null || u2 === void 0 ? void 0 : u2.requestId,
        resources: (c3 = p4?.signInWithEthereum) === null || c3 === void 0 ? void 0 : c3.resources
      };
      d = Ct($t), v2 = await g3.request({
        method: "personal_sign",
        params: [
          Ot(d),
          R5
        ]
      });
    }
    try {
      let { data: y5, error: b3 } = await f(this.fetch, "POST", `${this.url}/token?grant_type=web3`, {
        headers: this.headers,
        body: Object.assign({
          chain: "ethereum",
          message: d,
          signature: v2
        }, !((_6 = e.options) === null || _6 === void 0) && _6.captchaToken ? {
          gotrue_meta_security: {
            captcha_token: (w6 = e.options) === null || w6 === void 0 ? void 0 : w6.captchaToken
          }
        } : null),
        xform: P
      });
      if (b3) throw b3;
      if (!y5 || !y5.session || !y5.user) {
        let m4 = new W();
        return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: m4
        });
      }
      return y5.session && (await this._saveSession(y5.session), await this._notifyAllSubscribers("SIGNED_IN", y5.session)), this._returnResult({
        data: Object.assign({}, y5),
        error: b3
      });
    } catch (y5) {
      if (h(y5)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: y5
      });
      throw y5;
    }
  }
  async signInWithSolana(e) {
    var t2, r, s, n3, o4, a, l, u2, c3, _6, w6, d;
    let v2, y5;
    if ("message" in e) v2 = e.message, y5 = e.signature;
    else {
      let { chain: b3, wallet: m4, statement: p4, options: g3 } = e, k5;
      if (A()) if (typeof m4 == "object") k5 = m4;
      else {
        let R5 = globalThis;
        if ("solana" in R5 && typeof R5.solana == "object" && ("signIn" in R5.solana && typeof R5.solana.signIn == "function" || "signMessage" in R5.solana && typeof R5.solana.signMessage == "function")) k5 = R5.solana;
        else throw new Error("@supabase/auth-js: No compatible Solana wallet interface on the window object (window.solana) detected. Make sure the user already has a wallet installed and connected for this app. Prefer passing the wallet interface object directly to signInWithWeb3({ chain: 'solana', wallet: resolvedUserWallet }) instead.");
      }
      else {
        if (typeof m4 != "object" || !g3?.url) throw new Error("@supabase/auth-js: Both wallet and url must be specified in non-browser environments.");
        k5 = m4;
      }
      let j6 = new URL((t2 = g3?.url) !== null && t2 !== void 0 ? t2 : globalThis.location.href);
      if ("signIn" in k5 && k5.signIn) {
        let R5 = await k5.signIn(Object.assign(Object.assign(Object.assign({
          issuedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, g3?.signInWithSolana), {
          version: "1",
          domain: j6.host,
          uri: j6.href
        }), p4 ? {
          statement: p4
        } : null)), T6;
        if (Array.isArray(R5) && R5[0] && typeof R5[0] == "object") T6 = R5[0];
        else if (R5 && typeof R5 == "object" && "signedMessage" in R5 && "signature" in R5) T6 = R5;
        else throw new Error("@supabase/auth-js: Wallet method signIn() returned unrecognized value");
        if ("signedMessage" in T6 && "signature" in T6 && (typeof T6.signedMessage == "string" || T6.signedMessage instanceof Uint8Array) && T6.signature instanceof Uint8Array) v2 = typeof T6.signedMessage == "string" ? T6.signedMessage : new TextDecoder().decode(T6.signedMessage), y5 = T6.signature;
        else throw new Error("@supabase/auth-js: Wallet method signIn() API returned object without signedMessage and signature fields");
      } else {
        if (!("signMessage" in k5) || typeof k5.signMessage != "function" || !("publicKey" in k5) || typeof k5 != "object" || !k5.publicKey || !("toBase58" in k5.publicKey) || typeof k5.publicKey.toBase58 != "function") throw new Error("@supabase/auth-js: Wallet does not have a compatible signMessage() and publicKey.toBase58() API");
        v2 = [
          `${j6.host} wants you to sign in with your Solana account:`,
          k5.publicKey.toBase58(),
          ...p4 ? [
            "",
            p4,
            ""
          ] : [
            ""
          ],
          "Version: 1",
          `URI: ${j6.href}`,
          `Issued At: ${(s = (r = g3?.signInWithSolana) === null || r === void 0 ? void 0 : r.issuedAt) !== null && s !== void 0 ? s : (/* @__PURE__ */ new Date()).toISOString()}`,
          ...!((n3 = g3?.signInWithSolana) === null || n3 === void 0) && n3.notBefore ? [
            `Not Before: ${g3.signInWithSolana.notBefore}`
          ] : [],
          ...!((o4 = g3?.signInWithSolana) === null || o4 === void 0) && o4.expirationTime ? [
            `Expiration Time: ${g3.signInWithSolana.expirationTime}`
          ] : [],
          ...!((a = g3?.signInWithSolana) === null || a === void 0) && a.chainId ? [
            `Chain ID: ${g3.signInWithSolana.chainId}`
          ] : [],
          ...!((l = g3?.signInWithSolana) === null || l === void 0) && l.nonce ? [
            `Nonce: ${g3.signInWithSolana.nonce}`
          ] : [],
          ...!((u2 = g3?.signInWithSolana) === null || u2 === void 0) && u2.requestId ? [
            `Request ID: ${g3.signInWithSolana.requestId}`
          ] : [],
          ...!((_6 = (c3 = g3?.signInWithSolana) === null || c3 === void 0 ? void 0 : c3.resources) === null || _6 === void 0) && _6.length ? [
            "Resources",
            ...g3.signInWithSolana.resources.map((T6) => `- ${T6}`)
          ] : []
        ].join(`
`);
        let R5 = await k5.signMessage(new TextEncoder().encode(v2), "utf8");
        if (!R5 || !(R5 instanceof Uint8Array)) throw new Error("@supabase/auth-js: Wallet signMessage() API returned an recognized value");
        y5 = R5;
      }
    }
    try {
      let { data: b3, error: m4 } = await f(this.fetch, "POST", `${this.url}/token?grant_type=web3`, {
        headers: this.headers,
        body: Object.assign({
          chain: "solana",
          message: v2,
          signature: G(y5)
        }, !((w6 = e.options) === null || w6 === void 0) && w6.captchaToken ? {
          gotrue_meta_security: {
            captcha_token: (d = e.options) === null || d === void 0 ? void 0 : d.captchaToken
          }
        } : null),
        xform: P
      });
      if (m4) throw m4;
      if (!b3 || !b3.session || !b3.user) {
        let p4 = new W();
        return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: p4
        });
      }
      return b3.session && (await this._saveSession(b3.session), await this._notifyAllSubscribers("SIGNED_IN", b3.session)), this._returnResult({
        data: Object.assign({}, b3),
        error: m4
      });
    } catch (b3) {
      if (h(b3)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: b3
      });
      throw b3;
    }
  }
  async _exchangeCodeForSession(e, t2) {
    let r = t2?.flowId != null, s = r ? _e(t2?.flowId) : A() ? _e(je(globalThis.location.href)[F2]) : null;
    r && !s && this._debug("#_exchangeCodeForSession()", "provided flowId is not a valid flow id", t2?.flowId);
    let { verifier: n3, flowId: o4 } = r && !s ? {
      verifier: null,
      flowId: null
    } : await wt(this.storage, this.storageKey, s), [a, l] = (n3 ?? "").split("/");
    try {
      if (!a && this.flowType === "pkce") throw new be();
      let { data: u2, error: c3 } = await f(this.fetch, "POST", `${this.url}/token?grant_type=pkce`, {
        headers: this.headers,
        body: {
          auth_code: e,
          code_verifier: a
        },
        xform: P
      });
      if (await $(this.storage, this.storageKey, o4), c3) throw c3;
      if (!u2 || !u2.session || !u2.user) {
        let _6 = new W();
        return this._returnResult({
          data: {
            user: null,
            session: null,
            redirectType: null
          },
          error: _6
        });
      }
      return u2.session && (await this._saveSession(u2.session), await this._notifyAllSubscribers(l === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN", u2.session)), this._returnResult({
        data: Object.assign(Object.assign({}, u2), {
          redirectType: l ?? null
        }),
        error: c3
      });
    } catch (u2) {
      if (await $(this.storage, this.storageKey, o4), h(u2)) return this._returnResult({
        data: {
          user: null,
          session: null,
          redirectType: null
        },
        error: u2
      });
      throw u2;
    }
  }
  async signInWithIdToken(e) {
    try {
      let { options: t2, provider: r, token: s, access_token: n3, nonce: o4 } = e, a = await f(this.fetch, "POST", `${this.url}/token?grant_type=id_token`, {
        headers: this.headers,
        body: {
          provider: r,
          id_token: s,
          access_token: n3,
          nonce: o4,
          gotrue_meta_security: {
            captcha_token: t2?.captchaToken
          }
        },
        xform: P
      }), { data: l, error: u2 } = a;
      if (u2) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: u2
      });
      if (!l || !l.session || !l.user) {
        let c3 = new W();
        return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: c3
        });
      }
      return l.session && (await this._saveSession(l.session), await this._notifyAllSubscribers("SIGNED_IN", l.session)), this._returnResult({
        data: l,
        error: u2
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: t2
      });
      throw t2;
    }
  }
  async signInWithOtp(e) {
    var t2, r, s, n3, o4;
    let a = null;
    try {
      if ("email" in e) {
        let { email: l, options: u2 } = e, c3 = null, _6 = null;
        this.flowType === "pkce" && ([c3, _6, a] = await this._getCodeChallengeAndMethod());
        let { error: w6 } = await f(this.fetch, "POST", `${this.url}/otp`, {
          headers: this.headers,
          body: {
            email: l,
            data: (t2 = u2?.data) !== null && t2 !== void 0 ? t2 : {},
            create_user: (r = u2?.shouldCreateUser) !== null && r !== void 0 ? r : true,
            gotrue_meta_security: {
              captcha_token: u2?.captchaToken
            },
            code_challenge: c3,
            code_challenge_method: _6
          },
          redirectTo: this._maybeAppendFlowIdToRedirect(u2?.emailRedirectTo, a)
        });
        return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: w6
        });
      }
      if ("phone" in e) {
        let { phone: l, options: u2 } = e, { data: c3, error: _6 } = await f(this.fetch, "POST", `${this.url}/otp`, {
          headers: this.headers,
          body: {
            phone: l,
            data: (s = u2?.data) !== null && s !== void 0 ? s : {},
            create_user: (n3 = u2?.shouldCreateUser) !== null && n3 !== void 0 ? n3 : true,
            gotrue_meta_security: {
              captcha_token: u2?.captchaToken
            },
            channel: (o4 = u2?.channel) !== null && o4 !== void 0 ? o4 : "sms"
          }
        });
        return this._returnResult({
          data: {
            user: null,
            session: null,
            messageId: c3?.message_id
          },
          error: _6
        });
      }
      throw new Y("You must provide either an email or phone number.");
    } catch (l) {
      if (await $(this.storage, this.storageKey, a), h(l)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: l
      });
      throw l;
    }
  }
  async verifyOtp(e) {
    var t2, r;
    try {
      let s, n3;
      "options" in e && (s = (t2 = e.options) === null || t2 === void 0 ? void 0 : t2.redirectTo, n3 = (r = e.options) === null || r === void 0 ? void 0 : r.captchaToken);
      let { data: o4, error: a } = await f(this.fetch, "POST", `${this.url}/verify`, {
        headers: this.headers,
        body: Object.assign(Object.assign({}, e), {
          gotrue_meta_security: {
            captcha_token: n3
          }
        }),
        redirectTo: s,
        xform: P
      });
      if (a) throw a;
      if (!o4) throw new Error("An error occurred on token verification.");
      let l = o4.session, u2 = o4.user;
      return l?.access_token && (await this._saveSession(l), await this._notifyAllSubscribers(e.type == "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN", l)), this._returnResult({
        data: {
          user: u2,
          session: l
        },
        error: null
      });
    } catch (s) {
      if (h(s)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: s
      });
      throw s;
    }
  }
  async signInWithSSO(e) {
    var t2, r, s, n3;
    let o4 = null;
    try {
      let a = null, l = null;
      this.flowType === "pkce" && ([a, l, o4] = await this._getCodeChallengeAndMethod());
      let u2 = await f(this.fetch, "POST", `${this.url}/sso`, {
        body: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, "providerId" in e ? {
          provider_id: e.providerId
        } : null), "domain" in e ? {
          domain: e.domain
        } : null), {
          redirect_to: this._maybeAppendFlowIdToRedirect((t2 = e.options) === null || t2 === void 0 ? void 0 : t2.redirectTo, o4)
        }), !((r = e?.options) === null || r === void 0) && r.captchaToken ? {
          gotrue_meta_security: {
            captcha_token: e.options.captchaToken
          }
        } : null), {
          skip_http_redirect: true,
          code_challenge: a,
          code_challenge_method: l
        }),
        headers: this.headers,
        xform: Et
      });
      return !((s = u2.data) === null || s === void 0) && s.url && A() && !(!((n3 = e.options) === null || n3 === void 0) && n3.skipBrowserRedirect) && globalThis.location.assign(u2.data.url), this._returnResult(u2);
    } catch (a) {
      if (await $(this.storage, this.storageKey, o4), h(a)) return this._returnResult({
        data: null,
        error: a
      });
      throw a;
    }
  }
  async reauthenticate() {
    return await this.initializePromise, this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._reauthenticate()) : await this._reauthenticate();
  }
  async _reauthenticate() {
    try {
      return await this._useSession(async (e) => {
        let { data: { session: t2 }, error: r } = e;
        if (r) throw r;
        if (!t2) throw new E();
        let { error: s } = await f(this.fetch, "GET", `${this.url}/reauthenticate`, {
          headers: this.headers,
          jwt: t2.access_token
        });
        return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: s
        });
      });
    } catch (e) {
      if (h(e)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: e
      });
      throw e;
    }
  }
  async resend(e) {
    let t2 = null;
    try {
      let r = `${this.url}/resend`;
      if ("email" in e) {
        let { email: s, type: n3, options: o4 } = e, a = null, l = null;
        this.flowType === "pkce" && ([a, l, t2] = await this._getCodeChallengeAndMethod());
        let { error: u2 } = await f(this.fetch, "POST", r, {
          headers: this.headers,
          body: {
            email: s,
            type: n3,
            gotrue_meta_security: {
              captcha_token: o4?.captchaToken
            },
            code_challenge: a,
            code_challenge_method: l
          },
          redirectTo: this._maybeAppendFlowIdToRedirect(o4?.emailRedirectTo, t2)
        });
        return u2 && await $(this.storage, this.storageKey, t2), this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: u2
        });
      } else if ("phone" in e) {
        let { phone: s, type: n3, options: o4 } = e, { data: a, error: l } = await f(this.fetch, "POST", r, {
          headers: this.headers,
          body: {
            phone: s,
            type: n3,
            gotrue_meta_security: {
              captcha_token: o4?.captchaToken
            }
          }
        });
        return this._returnResult({
          data: {
            user: null,
            session: null,
            messageId: a?.message_id
          },
          error: l
        });
      }
      throw new Y("You must provide either an email or phone number and a type");
    } catch (r) {
      if (await $(this.storage, this.storageKey, t2), h(r)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: r
      });
      throw r;
    }
  }
  async getSession() {
    return await this.initializePromise, this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => this._useSession(async (e) => e)) : await this._useSession(async (e) => e);
  }
  async _acquireLock(e, t2) {
    this._debug("#_acquireLock", "begin", e);
    try {
      if (this.lockAcquired) {
        let r = this.pendingInLock.length ? this.pendingInLock[this.pendingInLock.length - 1] : Promise.resolve(), s = (async () => (await r, await t2()))();
        return this.pendingInLock.push((async () => {
          try {
            await s;
          } catch {
          }
        })()), s;
      }
      return await this.lock(`lock:${this.storageKey}`, e, async () => {
        this._debug("#_acquireLock", "lock acquired for storage key", this.storageKey);
        try {
          this.lockAcquired = true;
          let r = t2();
          for (this.pendingInLock.push((async () => {
            try {
              await r;
            } catch {
            }
          })()), await r; this.pendingInLock.length; ) {
            let s = [
              ...this.pendingInLock
            ];
            await Promise.all(s), this.pendingInLock.splice(0, s.length);
          }
          return await r;
        } finally {
          this._debug("#_acquireLock", "lock released for storage key", this.storageKey), this.lockAcquired = false;
        }
      });
    } finally {
      this._debug("#_acquireLock", "end");
    }
  }
  async _useSession(e) {
    this._debug("#_useSession", "begin");
    try {
      let t2 = await this.__loadSession();
      return await e(t2);
    } finally {
      this._debug("#_useSession", "end");
    }
  }
  async __loadSession() {
    this._debug("#__loadSession()", "begin"), this.lock != null && !this.lockAcquired && this._debug("#__loadSession()", "used outside of an acquired lock!", new Error().stack);
    try {
      let e = null, t2 = await I(this.storage, this.storageKey);
      if (this._debug("#getSession()", "session from storage", t2), t2 !== null && (this._isValidSession(t2) ? e = t2 : (this._debug("#getSession()", "session from storage is not valid"), await this._removeSession())), !e) return {
        data: {
          session: null
        },
        error: null
      };
      let r = e.expires_at ? e.expires_at * 1e3 - Date.now() < ye : false;
      if (this._debug("#__loadSession()", `session has${r ? "" : " not"} expired`, "expires_at", e.expires_at), !r) {
        if (this.userStorage) {
          let o4 = await I(this.userStorage, this.storageKey + "-user");
          o4?.user ? e.user = o4.user : e.user = Se();
        }
        if (this.storage.isServer && e.user && !e.user.__isUserNotAvailableProxy) {
          let o4 = {
            value: this.suppressGetSessionWarning
          };
          e.user = Rt(e.user, o4), o4.value && (this.suppressGetSessionWarning = true);
        }
        return {
          data: {
            session: e
          },
          error: null
        };
      }
      let { data: s, error: n3 } = await this._callRefreshToken(e.refresh_token);
      if (n3) {
        if (!!(e.expires_at && e.expires_at * 1e3 > Date.now())) {
          let a = await I(this.storage, this.storageKey);
          if (a && a.refresh_token === e.refresh_token) return this._returnResult({
            data: {
              session: e
            },
            error: null
          });
        }
        return this._returnResult({
          data: {
            session: null
          },
          error: n3
        });
      }
      return this._returnResult({
        data: {
          session: s
        },
        error: null
      });
    } finally {
      this._debug("#__loadSession()", "end");
    }
  }
  async getUser(e) {
    if (e) return await this._getUser(e);
    await this.initializePromise;
    let t2;
    return this.lock != null ? t2 = await this._acquireLock(this.lockAcquireTimeout, async () => await this._getUser()) : t2 = await this._getUser(), t2.data.user && (this.suppressGetSessionWarning = true), t2;
  }
  async _getUser(e) {
    try {
      return e ? await f(this.fetch, "GET", `${this.url}/user`, {
        headers: this.headers,
        jwt: e,
        xform: K
      }) : await this._useSession(async (t2) => {
        var r, s, n3;
        let { data: o4, error: a } = t2;
        if (a) throw a;
        return !(!((r = o4.session) === null || r === void 0) && r.access_token) && !this.hasCustomAuthorizationHeader ? {
          data: {
            user: null
          },
          error: new E()
        } : await f(this.fetch, "GET", `${this.url}/user`, {
          headers: this.headers,
          jwt: (n3 = (s = o4.session) === null || s === void 0 ? void 0 : s.access_token) !== null && n3 !== void 0 ? n3 : void 0,
          xform: K
        });
      });
    } catch (t2) {
      if (h(t2)) return ue(t2) && await this._removeSession(), this._returnResult({
        data: {
          user: null
        },
        error: t2
      });
      throw t2;
    }
  }
  async updateUser(e, t2 = {}) {
    return await this.initializePromise, this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._updateUser(e, t2)) : await this._updateUser(e, t2);
  }
  async _updateUser(e, t2 = {}) {
    let r = null;
    try {
      return await this._useSession(async (s) => {
        let { data: n3, error: o4 } = s;
        if (o4) throw o4;
        if (!n3.session) throw new E();
        let a = n3.session, l = null, u2 = null;
        this.flowType === "pkce" && e.email != null && ([l, u2, r] = await this._getCodeChallengeAndMethod());
        let { data: c3, error: _6 } = await f(this.fetch, "PUT", `${this.url}/user`, {
          headers: this.headers,
          redirectTo: this._maybeAppendFlowIdToRedirect(t2?.emailRedirectTo, r),
          body: Object.assign(Object.assign({}, e), {
            code_challenge: l,
            code_challenge_method: u2
          }),
          jwt: a.access_token,
          xform: K
        });
        if (_6) throw _6;
        return a.user = c3.user, await this._saveSession(a), await this._notifyAllSubscribers("USER_UPDATED", a), this._returnResult({
          data: {
            user: a.user
          },
          error: null
        });
      });
    } catch (s) {
      if (await $(this.storage, this.storageKey, r), h(s)) return this._returnResult({
        data: {
          user: null
        },
        error: s
      });
      throw s;
    }
  }
  async setSession(e) {
    return await this.initializePromise, this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._setSession(e)) : await this._setSession(e);
  }
  async _setSession(e) {
    try {
      if (!e.access_token || !e.refresh_token) throw new E();
      let t2 = Date.now() / 1e3, r = t2, s = true, n3 = null, { payload: o4 } = fe(e.access_token);
      if (o4.exp && (r = o4.exp, s = r <= t2), s) {
        let { data: a, error: l } = await this._callRefreshToken(e.refresh_token);
        if (l) return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: l
        });
        if (!a) return {
          data: {
            user: null,
            session: null
          },
          error: null
        };
        n3 = a;
      } else {
        let { data: a, error: l } = await this._getUser(e.access_token);
        if (l) return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: l
        });
        n3 = {
          access_token: e.access_token,
          refresh_token: e.refresh_token,
          user: a.user,
          token_type: "bearer",
          expires_in: r - t2,
          expires_at: r
        }, await this._saveSession(n3), await this._notifyAllSubscribers("SIGNED_IN", n3);
      }
      return this._returnResult({
        data: {
          user: n3.user,
          session: n3
        },
        error: null
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: {
          session: null,
          user: null
        },
        error: t2
      });
      throw t2;
    }
  }
  async refreshSession(e) {
    return await this.initializePromise, this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._refreshSession(e)) : await this._refreshSession(e);
  }
  async _refreshSession(e) {
    try {
      return await this._useSession(async (t2) => {
        var r;
        if (!e) {
          let { data: o4, error: a } = t2;
          if (a) throw a;
          e = (r = o4.session) !== null && r !== void 0 ? r : void 0;
        }
        if (!e?.refresh_token) throw new E();
        let { data: s, error: n3 } = await this._callRefreshToken(e.refresh_token);
        return n3 ? this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: n3
        }) : s ? this._returnResult({
          data: {
            user: s.user,
            session: s
          },
          error: null
        }) : this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: null
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: {
          user: null,
          session: null
        },
        error: t2
      });
      throw t2;
    }
  }
  async _getSessionFromURL(e, t2) {
    var r;
    try {
      if (!A()) throw new X("No browser detected.");
      if (e.error || e.error_description || e.error_code) throw new X(e.error_description || "Error in URL with unspecified error_description", {
        error: e.error || "unspecified_error",
        code: e.error_code || "unspecified_code"
      });
      switch (t2) {
        case "implicit":
          if (this.flowType === "pkce") throw new oe("Not a valid PKCE flow url.");
          break;
        case "pkce":
          if (this.flowType === "implicit") throw new X("Not a valid implicit grant flow url.");
          break;
        default:
      }
      if (t2 === "pkce") {
        if (this._debug("#_initialize()", "begin", "is PKCE flow", true), !e.code) throw new oe("No code detected.");
        let { data: g3, error: k5 } = await this._exchangeCodeForSession(e.code, {
          flowId: e[F2]
        });
        if (k5) throw k5;
        let j6 = new URL(globalThis.location.href);
        return j6.searchParams.delete("code"), j6.searchParams.delete(F2), globalThis.history.replaceState(globalThis.history.state, "", j6.toString()), {
          data: {
            session: g3.session,
            redirectType: (r = g3.redirectType) !== null && r !== void 0 ? r : null
          },
          error: null
        };
      }
      let { provider_token: s, provider_refresh_token: n3, access_token: o4, refresh_token: a, expires_in: l, expires_at: u2, token_type: c3 } = e;
      if (!o4 || !l || !a || !c3) throw new X("No session defined in URL");
      let _6 = Math.round(Date.now() / 1e3), w6 = parseInt(l), d = _6 + w6;
      u2 && (d = parseInt(u2));
      let v2 = d - _6;
      v2 * 1e3 <= L && console.warn(`@supabase/gotrue-js: Session as retrieved from URL expires in ${v2}s, should have been closer to ${w6}s`);
      let y5 = d - w6;
      _6 - y5 >= 120 ? console.warn("@supabase/gotrue-js: Session as retrieved from URL was issued over 120s ago, URL could be stale", y5, d, _6) : _6 - y5 < 0 && console.warn("@supabase/gotrue-js: Session as retrieved from URL was issued in the future? Check the device clock for skew", y5, d, _6);
      let { data: b3, error: m4 } = await this._getUser(o4);
      if (m4) throw m4;
      let p4 = {
        provider_token: s,
        provider_refresh_token: n3,
        access_token: o4,
        expires_in: w6,
        expires_at: d,
        refresh_token: a,
        token_type: c3,
        user: b3.user
      };
      return globalThis.location.hash = "", this._debug("#_getSessionFromURL()", "clearing window.location.hash"), this._returnResult({
        data: {
          session: p4,
          redirectType: e.type
        },
        error: null
      });
    } catch (s) {
      if (h(s)) return this._returnResult({
        data: {
          session: null,
          redirectType: null
        },
        error: s
      });
      throw s;
    }
  }
  _isImplicitGrantCallback(e) {
    return typeof this.detectSessionInUrl == "function" ? this.detectSessionInUrl(new URL(globalThis.location.href), e) : !!(e.access_token || e.error || e.error_description || e.error_code);
  }
  async _isPKCECallback(e) {
    if (!e.code) return false;
    let t2 = _e(e[F2]);
    return t2 && await I(this.storage, ee(this.storageKey, t2)) ? true : !!await I(this.storage, `${this.storageKey}-code-verifier`);
  }
  async signOut(e = {
    scope: "global"
  }) {
    return await this.initializePromise, this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => await this._signOut(e)) : await this._signOut(e);
  }
  async _signOut({ scope: e } = {
    scope: "global"
  }) {
    return await this._useSession(async (t2) => {
      var r;
      let s = async () => {
        await this._removeSession();
      }, { data: n3, error: o4 } = t2;
      if (o4 && !ue(o4)) return this._returnResult({
        error: o4
      });
      let a = (r = n3.session) === null || r === void 0 ? void 0 : r.access_token;
      if (a) {
        let { error: l } = await this.admin.signOut(a, e);
        if (l && !(Ce(l) && (l.status === 404 || l.status === 401 || l.status === 403) || ue(l))) return e !== "others" && await s(), this._returnResult({
          error: l
        });
      }
      return e !== "others" && await s(), this._returnResult({
        error: null
      });
    });
  }
  onAuthStateChange(e) {
    let t2 = ct(), r = {
      id: t2,
      callback: e,
      unsubscribe: () => {
        this._debug("#unsubscribe()", "state change callback with id removed", t2), this.stateChangeEmitters.delete(t2);
      }
    };
    return this._debug("#onAuthStateChange()", "registered callback with id", t2), this.stateChangeEmitters.set(t2, r), (async () => (await this.initializePromise, this.lock != null ? await this._acquireLock(this.lockAcquireTimeout, async () => {
      this._emitInitialSession(t2);
    }) : await this._emitInitialSession(t2)))(), {
      data: {
        subscription: r
      }
    };
  }
  async _emitInitialSession(e) {
    return await this._useSession(async (t2) => {
      var r, s;
      try {
        let { data: { session: n3 }, error: o4 } = t2;
        if (o4) throw o4;
        await ((r = this.stateChangeEmitters.get(e)) === null || r === void 0 ? void 0 : r.callback("INITIAL_SESSION", n3)), this._debug("INITIAL_SESSION", "callback id", e, "session", n3);
      } catch (n3) {
        await ((s = this.stateChangeEmitters.get(e)) === null || s === void 0 ? void 0 : s.callback("INITIAL_SESSION", null)), this._debug("INITIAL_SESSION", "callback id", e, "error", n3), ue(n3) || ce(n3) || Ce(n3) && (n3.code === "refresh_token_not_found" || n3.code === "refresh_token_already_used" || n3.code === "session_expired") ? console.warn(n3) : console.error(n3);
      }
    });
  }
  async resetPasswordForEmail(e, t2 = {}) {
    let r = null, s = null, n3 = null;
    this.flowType === "pkce" && ([r, s, n3] = await this._getCodeChallengeAndMethod(true));
    try {
      return await f(this.fetch, "POST", `${this.url}/recover`, {
        body: {
          email: e,
          code_challenge: r,
          code_challenge_method: s,
          gotrue_meta_security: {
            captcha_token: t2.captchaToken
          }
        },
        headers: this.headers,
        redirectTo: this._maybeAppendFlowIdToRedirect(t2.redirectTo, n3)
      });
    } catch (o4) {
      if (await $(this.storage, this.storageKey, n3), h(o4)) return this._returnResult({
        data: null,
        error: o4
      });
      throw o4;
    }
  }
  async getUserIdentities() {
    var e;
    try {
      let { data: t2, error: r } = await this.getUser();
      if (r) throw r;
      return this._returnResult({
        data: {
          identities: (e = t2.user.identities) !== null && e !== void 0 ? e : []
        },
        error: null
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async linkIdentity(e) {
    return "token" in e ? this.linkIdentityIdToken(e) : this.linkIdentityOAuth(e);
  }
  async linkIdentityOAuth(e) {
    var t2;
    let r = null;
    try {
      let { data: s, error: n3 } = await this._useSession(async (o4) => {
        var a, l, u2, c3, _6;
        let { data: w6, error: d } = o4;
        if (d) throw d;
        let { url: v2, flowId: y5 } = await this._getUrlForProvider(`${this.url}/user/identities/authorize`, e.provider, {
          redirectTo: (a = e.options) === null || a === void 0 ? void 0 : a.redirectTo,
          scopes: (l = e.options) === null || l === void 0 ? void 0 : l.scopes,
          queryParams: (u2 = e.options) === null || u2 === void 0 ? void 0 : u2.queryParams,
          skipBrowserRedirect: true
        });
        return r = y5, await f(this.fetch, "GET", v2, {
          headers: this.headers,
          jwt: (_6 = (c3 = w6.session) === null || c3 === void 0 ? void 0 : c3.access_token) !== null && _6 !== void 0 ? _6 : void 0
        });
      });
      if (n3) throw n3;
      return A() && !(!((t2 = e.options) === null || t2 === void 0) && t2.skipBrowserRedirect) && globalThis.location.assign(s?.url), this._returnResult({
        data: {
          provider: e.provider,
          url: s?.url,
          flowId: r
        },
        error: null
      });
    } catch (s) {
      if (h(s)) return this._returnResult({
        data: {
          provider: e.provider,
          url: null,
          flowId: r
        },
        error: s
      });
      throw s;
    }
  }
  async linkIdentityIdToken(e) {
    return await this._useSession(async (t2) => {
      var r;
      try {
        let { error: s, data: { session: n3 } } = t2;
        if (s) throw s;
        let { options: o4, provider: a, token: l, access_token: u2, nonce: c3 } = e, _6 = await f(this.fetch, "POST", `${this.url}/token?grant_type=id_token`, {
          headers: this.headers,
          jwt: (r = n3?.access_token) !== null && r !== void 0 ? r : void 0,
          body: {
            provider: a,
            id_token: l,
            access_token: u2,
            nonce: c3,
            link_identity: true,
            gotrue_meta_security: {
              captcha_token: o4?.captchaToken
            }
          },
          xform: P
        }), { data: w6, error: d } = _6;
        return d ? this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: d
        }) : !w6 || !w6.session || !w6.user ? this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: new W()
        }) : (w6.session && (await this._saveSession(w6.session), await this._notifyAllSubscribers("USER_UPDATED", w6.session)), this._returnResult({
          data: w6,
          error: d
        }));
      } catch (s) {
        if (await $(this.storage, this.storageKey, null), h(s)) return this._returnResult({
          data: {
            user: null,
            session: null
          },
          error: s
        });
        throw s;
      }
    });
  }
  async unlinkIdentity(e) {
    try {
      return await this._useSession(async (t2) => {
        var r, s;
        let { data: n3, error: o4 } = t2;
        if (o4) throw o4;
        return await f(this.fetch, "DELETE", `${this.url}/user/identities/${e.identity_id}`, {
          headers: this.headers,
          jwt: (s = (r = n3.session) === null || r === void 0 ? void 0 : r.access_token) !== null && s !== void 0 ? s : void 0
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async _refreshAccessToken(e) {
    let t2 = "#_refreshAccessToken()";
    this._debug(t2, "begin");
    try {
      let r = Date.now();
      return await ft(async (s) => (s > 0 && await dt(200 * Math.pow(2, s - 1)), this._debug(t2, "refreshing attempt", s), await f(this.fetch, "POST", `${this.url}/token?grant_type=refresh_token`, {
        body: {
          refresh_token: e
        },
        headers: this.headers,
        xform: P
      })), (s, n3) => {
        let o4 = 200 * Math.pow(2, s);
        return n3 && ce(n3) && Date.now() + o4 - r < L;
      });
    } catch (r) {
      if (this._debug(t2, "error", r), h(r)) return this._returnResult({
        data: {
          session: null,
          user: null
        },
        error: r
      });
      throw r;
    } finally {
      this._debug(t2, "end");
    }
  }
  _isValidSession(e) {
    return typeof e == "object" && e !== null && "access_token" in e && "refresh_token" in e && "expires_at" in e;
  }
  async _handleProviderSignIn(e, t2) {
    let { url: r, flowId: s } = await this._getUrlForProvider(`${this.url}/authorize`, e, {
      redirectTo: t2.redirectTo,
      scopes: t2.scopes,
      queryParams: t2.queryParams
    });
    return this._debug("#_handleProviderSignIn()", "provider", e, "options", t2, "url", r), A() && !t2.skipBrowserRedirect && globalThis.location.assign(r), {
      data: {
        provider: e,
        url: r,
        flowId: s
      },
      error: null
    };
  }
  async _recoverAndRefresh() {
    var e, t2;
    let r = "#_recoverAndRefresh()";
    this._debug(r, "begin");
    try {
      let s = await I(this.storage, this.storageKey);
      if (s && this.userStorage) {
        let o4 = await I(this.userStorage, this.storageKey + "-user");
        !this.storage.isServer && Object.is(this.storage, this.userStorage) && !o4 && (o4 = {
          user: s.user
        }, await D(this.userStorage, this.storageKey + "-user", o4)), s.user = (e = o4?.user) !== null && e !== void 0 ? e : Se();
      } else if (s && !s.user && !s.user) {
        let o4 = await I(this.storage, this.storageKey + "-user");
        o4 && o4?.user ? (s.user = o4.user, await O(this.storage, this.storageKey + "-user"), await D(this.storage, this.storageKey, s)) : s.user = Se();
      }
      if (this._debug(r, "session from storage", s), !this._isValidSession(s)) {
        this._debug(r, "session is not valid"), s !== null && await this._removeSession();
        return;
      }
      let n3 = ((t2 = s.expires_at) !== null && t2 !== void 0 ? t2 : 1 / 0) * 1e3 - Date.now() < ye;
      if (this._debug(r, `session has${n3 ? "" : " not"} expired with margin of ${ye}s`), n3) {
        if (this.autoRefreshToken && s.refresh_token) {
          let { error: o4 } = await this._callRefreshToken(s.refresh_token);
          o4 && (it(o4) ? this._debug(r, "refresh discarded by commit guard", o4) : this._debug(r, "refresh failed", o4));
        }
      } else if (s.user && s.user.__isUserNotAvailableProxy === true) try {
        let { data: o4, error: a } = await this._getUser(s.access_token);
        !a && o4?.user ? (s.user = o4.user, await this._saveSession(s), await this._notifyAllSubscribers("SIGNED_IN", s)) : this._debug(r, "could not get user data, skipping SIGNED_IN notification");
      } catch (o4) {
        console.error("Error getting user data:", o4), this._debug(r, "error getting user data, skipping SIGNED_IN notification", o4);
      }
      else await this._notifyAllSubscribers("SIGNED_IN", s);
    } catch (s) {
      this._debug(r, "error", s), ce(s) ? console.warn(s) : console.error(s);
      return;
    } finally {
      this._debug(r, "end");
    }
  }
  async _callRefreshToken(e) {
    var t2, r;
    if (!e) throw new E();
    if (this.refreshingDeferred) return this.refreshingDeferred.promise;
    if (this.lastRefreshFailure && this.lastRefreshFailure.refreshToken === e && Date.now() < this.lastRefreshFailure.expiresAt) return this._debug("#_callRefreshToken()", "returning cached failure (cooldown active)"), this.lastRefreshFailure.result;
    let s = "#_callRefreshToken()";
    this._debug(s, "begin");
    try {
      this.refreshingDeferred = new he();
      let n3 = await I(this.storage, this.storageKey), { data: o4, error: a } = await this._refreshAccessToken(e);
      if (a) throw a;
      if (!o4.session) throw new E();
      let l = await I(this.storage, this.storageKey);
      if (n3 !== null && (l === null || l.refresh_token !== n3.refresh_token)) {
        this._debug(s, "commit guard: storage changed since refresh started, discarding rotated tokens", {
          startedWith: "present",
          nowHolds: l ? "replaced" : "cleared"
        });
        let w6 = {
          data: null,
          error: new ae()
        };
        return this.refreshingDeferred.resolve(w6), w6;
      }
      let c3 = this._sessionRemovalEpoch;
      if (await this._saveSession(o4.session), this._sessionRemovalEpoch !== c3) {
        this._debug(s, "commit guard (post-save): _removeSession ran during _saveSession, undoing write"), await O(this.storage, this.storageKey), this.userStorage && await O(this.userStorage, this.storageKey + "-user");
        let w6 = {
          data: null,
          error: new ae()
        };
        return this.refreshingDeferred.resolve(w6), w6;
      }
      await this._notifyAllSubscribers("TOKEN_REFRESHED", o4.session);
      let _6 = {
        data: o4.session,
        error: null
      };
      return this.lastRefreshFailure = null, this.refreshingDeferred.resolve(_6), _6;
    } catch (n3) {
      if (this._debug(s, "error", n3), h(n3)) {
        let o4 = {
          data: null,
          error: n3
        };
        if (!ce(n3)) {
          let a = await I(this.storage, this.storageKey);
          !!(a?.expires_at && a.expires_at * 1e3 > Date.now()) ? this._debug(s, "proactive refresh failed, access token still valid \u2014 preserving session") : await this._removeSession();
        }
        return this.lastRefreshFailure = {
          refreshToken: e,
          result: o4,
          expiresAt: Date.now() + Ye
        }, (t2 = this.refreshingDeferred) === null || t2 === void 0 || t2.resolve(o4), o4;
      }
      throw (r = this.refreshingDeferred) === null || r === void 0 || r.reject(n3), n3;
    } finally {
      this.refreshingDeferred = null, this._debug(s, "end");
    }
  }
  async _notifyAllSubscribers(e, t2, r = true) {
    if (this._pendingInitNotifications !== null && r) {
      this._pendingInitNotifications.push({
        event: e,
        session: t2,
        broadcast: r
      });
      return;
    }
    let s = `#_notifyAllSubscribers(${e})`;
    this._debug(s, "begin", t2, `broadcast = ${r}`);
    try {
      this.broadcastChannel && r && this.broadcastChannel.postMessage({
        event: e,
        session: t2
      });
      let n3 = [], o4 = Array.from(this.stateChangeEmitters.values()).map(async (a) => {
        try {
          await a.callback(e, t2);
        } catch (l) {
          n3.push(l);
        }
      });
      if (await Promise.all(o4), n3.length > 0) {
        for (let a = 0; a < n3.length; a += 1) console.error(n3[a]);
        throw n3[0];
      }
    } finally {
      this._debug(s, "end");
    }
  }
  async _saveSession(e) {
    this._debug("#_saveSession()", e), this.suppressGetSessionWarning = true;
    let t2 = Object.assign({}, e), r = t2.user && t2.user.__isUserNotAvailableProxy === true;
    if (this.userStorage) {
      !r && t2.user && await D(this.userStorage, this.storageKey + "-user", {
        user: t2.user
      });
      let s = Object.assign({}, t2);
      delete s.user;
      let n3 = $e(s);
      await D(this.storage, this.storageKey, n3);
    } else {
      let s = $e(t2);
      await D(this.storage, this.storageKey, s);
    }
  }
  async _removeSession() {
    this._sessionRemovalEpoch += 1, this._debug("#_removeSession()"), this.lastRefreshFailure = null, this.suppressGetSessionWarning = false, await O(this.storage, this.storageKey), await gt(this.storage, this.storageKey), await O(this.storage, this.storageKey + "-user"), this.userStorage && await O(this.userStorage, this.storageKey + "-user"), await this._notifyAllSubscribers("SIGNED_OUT", null);
  }
  _removeVisibilityChangedCallback() {
    this._debug("#_removeVisibilityChangedCallback()");
    let e = this.visibilityChangedCallback;
    this.visibilityChangedCallback = null;
    try {
      e && A() && globalThis?.removeEventListener && globalThis.removeEventListener("visibilitychange", e);
    } catch (t2) {
      console.error("removing visibilitychange callback failed", t2);
    }
  }
  async _startAutoRefresh() {
    await this._stopAutoRefresh(), this._debug("#_startAutoRefresh()");
    let e = setInterval(() => this._autoRefreshTokenTick(), L);
    this.autoRefreshTicker = e, e && typeof e == "object" && typeof e.unref == "function" ? e.unref() : typeof Deno < "u" && typeof Deno.unrefTimer == "function" && Deno.unrefTimer(e);
    let t2 = setTimeout(async () => {
      await this.initializePromise, await this._autoRefreshTokenTick();
    }, 0);
    this.autoRefreshTickTimeout = t2, t2 && typeof t2 == "object" && typeof t2.unref == "function" ? t2.unref() : typeof Deno < "u" && typeof Deno.unrefTimer == "function" && Deno.unrefTimer(t2);
  }
  async _stopAutoRefresh() {
    this._debug("#_stopAutoRefresh()");
    let e = this.autoRefreshTicker;
    this.autoRefreshTicker = null, e && clearInterval(e);
    let t2 = this.autoRefreshTickTimeout;
    this.autoRefreshTickTimeout = null, t2 && clearTimeout(t2);
  }
  async startAutoRefresh() {
    this._removeVisibilityChangedCallback(), await this._startAutoRefresh();
  }
  async stopAutoRefresh() {
    this._removeVisibilityChangedCallback(), await this._stopAutoRefresh();
  }
  async dispose() {
    var e;
    this._removeVisibilityChangedCallback(), await this._stopAutoRefresh(), (e = this.broadcastChannel) === null || e === void 0 || e.close(), this.broadcastChannel = null, this.stateChangeEmitters.clear();
  }
  async _autoRefreshTokenTick() {
    if (this._debug("#_autoRefreshTokenTick()", "begin"), this.lock != null) {
      try {
        await this._acquireLock(0, async () => {
          try {
            let e = Date.now();
            try {
              return await this._useSession(async (t2) => {
                let { data: { session: r } } = t2;
                if (!r || !r.refresh_token || !r.expires_at) {
                  this._debug("#_autoRefreshTokenTick()", "no session");
                  return;
                }
                let s = Math.floor((r.expires_at * 1e3 - e) / L);
                this._debug("#_autoRefreshTokenTick()", `access token expires in ${s} ticks, a tick lasts ${L}ms, refresh threshold is ${se} ticks`), s <= se && await this._callRefreshToken(r.refresh_token);
              });
            } catch (t2) {
              console.error("Auto refresh tick failed with error. This is likely a transient error.", t2);
            }
          } finally {
            this._debug("#_autoRefreshTokenTick()", "end");
          }
        });
      } catch (e) {
        if (e instanceof H) this._debug("auto refresh token tick lock not available");
        else throw e;
      }
      return;
    }
    if (this.refreshingDeferred !== null) {
      this._debug("#_autoRefreshTokenTick()", "refresh already in flight, skipping");
      return;
    }
    try {
      let e = Date.now();
      try {
        await this._useSession(async (t2) => {
          let { data: { session: r } } = t2;
          if (!r || !r.refresh_token || !r.expires_at) {
            this._debug("#_autoRefreshTokenTick()", "no session");
            return;
          }
          let s = Math.floor((r.expires_at * 1e3 - e) / L);
          this._debug("#_autoRefreshTokenTick()", `access token expires in ${s} ticks, a tick lasts ${L}ms, refresh threshold is ${se} ticks`), s <= se && await this._callRefreshToken(r.refresh_token);
        });
      } catch (t2) {
        console.error("Auto refresh tick failed with error. This is likely a transient error.", t2);
      }
    } finally {
      this._debug("#_autoRefreshTokenTick()", "end");
    }
  }
  async _handleVisibilityChange() {
    if (this._debug("#_handleVisibilityChange()"), !A() || !globalThis?.addEventListener) return this.autoRefreshToken && this.startAutoRefresh(), false;
    try {
      this.visibilityChangedCallback = async () => {
        try {
          await this._onVisibilityChanged(false);
        } catch (e) {
          this._debug("#visibilityChangedCallback", "error", e);
        }
      }, globalThis?.addEventListener("visibilitychange", this.visibilityChangedCallback), await this._onVisibilityChanged(true);
    } catch (e) {
      console.error("_handleVisibilityChange", e);
    }
  }
  async _onVisibilityChanged(e) {
    let t2 = `#_onVisibilityChanged(${e})`;
    if (this._debug(t2, "visibilityState", document.visibilityState), document.visibilityState === "visible") {
      if (this.autoRefreshToken && this._startAutoRefresh(), !e) if (await this.initializePromise, this.lock != null) await this._acquireLock(this.lockAcquireTimeout, async () => {
        if (document.visibilityState !== "visible") {
          this._debug(t2, "acquired the lock to recover the session, but the browser visibilityState is no longer visible, aborting");
          return;
        }
        await this._recoverAndRefresh();
      });
      else {
        if (document.visibilityState !== "visible") {
          this._debug(t2, "visibilityState is no longer visible, skipping recovery");
          return;
        }
        await this._recoverAndRefresh();
      }
    } else document.visibilityState === "hidden" && this.autoRefreshToken && this._stopAutoRefresh();
  }
  async _getUrlForProvider(e, t2, r) {
    let s = r?.redirectTo, n3 = null, o4 = null, a = null;
    this.flowType === "pkce" && ([n3, o4, a] = await this._getCodeChallengeAndMethod(), s = this._maybeAppendFlowIdToRedirect(s, a));
    let l = [
      `provider=${encodeURIComponent(t2)}`
    ];
    if (s && l.push(`redirect_to=${encodeURIComponent(s)}`), r?.scopes && l.push(`scopes=${encodeURIComponent(r.scopes)}`), n3 != null && o4 != null) {
      let u2 = new URLSearchParams({
        code_challenge: `${encodeURIComponent(n3)}`,
        code_challenge_method: `${encodeURIComponent(o4)}`
      });
      l.push(u2.toString());
    }
    if (r?.queryParams) {
      let u2 = new URLSearchParams(r.queryParams);
      l.push(u2.toString());
    }
    return r?.skipBrowserRedirect && l.push(`skip_http_redirect=${r.skipBrowserRedirect}`), {
      url: `${e}?${l.join("&")}`,
      flowId: a
    };
  }
  _maybeAppendFlowIdToRedirect(e, t2) {
    return !e || !t2 || !this.experimental.appendPkceFlowIdToRedirects ? e ?? void 0 : pt(e, t2);
  }
  async _getCodeChallengeAndMethod(e = false) {
    return yt(this.storage, this.storageKey, e, (t2) => this._debug("#_getCodeChallengeAndMethod()", "evicted oldest pending PKCE verifier slot", t2));
  }
  async _unenroll(e) {
    try {
      return await this._useSession(async (t2) => {
        var r;
        let { data: s, error: n3 } = t2;
        return n3 ? this._returnResult({
          data: null,
          error: n3
        }) : await f(this.fetch, "DELETE", `${this.url}/factors/${e.factorId}`, {
          headers: this.headers,
          jwt: (r = s?.session) === null || r === void 0 ? void 0 : r.access_token
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async _enroll(e) {
    try {
      return await this._useSession(async (t2) => {
        var r, s;
        let { data: n3, error: o4 } = t2;
        if (o4) return this._returnResult({
          data: null,
          error: o4
        });
        let a = Object.assign({
          friendly_name: e.friendlyName,
          factor_type: e.factorType
        }, e.factorType === "phone" ? {
          phone: e.phone
        } : e.factorType === "totp" ? {
          issuer: e.issuer
        } : {}), { data: l, error: u2 } = await f(this.fetch, "POST", `${this.url}/factors`, {
          body: a,
          headers: this.headers,
          jwt: (r = n3?.session) === null || r === void 0 ? void 0 : r.access_token
        });
        return u2 ? this._returnResult({
          data: null,
          error: u2
        }) : (e.factorType === "totp" && l.type === "totp" && (!((s = l?.totp) === null || s === void 0) && s.qr_code) && (l.totp.qr_code = `data:image/svg+xml;utf-8,${l.totp.qr_code}`), this._returnResult({
          data: l,
          error: null
        }));
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async _verify(e) {
    let t2 = async () => {
      try {
        return await this._useSession(async (r) => {
          var s;
          let { data: n3, error: o4 } = r;
          if (o4) return this._returnResult({
            data: null,
            error: o4
          });
          let a = Object.assign({
            challenge_id: e.challengeId
          }, "webauthn" in e ? {
            webauthn: Object.assign(Object.assign({}, e.webauthn), {
              credential_response: e.webauthn.type === "create" ? Be(e.webauthn.credential_response) : Ve(e.webauthn.credential_response)
            })
          } : {
            code: e.code
          }), { data: l, error: u2 } = await f(this.fetch, "POST", `${this.url}/factors/${e.factorId}/verify`, {
            body: a,
            headers: this.headers,
            jwt: (s = n3?.session) === null || s === void 0 ? void 0 : s.access_token
          });
          return u2 ? this._returnResult({
            data: null,
            error: u2
          }) : (await this._saveSession(Object.assign({
            expires_at: Math.round(Date.now() / 1e3) + l.expires_in
          }, l)), await this._notifyAllSubscribers("MFA_CHALLENGE_VERIFIED", l), this._returnResult({
            data: l,
            error: u2
          }));
        });
      } catch (r) {
        if (h(r)) return this._returnResult({
          data: null,
          error: r
        });
        throw r;
      }
    };
    return this.lock != null ? this._acquireLock(this.lockAcquireTimeout, t2) : t2();
  }
  async _challenge(e) {
    let t2 = async () => {
      try {
        return await this._useSession(async (r) => {
          var s;
          let { data: n3, error: o4 } = r;
          if (o4) return this._returnResult({
            data: null,
            error: o4
          });
          let a = await f(this.fetch, "POST", `${this.url}/factors/${e.factorId}/challenge`, {
            body: e,
            headers: this.headers,
            jwt: (s = n3?.session) === null || s === void 0 ? void 0 : s.access_token
          });
          if (a.error) return a;
          let { data: l } = a;
          if (l.type !== "webauthn") return {
            data: l,
            error: null
          };
          switch (l.webauthn.type) {
            case "create":
              return {
                data: Object.assign(Object.assign({}, l), {
                  webauthn: Object.assign(Object.assign({}, l.webauthn), {
                    credential_options: Object.assign(Object.assign({}, l.webauthn.credential_options), {
                      publicKey: We(l.webauthn.credential_options.publicKey)
                    })
                  })
                }),
                error: null
              };
            case "request":
              return {
                data: Object.assign(Object.assign({}, l), {
                  webauthn: Object.assign(Object.assign({}, l.webauthn), {
                    credential_options: Object.assign(Object.assign({}, l.webauthn.credential_options), {
                      publicKey: Ge(l.webauthn.credential_options.publicKey)
                    })
                  })
                }),
                error: null
              };
          }
        });
      } catch (r) {
        if (h(r)) return this._returnResult({
          data: null,
          error: r
        });
        throw r;
      }
    };
    return this.lock != null ? this._acquireLock(this.lockAcquireTimeout, t2) : t2();
  }
  async _challengeAndVerify(e) {
    let { data: t2, error: r } = await this._challenge({
      factorId: e.factorId
    });
    return r ? this._returnResult({
      data: null,
      error: r
    }) : await this._verify({
      factorId: e.factorId,
      challengeId: t2.id,
      code: e.code
    });
  }
  async _listFactors() {
    var e;
    let { data: { user: t2 }, error: r } = await this.getUser();
    if (r) return {
      data: null,
      error: r
    };
    let s = {
      all: [],
      phone: [],
      totp: [],
      webauthn: []
    };
    for (let n3 of (e = t2?.factors) !== null && e !== void 0 ? e : []) s.all.push(n3), n3.status === "verified" && s[n3.factor_type].push(n3);
    return {
      data: s,
      error: null
    };
  }
  async _getAuthenticatorAssuranceLevel(e) {
    var t2, r, s, n3;
    if (e) try {
      let { payload: d } = fe(e), v2 = null;
      d.aal && (v2 = d.aal);
      let y5 = v2, { data: { user: b3 }, error: m4 } = await this.getUser(e);
      if (m4) return this._returnResult({
        data: null,
        error: m4
      });
      ((r = (t2 = b3?.factors) === null || t2 === void 0 ? void 0 : t2.filter((k5) => k5.status === "verified")) !== null && r !== void 0 ? r : []).length > 0 && (y5 = "aal2");
      let g3 = d.amr || [];
      return {
        data: {
          currentLevel: v2,
          nextLevel: y5,
          currentAuthenticationMethods: g3
        },
        error: null
      };
    } catch (d) {
      if (h(d)) return this._returnResult({
        data: null,
        error: d
      });
      throw d;
    }
    let { data: { session: o4 }, error: a } = await this.getSession();
    if (a) return this._returnResult({
      data: null,
      error: a
    });
    if (!o4) return {
      data: {
        currentLevel: null,
        nextLevel: null,
        currentAuthenticationMethods: []
      },
      error: null
    };
    let { payload: l } = fe(o4.access_token), u2 = null;
    l.aal && (u2 = l.aal);
    let c3 = u2;
    ((n3 = (s = o4.user.factors) === null || s === void 0 ? void 0 : s.filter((d) => d.status === "verified")) !== null && n3 !== void 0 ? n3 : []).length > 0 && (c3 = "aal2");
    let w6 = l.amr || [];
    return {
      data: {
        currentLevel: u2,
        nextLevel: c3,
        currentAuthenticationMethods: w6
      },
      error: null
    };
  }
  async _getAuthorizationDetails(e) {
    try {
      return await this._useSession(async (t2) => {
        let { data: { session: r }, error: s } = t2;
        return s ? this._returnResult({
          data: null,
          error: s
        }) : r ? await f(this.fetch, "GET", `${this.url}/oauth/authorizations/${e}`, {
          headers: this.headers,
          jwt: r.access_token,
          xform: (n3) => ({
            data: n3,
            error: null
          })
        }) : this._returnResult({
          data: null,
          error: new E()
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async _approveAuthorization(e, t2) {
    try {
      return await this._useSession(async (r) => {
        let { data: { session: s }, error: n3 } = r;
        if (n3) return this._returnResult({
          data: null,
          error: n3
        });
        if (!s) return this._returnResult({
          data: null,
          error: new E()
        });
        let o4 = await f(this.fetch, "POST", `${this.url}/oauth/authorizations/${e}/consent`, {
          headers: this.headers,
          jwt: s.access_token,
          body: {
            action: "approve"
          },
          xform: (a) => ({
            data: a,
            error: null
          })
        });
        return o4.data && o4.data.redirect_url && A() && !t2?.skipBrowserRedirect && globalThis.location.assign(o4.data.redirect_url), o4;
      });
    } catch (r) {
      if (h(r)) return this._returnResult({
        data: null,
        error: r
      });
      throw r;
    }
  }
  async _denyAuthorization(e, t2) {
    try {
      return await this._useSession(async (r) => {
        let { data: { session: s }, error: n3 } = r;
        if (n3) return this._returnResult({
          data: null,
          error: n3
        });
        if (!s) return this._returnResult({
          data: null,
          error: new E()
        });
        let o4 = await f(this.fetch, "POST", `${this.url}/oauth/authorizations/${e}/consent`, {
          headers: this.headers,
          jwt: s.access_token,
          body: {
            action: "deny"
          },
          xform: (a) => ({
            data: a,
            error: null
          })
        });
        return o4.data && o4.data.redirect_url && A() && !t2?.skipBrowserRedirect && globalThis.location.assign(o4.data.redirect_url), o4;
      });
    } catch (r) {
      if (h(r)) return this._returnResult({
        data: null,
        error: r
      });
      throw r;
    }
  }
  async _listOAuthGrants() {
    try {
      return await this._useSession(async (e) => {
        let { data: { session: t2 }, error: r } = e;
        return r ? this._returnResult({
          data: null,
          error: r
        }) : t2 ? await f(this.fetch, "GET", `${this.url}/user/oauth/grants`, {
          headers: this.headers,
          jwt: t2.access_token,
          xform: (s) => ({
            data: s,
            error: null
          })
        }) : this._returnResult({
          data: null,
          error: new E()
        });
      });
    } catch (e) {
      if (h(e)) return this._returnResult({
        data: null,
        error: e
      });
      throw e;
    }
  }
  async _revokeOAuthGrant(e) {
    try {
      return await this._useSession(async (t2) => {
        let { data: { session: r }, error: s } = t2;
        return s ? this._returnResult({
          data: null,
          error: s
        }) : r ? (await f(this.fetch, "DELETE", `${this.url}/user/oauth/grants`, {
          headers: this.headers,
          jwt: r.access_token,
          query: {
            client_id: e.clientId
          },
          noResolveJson: true
        }), {
          data: {},
          error: null
        }) : this._returnResult({
          data: null,
          error: new E()
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async fetchJwk(e, t2 = {
    keys: []
  }) {
    let r = t2.keys.find((a) => a.kid === e);
    if (r) return r;
    let s = Date.now();
    if (r = this.jwks.keys.find((a) => a.kid === e), r && this.jwks_cached_at + rt > s) return r;
    let { data: n3, error: o4 } = await f(this.fetch, "GET", `${this.url}/.well-known/jwks.json`, {
      headers: this.headers
    });
    if (o4) throw o4;
    return !n3.keys || n3.keys.length === 0 || (this.jwks = n3, this.jwks_cached_at = s, r = n3.keys.find((a) => a.kid === e), !r) ? null : r;
  }
  async getClaims(e, t2 = {}) {
    try {
      let r = e;
      if (!r) {
        let { data: d, error: v2 } = await this.getSession();
        if (v2 || !d.session) return this._returnResult({
          data: null,
          error: v2
        });
        r = d.session.access_token;
      }
      let { header: s, payload: n3, signature: o4, raw: { header: a, payload: l } } = fe(r);
      if (!t2?.allowExpired) try {
        bt(n3.exp);
      } catch (d) {
        throw new V(d instanceof Error ? d.message : "JWT validation failed");
      }
      let u2 = !s.alg || s.alg.startsWith("HS") || !s.kid || !("crypto" in globalThis && "subtle" in globalThis.crypto) ? null : await this.fetchJwk(s.kid, t2?.keys ? {
        keys: t2.keys
      } : t2?.jwks);
      if (!u2) {
        let { error: d } = await this.getUser(r);
        if (d) throw d;
        return {
          data: {
            claims: n3,
            header: s,
            signature: o4
          },
          error: null
        };
      }
      let c3 = mt(s.alg), _6 = await crypto.subtle.importKey("jwk", u2, c3, true, [
        "verify"
      ]);
      if (!await crypto.subtle.verify(c3, _6, o4, lt(`${a}.${l}`))) throw new V("Invalid JWT signature");
      return {
        data: {
          claims: n3,
          header: s,
          signature: o4
        },
        error: null
      };
    } catch (r) {
      if (h(r)) return this._returnResult({
        data: null,
        error: r
      });
      throw r;
    }
  }
  async signInWithPasskey(e) {
    var t2, r, s;
    C(this.experimental);
    try {
      if (!ge()) return this._returnResult({
        data: null,
        error: new x("Browser does not support WebAuthn", null)
      });
      let { data: n3, error: o4 } = await this._startPasskeyAuthentication({
        options: {
          captchaToken: (t2 = e?.options) === null || t2 === void 0 ? void 0 : t2.captchaToken
        }
      });
      if (o4 || !n3) return this._returnResult({
        data: null,
        error: o4
      });
      let a = Ge(n3.options), l = (s = (r = e?.options) === null || r === void 0 ? void 0 : r.signal) !== null && s !== void 0 ? s : Ie.createNewAbortSignal(), { data: u2, error: c3 } = await Je({
        publicKey: a,
        signal: l
      });
      if (c3 || !u2) return this._returnResult({
        data: null,
        error: c3 ?? new x("WebAuthn ceremony failed", null)
      });
      let _6 = Ve(u2);
      return this._verifyPasskeyAuthentication({
        challengeId: n3.challenge_id,
        credential: _6
      });
    } catch (n3) {
      if (h(n3)) return this._returnResult({
        data: null,
        error: n3
      });
      throw n3;
    }
  }
  async registerPasskey(e) {
    var t2, r;
    C(this.experimental);
    try {
      if (!ge()) return this._returnResult({
        data: null,
        error: new x("Browser does not support WebAuthn", null)
      });
      let { data: s, error: n3 } = await this._startPasskeyRegistration();
      if (n3 || !s) return this._returnResult({
        data: null,
        error: n3
      });
      let o4 = We(s.options), a = (r = (t2 = e?.options) === null || t2 === void 0 ? void 0 : t2.signal) !== null && r !== void 0 ? r : Ie.createNewAbortSignal(), { data: l, error: u2 } = await ze({
        publicKey: o4,
        signal: a
      });
      if (u2 || !l) return this._returnResult({
        data: null,
        error: u2 ?? new x("WebAuthn ceremony failed", null)
      });
      let c3 = Be(l);
      return this._verifyPasskeyRegistration({
        challengeId: s.challenge_id,
        credential: c3
      });
    } catch (s) {
      if (h(s)) return this._returnResult({
        data: null,
        error: s
      });
      throw s;
    }
  }
  async _startPasskeyRegistration() {
    C(this.experimental);
    try {
      return await this._useSession(async (e) => {
        let { data: { session: t2 }, error: r } = e;
        if (r) return this._returnResult({
          data: null,
          error: r
        });
        if (!t2) return this._returnResult({
          data: null,
          error: new E()
        });
        let { data: s, error: n3 } = await f(this.fetch, "POST", `${this.url}/passkeys/registration/options`, {
          headers: this.headers,
          jwt: t2.access_token,
          body: {}
        });
        return n3 ? this._returnResult({
          data: null,
          error: n3
        }) : this._returnResult({
          data: s,
          error: null
        });
      });
    } catch (e) {
      if (h(e)) return this._returnResult({
        data: null,
        error: e
      });
      throw e;
    }
  }
  async _verifyPasskeyRegistration(e) {
    C(this.experimental);
    try {
      return await this._useSession(async (t2) => {
        let { data: { session: r }, error: s } = t2;
        if (s) return this._returnResult({
          data: null,
          error: s
        });
        if (!r) return this._returnResult({
          data: null,
          error: new E()
        });
        let { data: n3, error: o4 } = await f(this.fetch, "POST", `${this.url}/passkeys/registration/verify`, {
          headers: this.headers,
          jwt: r.access_token,
          body: {
            challenge_id: e.challengeId,
            credential: e.credential
          }
        });
        return o4 ? this._returnResult({
          data: null,
          error: o4
        }) : this._returnResult({
          data: n3,
          error: null
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async _startPasskeyAuthentication(e) {
    var t2;
    C(this.experimental);
    try {
      let { data: r, error: s } = await f(this.fetch, "POST", `${this.url}/passkeys/authentication/options`, {
        headers: this.headers,
        body: {
          gotrue_meta_security: {
            captcha_token: (t2 = e?.options) === null || t2 === void 0 ? void 0 : t2.captchaToken
          }
        }
      });
      return s ? this._returnResult({
        data: null,
        error: s
      }) : this._returnResult({
        data: r,
        error: null
      });
    } catch (r) {
      if (h(r)) return this._returnResult({
        data: null,
        error: r
      });
      throw r;
    }
  }
  async _verifyPasskeyAuthentication(e) {
    C(this.experimental);
    try {
      let { data: t2, error: r } = await f(this.fetch, "POST", `${this.url}/passkeys/authentication/verify`, {
        headers: this.headers,
        body: {
          challenge_id: e.challengeId,
          credential: e.credential
        },
        xform: P
      });
      return r ? this._returnResult({
        data: null,
        error: r
      }) : (t2.session && (await this._saveSession(t2.session), await this._notifyAllSubscribers("SIGNED_IN", t2.session)), this._returnResult({
        data: t2,
        error: null
      }));
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async _listPasskeys() {
    C(this.experimental);
    try {
      return await this._useSession(async (e) => {
        let { data: { session: t2 }, error: r } = e;
        if (r) return this._returnResult({
          data: null,
          error: r
        });
        if (!t2) return this._returnResult({
          data: null,
          error: new E()
        });
        let { data: s, error: n3 } = await f(this.fetch, "GET", `${this.url}/passkeys`, {
          headers: this.headers,
          jwt: t2.access_token,
          xform: (o4) => ({
            data: o4,
            error: null
          })
        });
        return n3 ? this._returnResult({
          data: null,
          error: n3
        }) : this._returnResult({
          data: s,
          error: null
        });
      });
    } catch (e) {
      if (h(e)) return this._returnResult({
        data: null,
        error: e
      });
      throw e;
    }
  }
  async _updatePasskey(e) {
    C(this.experimental);
    try {
      return await this._useSession(async (t2) => {
        let { data: { session: r }, error: s } = t2;
        if (s) return this._returnResult({
          data: null,
          error: s
        });
        if (!r) return this._returnResult({
          data: null,
          error: new E()
        });
        let { data: n3, error: o4 } = await f(this.fetch, "PATCH", `${this.url}/passkeys/${e.passkeyId}`, {
          headers: this.headers,
          jwt: r.access_token,
          body: {
            friendly_name: e.friendlyName
          }
        });
        return o4 ? this._returnResult({
          data: null,
          error: o4
        }) : this._returnResult({
          data: n3,
          error: null
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
  async _deletePasskey(e) {
    C(this.experimental);
    try {
      return await this._useSession(async (t2) => {
        let { data: { session: r }, error: s } = t2;
        if (s) return this._returnResult({
          data: null,
          error: s
        });
        if (!r) return this._returnResult({
          data: null,
          error: new E()
        });
        let { error: n3 } = await f(this.fetch, "DELETE", `${this.url}/passkeys/${e.passkeyId}`, {
          headers: this.headers,
          jwt: r.access_token,
          noResolveJson: true
        });
        return n3 ? this._returnResult({
          data: null,
          error: n3
        }) : this._returnResult({
          data: null,
          error: null
        });
      });
    } catch (t2) {
      if (h(t2)) return this._returnResult({
        data: null,
        error: t2
      });
      throw t2;
    }
  }
};
xe.nextInstanceID = {};
var He = xe;
var or = J;
var ar = or;
var lr = He;
var ur = lr;

// deno:https://esm.sh/@supabase/functions-js@2.112.3/denonext/functions-js.mjs
var j = (e) => e ? (...t2) => e(...t2) : (...t2) => fetch(...t2);
var c = class extends Error {
  constructor(t2, p4 = "FunctionsError", a) {
    super(t2), this.name = p4, this.context = a;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      context: this.context
    };
  }
};
var x2 = class extends c {
  constructor(t2) {
    super("Failed to send a request to the Edge Function", "FunctionsFetchError", t2);
  }
};
var f2 = class extends c {
  constructor(t2) {
    super("Relay Error invoking the Edge Function", "FunctionsRelayError", t2);
  }
};
var u = class extends c {
  constructor(t2) {
    super("Edge Function returned a non-2xx status code", "FunctionsHttpError", t2);
  }
};
var E2;
(function(e) {
  e.Any = "any", e.ApNortheast1 = "ap-northeast-1", e.ApNortheast2 = "ap-northeast-2", e.ApSouth1 = "ap-south-1", e.ApSoutheast1 = "ap-southeast-1", e.ApSoutheast2 = "ap-southeast-2", e.CaCentral1 = "ca-central-1", e.EuCentral1 = "eu-central-1", e.EuWest1 = "eu-west-1", e.EuWest2 = "eu-west-2", e.EuWest3 = "eu-west-3", e.SaEast1 = "sa-east-1", e.UsEast1 = "us-east-1", e.UsWest1 = "us-west-1", e.UsWest2 = "us-west-2";
})(E2 || (E2 = {}));
var S3 = class {
  constructor(t2, { headers: p4 = {}, customFetch: a, region: h3 = E2.Any } = {}) {
    this.url = t2, this.headers = p4, this.region = h3, this.fetch = j(a);
  }
  setAuth(t2) {
    this.headers.Authorization = `Bearer ${t2}`;
  }
  invoke(t2) {
    return F(this, arguments, void 0, function* (p4, a = {}) {
      var h3, g3;
      let w6, d, b3;
      try {
        let { headers: o4, method: B6, body: r, signal: v2, timeout: T6 } = a, y5 = {}, { region: i4 } = a;
        i4 || (i4 = this.region);
        let F5 = new URL(`${this.url}/${p4}`);
        i4 && i4 !== "any" && (y5["x-region"] = i4, F5.searchParams.set("forceFunctionRegion", i4));
        let n3, N7 = !!o4 && Object.keys(o4).some((C7) => C7.toLowerCase() === "content-type");
        r && !N7 ? typeof Blob < "u" && r instanceof Blob || r instanceof ArrayBuffer ? (y5["Content-Type"] = "application/octet-stream", n3 = r) : typeof r == "string" ? (y5["Content-Type"] = "text/plain", n3 = r) : typeof FormData < "u" && r instanceof FormData ? n3 = r : (y5["Content-Type"] = "application/json", n3 = JSON.stringify(r)) : r && typeof r != "string" && !(typeof Blob < "u" && r instanceof Blob) && !(r instanceof ArrayBuffer) && !(typeof FormData < "u" && r instanceof FormData) ? n3 = JSON.stringify(r) : n3 = r;
        let A6 = v2;
        T6 && (d = new AbortController(), w6 = setTimeout(() => d.abort(), T6), v2 ? (A6 = d.signal, b3 = () => d.abort(), v2.addEventListener("abort", b3)) : A6 = d.signal);
        let s = yield this.fetch(F5.toString(), {
          method: B6 || "POST",
          headers: Object.assign(Object.assign(Object.assign({}, y5), this.headers), o4),
          body: n3,
          signal: A6
        }).catch((C7) => {
          throw new x2(C7);
        }), O8 = s.headers.get("x-relay-error");
        if (O8 && O8 === "true") throw new f2(s);
        if (!s.ok) throw new u(s);
        let m4 = ((h3 = s.headers.get("Content-Type")) !== null && h3 !== void 0 ? h3 : "text/plain").split(";")[0].trim().toLowerCase(), l;
        return m4 === "application/json" ? l = yield s.json() : m4 === "application/octet-stream" || m4 === "application/pdf" ? l = yield s.blob() : m4 === "text/event-stream" ? l = s : m4 === "multipart/form-data" ? l = yield s.formData() : l = yield s.text(), {
          data: l,
          error: null,
          response: s
        };
      } catch (o4) {
        return {
          data: null,
          error: o4,
          response: o4 instanceof u || o4 instanceof f2 ? o4.context : void 0
        };
      } finally {
        w6 && clearTimeout(w6), b3 && ((g3 = a.signal) === null || g3 === void 0 || g3.removeEventListener("abort", b3));
      }
    });
  }
};

// deno:https://esm.sh/@supabase/postgrest-js@2.112.3/denonext/postgrest-js.mjs
var O2 = (t2) => Math.min(1e3 * 2 ** t2, 3e4);
var D2 = [
  520,
  503
];
var j2 = [
  "GET",
  "HEAD",
  "OPTIONS"
];
var P2 = class extends Error {
  constructor(t2) {
    super(t2.message), this.name = "PostgrestError", this.details = t2.details, this.hint = t2.hint, this.code = t2.code;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      details: this.details,
      hint: this.hint,
      code: this.code
    };
  }
};
function g(t2) {
  "@babel/helpers - typeof";
  return g = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
    return typeof e;
  } : function(e) {
    return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
  }, g(t2);
}
function N2(t2, e) {
  if (g(t2) != "object" || !t2) return t2;
  var r = t2[Symbol.toPrimitive];
  if (r !== void 0) {
    var s = r.call(t2, e || "default");
    if (g(s) != "object") return s;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (e === "string" ? String : Number)(t2);
}
function H2(t2) {
  var e = N2(t2, "string");
  return g(e) == "symbol" ? e : e + "";
}
function q2(t2, e, r) {
  return (e = H2(e)) in t2 ? Object.defineProperty(t2, e, {
    value: r,
    enumerable: true,
    configurable: true,
    writable: true
  }) : t2[e] = r, t2;
}
function $2(t2, e) {
  var r = Object.keys(t2);
  if (Object.getOwnPropertySymbols) {
    var s = Object.getOwnPropertySymbols(t2);
    e && (s = s.filter(function(l) {
      return Object.getOwnPropertyDescriptor(t2, l).enumerable;
    })), r.push.apply(r, s);
  }
  return r;
}
function y(t2) {
  for (var e = 1; e < arguments.length; e++) {
    var r = arguments[e] != null ? arguments[e] : {};
    e % 2 ? $2(Object(r), true).forEach(function(s) {
      q2(t2, s, r[s]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t2, Object.getOwnPropertyDescriptors(r)) : $2(Object(r)).forEach(function(s) {
      Object.defineProperty(t2, s, Object.getOwnPropertyDescriptor(r, s));
    });
  }
  return t2;
}
function A2(t2, e) {
  return new Promise((r) => {
    if (e?.aborted) {
      r();
      return;
    }
    let s = setTimeout(() => {
      e?.removeEventListener("abort", l), r();
    }, t2);
    function l() {
      clearTimeout(s), r();
    }
    e?.addEventListener("abort", l);
  });
}
function C2(t2, e, r, s) {
  return !(!s || r >= 3 || !j2.includes(t2) || !D2.includes(e));
}
var E3 = class {
  constructor(t2) {
    var e, r, s, l, a;
    this.shouldThrowOnError = false, this.retryEnabled = true, this.method = t2.method, this.url = t2.url, this.headers = new Headers(t2.headers), this.schema = t2.schema, this.body = t2.body, this.shouldThrowOnError = (e = t2.shouldThrowOnError) !== null && e !== void 0 ? e : false, this.signal = t2.signal, this.isMaybeSingle = (r = t2.isMaybeSingle) !== null && r !== void 0 ? r : false, this.shouldStripNulls = (s = t2.shouldStripNulls) !== null && s !== void 0 ? s : false, this.urlLengthLimit = (l = t2.urlLengthLimit) !== null && l !== void 0 ? l : 8e3, this.retryEnabled = (a = t2.retry) !== null && a !== void 0 ? a : true, t2.fetch ? this.fetch = t2.fetch : this.fetch = fetch;
  }
  throwOnError() {
    return this.shouldThrowOnError = true, this;
  }
  stripNulls() {
    if (this.headers.get("Accept") === "text/csv") throw new Error("stripNulls() cannot be used with csv()");
    return this.shouldStripNulls = true, this;
  }
  setHeader(t2, e) {
    return this.headers = new Headers(this.headers), this.headers.set(t2, e), this;
  }
  retry(t2) {
    return this.retryEnabled = t2, this;
  }
  then(t2, e) {
    var r = this;
    if (this.schema === void 0 || ([
      "GET",
      "HEAD"
    ].includes(this.method) ? this.headers.set("Accept-Profile", this.schema) : this.headers.set("Content-Profile", this.schema)), this.method !== "GET" && this.method !== "HEAD" && this.headers.set("Content-Type", "application/json"), this.shouldStripNulls) {
      let i4 = this.headers.get("Accept");
      i4 === "application/vnd.pgrst.object+json" ? this.headers.set("Accept", "application/vnd.pgrst.object+json;nulls=stripped") : (!i4 || i4 === "application/json") && this.headers.set("Accept", "application/vnd.pgrst.array+json;nulls=stripped");
    }
    let s = this.fetch, a = (async () => {
      let i4 = 0;
      for (; ; ) {
        let o4 = {};
        r.headers.forEach((n3, d) => {
          o4[d] = n3;
        }), i4 > 0 && (o4["X-Retry-Count"] = String(i4));
        let c3;
        try {
          c3 = await s(r.url.toString(), {
            method: r.method,
            headers: o4,
            body: JSON.stringify(r.body, (n3, d) => typeof d == "bigint" ? d.toString() : d),
            signal: r.signal
          });
        } catch (n3) {
          if (n3?.name === "AbortError" || n3?.code === "ABORT_ERR" || !j2.includes(r.method)) throw n3;
          if (r.retryEnabled && i4 < 3) {
            let d = O2(i4);
            i4++, await A2(d, r.signal);
            continue;
          }
          throw n3;
        }
        if (C2(r.method, c3.status, i4, r.retryEnabled)) {
          var u2, h3;
          let n3 = (u2 = (h3 = c3.headers) === null || h3 === void 0 ? void 0 : h3.get("Retry-After")) !== null && u2 !== void 0 ? u2 : null, d = n3 !== null ? Math.max(0, parseInt(n3, 10) || 0) * 1e3 : O2(i4);
          await c3.text(), i4++, await A2(d, r.signal);
          continue;
        }
        return await r.processResponse(c3);
      }
    })();
    return this.shouldThrowOnError || (a = a.catch((i4) => {
      var u2;
      let h3 = "", o4 = "", c3 = "", n3 = i4?.cause;
      if (n3) {
        var d, p4, f5, w6;
        let k5 = (d = n3?.message) !== null && d !== void 0 ? d : "", L4 = (p4 = n3?.code) !== null && p4 !== void 0 ? p4 : "";
        h3 = `${(f5 = i4?.name) !== null && f5 !== void 0 ? f5 : "FetchError"}: ${i4?.message}`, h3 += `

Caused by: ${(w6 = n3?.name) !== null && w6 !== void 0 ? w6 : "Error"}: ${k5}`, L4 && (h3 += ` (${L4})`), n3?.stack && (h3 += `
${n3.stack}`);
      } else {
        var b3;
        h3 = (b3 = i4?.stack) !== null && b3 !== void 0 ? b3 : "";
      }
      let v2 = this.url.toString().length;
      return i4?.name === "AbortError" || i4?.code === "ABORT_ERR" ? (c3 = "", o4 = "Request was aborted (timeout or manual cancellation)", v2 > this.urlLengthLimit && (o4 += `. Note: Your request URL is ${v2} characters, which may exceed server limits. If selecting many fields, consider using views. If filtering with large arrays (e.g., .in('id', [many IDs])), consider using an RPC function to pass values server-side.`)) : (n3?.name === "HeadersOverflowError" || n3?.code === "UND_ERR_HEADERS_OVERFLOW") && (c3 = "", o4 = "HTTP headers exceeded server limits (typically 16KB)", v2 > this.urlLengthLimit && (o4 += `. Your request URL is ${v2} characters. If selecting many fields, consider using views. If filtering with large arrays (e.g., .in('id', [200+ IDs])), consider using an RPC function instead.`)), {
        success: false,
        error: {
          message: `${(u2 = i4?.name) !== null && u2 !== void 0 ? u2 : "FetchError"}: ${i4?.message}`,
          details: h3,
          hint: o4,
          code: c3
        },
        data: null,
        count: null,
        status: 0,
        statusText: ""
      };
    })), a.then(t2, e);
  }
  async processResponse(t2) {
    var e = this;
    let r = null, s = null, l = null, a = t2.status, i4 = t2.statusText;
    if (t2.ok) {
      var u2, h3;
      if (e.method !== "HEAD") {
        var o4;
        let p4 = await t2.text();
        if (p4 !== "") if (e.headers.get("Accept") === "text/csv") s = p4;
        else if (e.headers.get("Accept") && (!((o4 = e.headers.get("Accept")) === null || o4 === void 0) && o4.includes("application/vnd.pgrst.plan+text"))) s = p4;
        else try {
          s = JSON.parse(p4);
        } catch {
          if (r = {
            message: p4
          }, s = null, e.shouldThrowOnError) throw new P2({
            message: p4,
            details: "",
            hint: "",
            code: ""
          });
        }
      }
      let n3 = (u2 = e.headers.get("Prefer")) === null || u2 === void 0 ? void 0 : u2.match(/count=(exact|planned|estimated)/), d = (h3 = t2.headers.get("content-range")) === null || h3 === void 0 ? void 0 : h3.split("/");
      if (n3 && d && d.length > 1 && (l = parseInt(d[1])), e.isMaybeSingle && Array.isArray(s)) if (s.length > 1) {
        if (r = {
          code: "PGRST116",
          details: `Results contain ${s.length} rows, application/vnd.pgrst.object+json requires 1 row`,
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned"
        }, s = null, l = null, a = 406, i4 = "Not Acceptable", e.shouldThrowOnError) {
          var c3;
          throw new P2(y(y({}, r), {}, {
            hint: (c3 = r.hint) !== null && c3 !== void 0 ? c3 : ""
          }));
        }
      } else s.length === 1 ? s = s[0] : s = null;
    } else {
      let n3 = await t2.text();
      try {
        r = JSON.parse(n3), Array.isArray(r) && t2.status === 404 && (s = [], r = null, a = 200, i4 = "OK");
      } catch {
        t2.status === 404 && n3 === "" ? (a = 204, i4 = "No Content") : r = {
          message: n3
        };
      }
      if (r && e.shouldThrowOnError) throw new P2(r);
    }
    return {
      success: r === null,
      error: r,
      data: s,
      count: l,
      status: a,
      statusText: i4
    };
  }
  returns() {
    return this;
  }
  overrideTypes() {
    return this;
  }
};
var R = class extends E3 {
  throwOnError() {
    return super.throwOnError();
  }
  select(t2) {
    let e = false, r = (t2 ?? "*").split("").map((s) => /\s/.test(s) && !e ? "" : (s === '"' && (e = !e), s)).join("");
    return this.url.searchParams.set("select", r), this.headers.append("Prefer", "return=representation"), this;
  }
  order(t2, { ascending: e = true, nullsFirst: r, foreignTable: s, referencedTable: l = s } = {}) {
    let a = l ? `${l}.order` : "order", i4 = this.url.searchParams.get(a);
    return this.url.searchParams.set(a, `${i4 ? `${i4},` : ""}${t2}.${e ? "asc" : "desc"}${r === void 0 ? "" : r ? ".nullsfirst" : ".nullslast"}`), this;
  }
  limit(t2, { foreignTable: e, referencedTable: r = e } = {}) {
    let s = typeof r > "u" ? "limit" : `${r}.limit`;
    return this.url.searchParams.set(s, `${t2}`), this;
  }
  range(t2, e, { foreignTable: r, referencedTable: s = r } = {}) {
    let l = typeof s > "u" ? "offset" : `${s}.offset`, a = typeof s > "u" ? "limit" : `${s}.limit`;
    return this.url.searchParams.set(l, `${t2}`), this.url.searchParams.set(a, `${e - t2 + 1}`), this;
  }
  abortSignal(t2) {
    return this.signal = t2, this;
  }
  single() {
    return this.headers.set("Accept", "application/vnd.pgrst.object+json"), this;
  }
  maybeSingle() {
    return this.isMaybeSingle = true, this;
  }
  csv() {
    return this.headers.set("Accept", "text/csv"), this;
  }
  geojson() {
    return this.headers.set("Accept", "application/geo+json"), this;
  }
  explain({ analyze: t2 = false, verbose: e = false, settings: r = false, buffers: s = false, wal: l = false, format: a = "text" } = {}) {
    var i4;
    let u2 = [
      t2 ? "analyze" : null,
      e ? "verbose" : null,
      r ? "settings" : null,
      s ? "buffers" : null,
      l ? "wal" : null
    ].filter(Boolean).join("|"), h3 = (i4 = this.headers.get("Accept")) !== null && i4 !== void 0 ? i4 : "application/json";
    return this.headers.set("Accept", `application/vnd.pgrst.plan+${a}; for="${h3}"; options=${u2};`), a === "json" ? this : this;
  }
  rollback() {
    return this.headers.append("Prefer", "tx=rollback"), this;
  }
  returns() {
    return this;
  }
  maxAffected(t2) {
    return this.headers.append("Prefer", "handling=strict"), this.headers.append("Prefer", `max-affected=${t2}`), this;
  }
};
var S4 = new RegExp("[,()]");
var m = class extends R {
  throwOnError() {
    return super.throwOnError();
  }
  eq(t2, e) {
    return this.url.searchParams.append(t2, `eq.${e}`), this;
  }
  neq(t2, e) {
    return this.url.searchParams.append(t2, `neq.${e}`), this;
  }
  gt(t2, e) {
    return this.url.searchParams.append(t2, `gt.${e}`), this;
  }
  gte(t2, e) {
    return this.url.searchParams.append(t2, `gte.${e}`), this;
  }
  lt(t2, e) {
    return this.url.searchParams.append(t2, `lt.${e}`), this;
  }
  lte(t2, e) {
    return this.url.searchParams.append(t2, `lte.${e}`), this;
  }
  like(t2, e) {
    return this.url.searchParams.append(t2, `like.${e}`), this;
  }
  likeAllOf(t2, e) {
    return this.url.searchParams.append(t2, `like(all).{${e.join(",")}}`), this;
  }
  likeAnyOf(t2, e) {
    return this.url.searchParams.append(t2, `like(any).{${e.join(",")}}`), this;
  }
  ilike(t2, e) {
    return this.url.searchParams.append(t2, `ilike.${e}`), this;
  }
  ilikeAllOf(t2, e) {
    return this.url.searchParams.append(t2, `ilike(all).{${e.join(",")}}`), this;
  }
  ilikeAnyOf(t2, e) {
    return this.url.searchParams.append(t2, `ilike(any).{${e.join(",")}}`), this;
  }
  regexMatch(t2, e) {
    return this.url.searchParams.append(t2, `match.${e}`), this;
  }
  regexIMatch(t2, e) {
    return this.url.searchParams.append(t2, `imatch.${e}`), this;
  }
  is(t2, e) {
    return this.url.searchParams.append(t2, `is.${e}`), this;
  }
  isDistinct(t2, e) {
    return this.url.searchParams.append(t2, `isdistinct.${e}`), this;
  }
  in(t2, e) {
    let r = Array.from(new Set(e)).map((s) => typeof s == "string" && S4.test(s) ? `"${s}"` : `${s}`).join(",");
    return this.url.searchParams.append(t2, `in.(${r})`), this;
  }
  notIn(t2, e) {
    let r = Array.from(new Set(e)).map((s) => typeof s == "string" && S4.test(s) ? `"${s}"` : `${s}`).join(",");
    return this.url.searchParams.append(t2, `not.in.(${r})`), this;
  }
  contains(t2, e) {
    return typeof e == "string" ? this.url.searchParams.append(t2, `cs.${e}`) : Array.isArray(e) ? this.url.searchParams.append(t2, `cs.{${e.join(",")}}`) : this.url.searchParams.append(t2, `cs.${JSON.stringify(e)}`), this;
  }
  containedBy(t2, e) {
    return typeof e == "string" ? this.url.searchParams.append(t2, `cd.${e}`) : Array.isArray(e) ? this.url.searchParams.append(t2, `cd.{${e.join(",")}}`) : this.url.searchParams.append(t2, `cd.${JSON.stringify(e)}`), this;
  }
  rangeGt(t2, e) {
    return this.url.searchParams.append(t2, `sr.${e}`), this;
  }
  rangeGte(t2, e) {
    return this.url.searchParams.append(t2, `nxl.${e}`), this;
  }
  rangeLt(t2, e) {
    return this.url.searchParams.append(t2, `sl.${e}`), this;
  }
  rangeLte(t2, e) {
    return this.url.searchParams.append(t2, `nxr.${e}`), this;
  }
  rangeAdjacent(t2, e) {
    return this.url.searchParams.append(t2, `adj.${e}`), this;
  }
  overlaps(t2, e) {
    return typeof e == "string" ? this.url.searchParams.append(t2, `ov.${e}`) : this.url.searchParams.append(t2, `ov.{${e.join(",")}}`), this;
  }
  textSearch(t2, e, { config: r, type: s } = {}) {
    let l = "";
    s === "plain" ? l = "pl" : s === "phrase" ? l = "ph" : s === "websearch" && (l = "w");
    let a = r === void 0 ? "" : `(${r})`;
    return this.url.searchParams.append(t2, `${l}fts${a}.${e}`), this;
  }
  match(t2) {
    return Object.entries(t2).filter(([e, r]) => r !== void 0).forEach(([e, r]) => {
      this.url.searchParams.append(e, `eq.${r}`);
    }), this;
  }
  not(t2, e, r) {
    return this.url.searchParams.append(t2, `not.${e}.${r}`), this;
  }
  or(t2, { foreignTable: e, referencedTable: r = e } = {}) {
    let s = r ? `${r}.or` : "or";
    return this.url.searchParams.append(s, `(${t2})`), this;
  }
  filter(t2, e, r) {
    return this.url.searchParams.append(t2, `${e}.${r}`), this;
  }
};
var T = class {
  constructor(t2, { headers: e = {}, schema: r, fetch: s, urlLengthLimit: l = 8e3, retry: a }) {
    this.url = t2, this.headers = new Headers(e), this.schema = r, this.fetch = s, this.urlLengthLimit = l, this.retry = a;
  }
  cloneRequestState() {
    return {
      url: new URL(this.url.toString()),
      headers: new Headers(this.headers)
    };
  }
  select(t2, e) {
    let { head: r = false, count: s } = e ?? {}, l = r ? "HEAD" : "GET", a = false, i4 = (t2 ?? "*").split("").map((o4) => /\s/.test(o4) && !a ? "" : (o4 === '"' && (a = !a), o4)).join(""), { url: u2, headers: h3 } = this.cloneRequestState();
    return u2.searchParams.set("select", i4), s && h3.append("Prefer", `count=${s}`), new m({
      method: l,
      url: u2,
      headers: h3,
      schema: this.schema,
      fetch: this.fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
  insert(t2, { count: e, defaultToNull: r = true } = {}) {
    var s;
    let l = "POST", { url: a, headers: i4 } = this.cloneRequestState();
    if (e && i4.append("Prefer", `count=${e}`), r || i4.append("Prefer", "missing=default"), Array.isArray(t2)) {
      let u2 = t2.reduce((h3, o4) => h3.concat(Object.keys(o4)), []);
      if (u2.length > 0) {
        let h3 = [
          ...new Set(u2)
        ].map((o4) => `"${o4}"`);
        a.searchParams.set("columns", h3.join(","));
      }
    }
    return new m({
      method: l,
      url: a,
      headers: i4,
      schema: this.schema,
      body: t2,
      fetch: (s = this.fetch) !== null && s !== void 0 ? s : fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
  upsert(t2, { onConflict: e, ignoreDuplicates: r = false, count: s, defaultToNull: l = true } = {}) {
    var a;
    let i4 = "POST", { url: u2, headers: h3 } = this.cloneRequestState();
    if (h3.append("Prefer", `resolution=${r ? "ignore" : "merge"}-duplicates`), e !== void 0 && u2.searchParams.set("on_conflict", e), s && h3.append("Prefer", `count=${s}`), l || h3.append("Prefer", "missing=default"), Array.isArray(t2)) {
      let o4 = t2.reduce((c3, n3) => c3.concat(Object.keys(n3)), []);
      if (o4.length > 0) {
        let c3 = [
          ...new Set(o4)
        ].map((n3) => `"${n3}"`);
        u2.searchParams.set("columns", c3.join(","));
      }
    }
    return new m({
      method: i4,
      url: u2,
      headers: h3,
      schema: this.schema,
      body: t2,
      fetch: (a = this.fetch) !== null && a !== void 0 ? a : fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
  update(t2, { count: e } = {}) {
    var r;
    let s = "PATCH", { url: l, headers: a } = this.cloneRequestState();
    return e && a.append("Prefer", `count=${e}`), new m({
      method: s,
      url: l,
      headers: a,
      schema: this.schema,
      body: t2,
      fetch: (r = this.fetch) !== null && r !== void 0 ? r : fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
  delete({ count: t2 } = {}) {
    var e;
    let r = "DELETE", { url: s, headers: l } = this.cloneRequestState();
    return t2 && l.append("Prefer", `count=${t2}`), new m({
      method: r,
      url: s,
      headers: l,
      schema: this.schema,
      fetch: (e = this.fetch) !== null && e !== void 0 ? e : fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
};
var _ = class x3 {
  constructor(e, { headers: r = {}, schema: s, fetch: l, timeout: a, urlLengthLimit: i4 = 8e3, retry: u2 } = {}) {
    this.url = e, this.headers = new Headers(r), this.schemaName = s, this.urlLengthLimit = i4;
    let h3 = l ?? globalThis.fetch;
    a !== void 0 && a > 0 ? this.fetch = (o4, c3) => {
      let n3 = new AbortController(), d = setTimeout(() => n3.abort(), a), p4 = c3?.signal;
      if (p4) {
        if (p4.aborted) return clearTimeout(d), h3(o4, c3);
        let f5 = () => {
          clearTimeout(d), n3.abort();
        };
        return p4.addEventListener("abort", f5, {
          once: true
        }), h3(o4, y(y({}, c3), {}, {
          signal: n3.signal
        })).finally(() => {
          clearTimeout(d), p4.removeEventListener("abort", f5);
        });
      }
      return h3(o4, y(y({}, c3), {}, {
        signal: n3.signal
      })).finally(() => clearTimeout(d));
    } : this.fetch = h3, this.retry = u2;
  }
  from(e) {
    if (!e || typeof e != "string" || e.trim() === "") throw new Error("Invalid relation name: relation must be a non-empty string.");
    return new T(new URL(`${this.url}/${e}`), {
      headers: new Headers(this.headers),
      schema: this.schemaName,
      fetch: this.fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
  schema(e) {
    return new x3(this.url, {
      headers: this.headers,
      schema: e,
      fetch: this.fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
  rpc(e, r = {}, { head: s = false, get: l = false, count: a } = {}) {
    var i4;
    let u2, h3 = new URL(`${this.url}/rpc/${e}`), o4, c3 = (p4) => p4 !== null && typeof p4 == "object" && (!Array.isArray(p4) || p4.some(c3)), n3 = s && Object.values(r).some(c3);
    n3 ? (u2 = "POST", o4 = r) : s || l ? (u2 = s ? "HEAD" : "GET", Object.entries(r).filter(([p4, f5]) => f5 !== void 0).map(([p4, f5]) => [
      p4,
      Array.isArray(f5) ? `{${f5.join(",")}}` : `${f5}`
    ]).forEach(([p4, f5]) => {
      h3.searchParams.append(p4, f5);
    })) : (u2 = "POST", o4 = r);
    let d = new Headers(this.headers);
    return n3 ? d.set("Prefer", a ? `count=${a},return=minimal` : "return=minimal") : a && d.set("Prefer", `count=${a}`), new m({
      method: u2,
      url: h3,
      headers: d,
      schema: this.schemaName,
      body: o4,
      fetch: (i4 = this.fetch) !== null && i4 !== void 0 ? i4 : fetch,
      urlLengthLimit: this.urlLengthLimit,
      retry: this.retry
    });
  }
};

// deno:https://esm.sh/@supabase/realtime-js@2.112.3/denonext/realtime-js.mjs
import __Process$ from "node:process";

// deno:https://esm.sh/@supabase/phoenix@0.4.5/denonext/phoenix.mjs
var k = (e) => typeof e == "function" ? e : function() {
  return e;
};
var _2 = typeof self < "u" ? self : null;
var C3 = typeof globalThis < "u" ? globalThis : null;
var m2 = _2 || C3 || globalThis;
var B2 = "2.0.0";
var O3 = 1e4;
var P3 = 1e3;
var N3 = 100;
var b = {
  connecting: 0,
  open: 1,
  closing: 2,
  closed: 3
};
var f3 = {
  closed: "closed",
  errored: "errored",
  joined: "joined",
  joining: "joining",
  leaving: "leaving"
};
var T2 = {
  close: "phx_close",
  error: "phx_error",
  join: "phx_join",
  reply: "phx_reply",
  leave: "phx_leave"
};
var w = {
  longpoll: "longpoll",
  websocket: "websocket"
};
var x4 = {
  complete: 4
};
var A3 = "base64url.bearer.phx.";
var E4 = class {
  constructor(e, t2, i4, s) {
    this.channel = e, this.event = t2, this.payload = i4 || function() {
      return {};
    }, this.receivedResp = null, this.timeout = s, this.timeoutTimer = null, this.recHooks = [], this.sent = false, this.ref = void 0;
  }
  resend(e) {
    this.timeout = e, this.reset(), this.send();
  }
  send() {
    this.hasReceived("timeout") || (this.startTimeout(), this.sent = true, this.channel.socket.push({
      topic: this.channel.topic,
      event: this.event,
      payload: this.payload(),
      ref: this.ref,
      join_ref: this.channel.joinRef()
    }));
  }
  receive(e, t2) {
    return this.hasReceived(e) && t2(this.receivedResp.response), this.recHooks.push({
      status: e,
      callback: t2
    }), this;
  }
  reset() {
    this.cancelRefEvent(), this.ref = null, this.refEvent = null, this.receivedResp = null, this.sent = false;
  }
  destroy() {
    this.cancelRefEvent(), this.cancelTimeout();
  }
  matchReceive({ status: e, response: t2, _ref: i4 }) {
    this.recHooks.filter((s) => s.status === e).forEach((s) => s.callback(t2));
  }
  cancelRefEvent() {
    this.refEvent && this.channel.off(this.refEvent);
  }
  cancelTimeout() {
    clearTimeout(this.timeoutTimer), this.timeoutTimer = null;
  }
  startTimeout() {
    this.timeoutTimer && this.cancelTimeout(), this.ref = this.channel.socket.makeRef(), this.refEvent = this.channel.replyEventName(this.ref), this.channel.on(this.refEvent, (e) => {
      this.cancelRefEvent(), this.cancelTimeout(), this.receivedResp = e, this.matchReceive(e);
    }), this.timeoutTimer = setTimeout(() => {
      this.trigger("timeout", {});
    }, this.timeout);
  }
  hasReceived(e) {
    return this.receivedResp && this.receivedResp.status === e;
  }
  trigger(e, t2) {
    this.channel.trigger(this.refEvent, {
      status: e,
      response: t2
    });
  }
};
var H3 = class {
  constructor(e, t2) {
    this.callback = e, this.timerCalc = t2, this.timer = void 0, this.tries = 0;
  }
  reset() {
    this.tries = 0, clearTimeout(this.timer);
  }
  scheduleTimeout() {
    clearTimeout(this.timer), this.timer = setTimeout(() => {
      this.tries = this.tries + 1, this.callback();
    }, this.timerCalc(this.tries + 1));
  }
};
var $3 = class {
  constructor(e, t2, i4) {
    this.state = f3.closed, this.topic = e, this.params = k(t2 || {}), this.socket = i4, this.bindings = [], this.bindingRef = 0, this.timeout = this.socket.timeout, this.joinedOnce = false, this.joinPush = new E4(this, T2.join, this.params, this.timeout), this.pushBuffer = [], this.stateChangeRefs = [], this.rejoinTimer = new H3(() => {
      this.socket.isConnected() && this.rejoin();
    }, this.socket.rejoinAfterMs), this.stateChangeRefs.push(this.socket.onError(() => this.rejoinTimer.reset())), this.stateChangeRefs.push(this.socket.onOpen(() => {
      this.rejoinTimer.reset(), this.isErrored() && this.rejoin();
    })), this.joinPush.receive("ok", () => {
      this.state = f3.joined, this.rejoinTimer.reset(), this.pushBuffer.forEach((s) => s.send()), this.pushBuffer = [];
    }), this.joinPush.receive("error", (s) => {
      this.state = f3.errored, this.socket.hasLogger() && this.socket.log("channel", `error ${this.topic}`, s), this.socket.isConnected() && this.rejoinTimer.scheduleTimeout();
    }), this.onClose(() => {
      this.rejoinTimer.reset(), this.socket.hasLogger() && this.socket.log("channel", `close ${this.topic}`), this.state = f3.closed, this.socket.remove(this);
    }), this.onError((s) => {
      this.socket.hasLogger() && this.socket.log("channel", `error ${this.topic}`, s), this.isJoining() && this.joinPush.reset(), this.state = f3.errored, this.socket.isConnected() && this.rejoinTimer.scheduleTimeout();
    }), this.joinPush.receive("timeout", () => {
      this.socket.hasLogger() && this.socket.log("channel", `timeout ${this.topic}`, this.joinPush.timeout), new E4(this, T2.leave, k({}), this.timeout).send(), this.state = f3.errored, this.joinPush.reset(), this.socket.isConnected() && this.rejoinTimer.scheduleTimeout();
    }), this.on(T2.reply, (s, n3) => {
      this.trigger(this.replyEventName(n3), s);
    });
  }
  join(e = this.timeout) {
    if (this.joinedOnce) throw new Error("tried to join multiple times. 'join' can only be called a single time per channel instance");
    return this.timeout = e, this.joinedOnce = true, this.rejoin(), this.joinPush;
  }
  teardown() {
    this.pushBuffer.forEach((e) => e.destroy()), this.pushBuffer = [], this.rejoinTimer.reset(), this.joinPush.destroy(), this.state = f3.closed, this.bindings = [];
  }
  onClose(e) {
    this.on(T2.close, e);
  }
  onError(e) {
    return this.on(T2.error, (t2) => e(t2));
  }
  on(e, t2) {
    let i4 = this.bindingRef++;
    return this.bindings.push({
      event: e,
      ref: i4,
      callback: t2
    }), i4;
  }
  off(e, t2) {
    this.bindings = this.bindings.filter((i4) => !(i4.event === e && (typeof t2 > "u" || t2 === i4.ref)));
  }
  canPush() {
    return this.socket.isConnected() && this.isJoined();
  }
  push(e, t2, i4 = this.timeout) {
    if (t2 = t2 || {}, !this.joinedOnce) throw new Error(`tried to push '${e}' to '${this.topic}' before joining. Use channel.join() before pushing events`);
    let s = new E4(this, e, function() {
      return t2;
    }, i4);
    return this.canPush() ? s.send() : (s.startTimeout(), this.pushBuffer.push(s)), s;
  }
  leave(e = this.timeout) {
    this.rejoinTimer.reset(), this.joinPush.cancelTimeout(), this.state = f3.leaving;
    let t2 = () => {
      this.socket.hasLogger() && this.socket.log("channel", `leave ${this.topic}`), this.trigger(T2.close, "leave");
    }, i4 = new E4(this, T2.leave, k({}), e);
    return i4.receive("ok", () => t2()).receive("timeout", () => t2()), i4.send(), this.canPush() || i4.trigger("ok", {}), i4;
  }
  onMessage(e, t2, i4) {
    return t2;
  }
  filterBindings(e, t2, i4) {
    return true;
  }
  isMember(e, t2, i4, s) {
    return this.topic !== e ? false : s && s !== this.joinRef() ? (this.socket.hasLogger() && this.socket.log("channel", "dropping outdated message", {
      topic: e,
      event: t2,
      payload: i4,
      joinRef: s
    }), false) : true;
  }
  joinRef() {
    return this.joinPush.ref;
  }
  rejoin(e = this.timeout) {
    this.isLeaving() || (this.socket.leaveOpenTopic(this.topic), this.state = f3.joining, this.joinPush.resend(e));
  }
  trigger(e, t2, i4, s) {
    let n3 = this.onMessage(e, t2, i4, s);
    if (t2 && !n3) throw new Error("channel onMessage callbacks must return the payload, modified or unmodified");
    let o4 = this.bindings.filter((h3) => h3.event === e && this.filterBindings(h3, t2, i4));
    for (let h3 = 0; h3 < o4.length; h3++) o4[h3].callback(n3, i4, s || this.joinRef());
  }
  replyEventName(e) {
    return `chan_reply_${e}`;
  }
  isClosed() {
    return this.state === f3.closed;
  }
  isErrored() {
    return this.state === f3.errored;
  }
  isJoined() {
    return this.state === f3.joined;
  }
  isJoining() {
    return this.state === f3.joining;
  }
  isLeaving() {
    return this.state === f3.leaving;
  }
};
var j3 = class {
  static request(e, t2, i4, s, n3, o4, h3) {
    if (m2.XDomainRequest) {
      let r = new m2.XDomainRequest();
      return this.xdomainRequest(r, e, t2, s, n3, o4, h3);
    } else if (m2.XMLHttpRequest) {
      let r = new m2.XMLHttpRequest();
      return this.xhrRequest(r, e, t2, i4, s, n3, o4, h3);
    } else {
      if (m2.fetch && m2.AbortController) return this.fetchRequest(e, t2, i4, s, n3, o4, h3);
      throw new Error("No suitable XMLHttpRequest implementation found");
    }
  }
  static fetchRequest(e, t2, i4, s, n3, o4, h3) {
    let r = {
      method: e,
      headers: i4,
      body: s
    }, a = null;
    if (n3) {
      a = new AbortController();
      let l = setTimeout(() => a.abort(), n3);
      r.signal = a.signal;
    }
    return m2.fetch(t2, r).then((l) => l.text()).then((l) => this.parseJSON(l)).then((l) => h3 && h3(l)).catch((l) => {
      l.name === "AbortError" && o4 ? o4() : h3 && h3(null);
    }), a;
  }
  static xdomainRequest(e, t2, i4, s, n3, o4, h3) {
    return e.timeout = n3, e.open(t2, i4), e.onload = () => {
      let r = this.parseJSON(e.responseText);
      h3 && h3(r);
    }, o4 && (e.ontimeout = o4), e.onprogress = () => {
    }, e.send(s), e;
  }
  static xhrRequest(e, t2, i4, s, n3, o4, h3, r) {
    e.open(t2, i4, true), e.timeout = o4;
    for (let [a, l] of Object.entries(s)) e.setRequestHeader(a, l);
    return e.onerror = () => r && r(null), e.onreadystatechange = () => {
      if (e.readyState === x4.complete && r) {
        let a = this.parseJSON(e.responseText);
        r(a);
      }
    }, h3 && (e.ontimeout = h3), e.send(n3), e;
  }
  static parseJSON(e) {
    if (!e || e === "") return null;
    try {
      return JSON.parse(e);
    } catch {
      return console && console.log("failed to parse JSON response", e), null;
    }
  }
  static serialize(e, t2) {
    let i4 = [];
    for (var s in e) {
      if (!Object.prototype.hasOwnProperty.call(e, s)) continue;
      let n3 = t2 ? `${t2}[${s}]` : s, o4 = e[s];
      typeof o4 == "object" ? i4.push(this.serialize(o4, n3)) : i4.push(encodeURIComponent(n3) + "=" + encodeURIComponent(o4));
    }
    return i4.join("&");
  }
  static appendParams(e, t2) {
    if (Object.keys(t2).length === 0) return e;
    let i4 = e.match(/\?/) ? "&" : "?";
    return `${e}${i4}${this.serialize(t2)}`;
  }
};
var M = (e) => {
  let t2 = "", i4 = new Uint8Array(e), s = i4.byteLength;
  for (let n3 = 0; n3 < s; n3++) t2 += String.fromCharCode(i4[n3]);
  return btoa(t2);
};
var y2 = class {
  constructor(e, t2) {
    t2 && t2.length === 2 && t2[1].startsWith(A3) && (this.authToken = atob(t2[1].slice(A3.length))), this.endPoint = null, this.token = null, this.skipHeartbeat = true, this.reqs = /* @__PURE__ */ new Set(), this.awaitingBatchAck = false, this.currentBatch = null, this.currentBatchTimer = null, this.batchBuffer = [], this.onopen = function() {
    }, this.onerror = function() {
    }, this.onmessage = function() {
    }, this.onclose = function() {
    }, this.pollEndpoint = this.normalizeEndpoint(e), this.readyState = b.connecting, setTimeout(() => this.poll(), 0);
  }
  normalizeEndpoint(e) {
    return e.replace("ws://", "http://").replace("wss://", "https://").replace(new RegExp("(.*)/" + w.websocket), "$1/" + w.longpoll);
  }
  endpointURL() {
    return j3.appendParams(this.pollEndpoint, {
      token: this.token
    });
  }
  closeAndRetry(e, t2, i4) {
    this.close(e, t2, i4), this.readyState = b.connecting;
  }
  ontimeout() {
    this.onerror("timeout"), this.closeAndRetry(1005, "timeout", false);
  }
  isActive() {
    return this.readyState === b.open || this.readyState === b.connecting;
  }
  poll() {
    let e = {
      Accept: "application/json"
    };
    this.authToken && (e["X-Phoenix-AuthToken"] = this.authToken), this.ajax("GET", e, null, () => this.ontimeout(), (t2) => {
      if (t2) {
        var { status: i4, token: s, messages: n3 } = t2;
        if (i4 === 410 && this.token !== null) {
          this.onerror(410), this.closeAndRetry(3410, "session_gone", false);
          return;
        }
        this.token = s;
      } else i4 = 0;
      switch (i4) {
        case 200:
          n3.forEach((o4) => {
            setTimeout(() => this.onmessage({
              data: o4
            }), 0);
          }), this.poll();
          break;
        case 204:
          this.poll();
          break;
        case 410:
          this.readyState = b.open, this.onopen({}), this.poll();
          break;
        case 403:
          this.onerror(403), this.close(1008, "forbidden", false);
          break;
        case 0:
        case 500:
          this.onerror(500), this.closeAndRetry(1011, "internal server error", 500);
          break;
        default:
          throw new Error(`unhandled poll status ${i4}`);
      }
    });
  }
  send(e) {
    typeof e != "string" && (e = M(e)), this.currentBatch ? this.currentBatch.push(e) : this.awaitingBatchAck ? this.batchBuffer.push(e) : (this.currentBatch = [
      e
    ], this.currentBatchTimer = setTimeout(() => {
      this.batchSend(this.currentBatch), this.currentBatch = null;
    }, 0));
  }
  batchSend(e, t2 = 0) {
    this.awaitingBatchAck = true;
    let i4 = t2 + N3, s = e.slice(t2, i4);
    this.ajax("POST", {
      "Content-Type": "application/x-ndjson"
    }, s.join(`
`), () => this.onerror("timeout"), (n3) => {
      !n3 || n3.status !== 200 ? (this.awaitingBatchAck = false, this.onerror(n3 && n3.status), this.closeAndRetry(1011, "internal server error", false)) : i4 < e.length ? this.batchSend(e, i4) : this.batchBuffer.length > 0 ? (this.batchSend(this.batchBuffer), this.batchBuffer = []) : this.awaitingBatchAck = false;
    });
  }
  close(e, t2, i4) {
    for (let n3 of this.reqs) n3.abort();
    this.readyState = b.closed;
    let s = Object.assign({
      code: 1e3,
      reason: void 0,
      wasClean: true
    }, {
      code: e,
      reason: t2,
      wasClean: i4
    });
    this.batchBuffer = [], clearTimeout(this.currentBatchTimer), this.currentBatchTimer = null, typeof CloseEvent < "u" ? this.onclose(new CloseEvent("close", s)) : this.onclose(s);
  }
  ajax(e, t2, i4, s, n3) {
    let o4, h3 = () => {
      this.reqs.delete(o4), s();
    };
    o4 = j3.request(e, this.endpointURL(), t2, i4, this.timeout, h3, (r) => {
      this.reqs.delete(o4), this.isActive() && n3(r);
    }), this.reqs.add(o4);
  }
};
var D3 = class S5 {
  constructor(t2, i4 = {}) {
    let s = i4.events || {
      state: "presence_state",
      diff: "presence_diff"
    };
    this.state = /* @__PURE__ */ Object.create(null), this.pendingDiffs = [], this.channel = t2, this.joinRef = null, this.caller = {
      onJoin: function() {
      },
      onLeave: function() {
      },
      onSync: function() {
      }
    }, this.channel.on(s.state, (n3) => {
      let { onJoin: o4, onLeave: h3, onSync: r } = this.caller;
      this.joinRef = this.channel.joinRef(), this.state = S5.syncState(this.state, n3, o4, h3), this.pendingDiffs.forEach((a) => {
        this.state = S5.syncDiff(this.state, a, o4, h3);
      }), this.pendingDiffs = [], r();
    }), this.channel.on(s.diff, (n3) => {
      let { onJoin: o4, onLeave: h3, onSync: r } = this.caller;
      this.inPendingSyncState() ? this.pendingDiffs.push(n3) : (this.state = S5.syncDiff(this.state, n3, o4, h3), r());
    });
  }
  onJoin(t2) {
    this.caller.onJoin = t2;
  }
  onLeave(t2) {
    this.caller.onLeave = t2;
  }
  onSync(t2) {
    this.caller.onSync = t2;
  }
  list(t2) {
    return S5.list(this.state, t2);
  }
  inPendingSyncState() {
    return !this.joinRef || this.joinRef !== this.channel.joinRef();
  }
  static syncState(t2, i4, s, n3) {
    let o4 = this.toNullProtoObj(this.clone(t2));
    i4 = this.toNullProtoObj(i4);
    let h3 = /* @__PURE__ */ Object.create(null), r = /* @__PURE__ */ Object.create(null);
    return this.map(o4, (a, l) => {
      i4[a] || (r[a] = l);
    }), this.map(i4, (a, l) => {
      let u2 = o4[a];
      if (u2) {
        let g3 = l.metas.map((c3) => c3.phx_ref), d = u2.metas.map((c3) => c3.phx_ref), p4 = l.metas.filter((c3) => d.indexOf(c3.phx_ref) < 0), v2 = u2.metas.filter((c3) => g3.indexOf(c3.phx_ref) < 0);
        p4.length > 0 && (h3[a] = l, h3[a].metas = p4), v2.length > 0 && (r[a] = this.clone(u2), r[a].metas = v2);
      } else h3[a] = l;
    }), this.syncDiff(o4, {
      joins: h3,
      leaves: r
    }, s, n3);
  }
  static syncDiff(t2, i4, s, n3) {
    t2 = this.toNullProtoObj(t2);
    let { joins: o4, leaves: h3 } = this.clone(i4);
    return s || (s = function() {
    }), n3 || (n3 = function() {
    }), this.map(o4, (r, a) => {
      let l = t2[r];
      if (t2[r] = this.clone(a), l) {
        let u2 = t2[r].metas.map((d) => d.phx_ref), g3 = l.metas.filter((d) => u2.indexOf(d.phx_ref) < 0);
        t2[r].metas.unshift(...g3);
      }
      s(r, l, a);
    }), this.map(h3, (r, a) => {
      let l = t2[r];
      if (!l) return;
      let u2 = a.metas.map((g3) => g3.phx_ref);
      l.metas = l.metas.filter((g3) => u2.indexOf(g3.phx_ref) < 0), n3(r, l, a), l.metas.length === 0 && delete t2[r];
    }), t2;
  }
  static list(t2, i4) {
    return i4 || (i4 = function(s, n3) {
      return n3;
    }), this.map(t2, (s, n3) => i4(s, n3));
  }
  static map(t2, i4) {
    return Object.getOwnPropertyNames(t2).map((s) => i4(s, t2[s]));
  }
  static toNullProtoObj(t2) {
    if (Object.getPrototypeOf(t2) === null) return t2;
    let i4 = /* @__PURE__ */ Object.create(null);
    return Object.getOwnPropertyNames(t2).forEach((s) => {
      i4[s] = t2[s];
    }), i4;
  }
  static clone(t2) {
    return JSON.parse(JSON.stringify(t2));
  }
};
var R2 = {
  HEADER_LENGTH: 1,
  META_LENGTH: 4,
  KINDS: {
    push: 0,
    reply: 1,
    broadcast: 2
  },
  encode(e, t2) {
    if (e.payload.constructor === ArrayBuffer) return t2(this.binaryEncode(e));
    {
      let i4 = [
        e.join_ref,
        e.ref,
        e.topic,
        e.event,
        e.payload
      ];
      return t2(JSON.stringify(i4));
    }
  },
  decode(e, t2) {
    if (e.constructor === ArrayBuffer) return t2(this.binaryDecode(e));
    {
      let [i4, s, n3, o4, h3] = JSON.parse(e);
      return t2({
        join_ref: i4,
        ref: s,
        topic: n3,
        event: o4,
        payload: h3
      });
    }
  },
  binaryEncode(e) {
    let { join_ref: t2, ref: i4, event: s, topic: n3, payload: o4 } = e, h3 = new TextEncoder(), r = h3.encode(t2), a = h3.encode(i4), l = h3.encode(n3), u2 = h3.encode(s);
    this.assertFieldSize(r.byteLength, "join_ref"), this.assertFieldSize(a.byteLength, "ref"), this.assertFieldSize(l.byteLength, "topic"), this.assertFieldSize(u2.byteLength, "event");
    let g3 = this.META_LENGTH + r.byteLength + a.byteLength + l.byteLength + u2.byteLength, d = new ArrayBuffer(this.HEADER_LENGTH + g3), p4 = new Uint8Array(d), v2 = new DataView(d), c3 = 0;
    v2.setUint8(c3++, this.KINDS.push), v2.setUint8(c3++, r.byteLength), v2.setUint8(c3++, a.byteLength), v2.setUint8(c3++, l.byteLength), v2.setUint8(c3++, u2.byteLength), p4.set(r, c3), c3 += r.byteLength, p4.set(a, c3), c3 += a.byteLength, p4.set(l, c3), c3 += l.byteLength, p4.set(u2, c3), c3 += u2.byteLength;
    var L4 = new Uint8Array(d.byteLength + o4.byteLength);
    return L4.set(p4, 0), L4.set(new Uint8Array(o4), d.byteLength), L4.buffer;
  },
  assertFieldSize(e, t2) {
    if (e > 255) throw new Error(`unable to convert ${t2} to binary: must be less than or equal to 255 bytes, but is ${e} bytes`);
  },
  binaryDecode(e) {
    let t2 = new DataView(e), i4 = t2.getUint8(0), s = new TextDecoder();
    switch (i4) {
      case this.KINDS.push:
        return this.decodePush(e, t2, s);
      case this.KINDS.reply:
        return this.decodeReply(e, t2, s);
      case this.KINDS.broadcast:
        return this.decodeBroadcast(e, t2, s);
    }
  },
  decodePush(e, t2, i4) {
    let s = t2.getUint8(1), n3 = t2.getUint8(2), o4 = t2.getUint8(3), h3 = this.HEADER_LENGTH + this.META_LENGTH - 1, r = i4.decode(e.slice(h3, h3 + s));
    h3 = h3 + s;
    let a = i4.decode(e.slice(h3, h3 + n3));
    h3 = h3 + n3;
    let l = i4.decode(e.slice(h3, h3 + o4));
    h3 = h3 + o4;
    let u2 = e.slice(h3, e.byteLength);
    return {
      join_ref: r,
      ref: null,
      topic: a,
      event: l,
      payload: u2
    };
  },
  decodeReply(e, t2, i4) {
    let s = t2.getUint8(1), n3 = t2.getUint8(2), o4 = t2.getUint8(3), h3 = t2.getUint8(4), r = this.HEADER_LENGTH + this.META_LENGTH, a = i4.decode(e.slice(r, r + s));
    r = r + s;
    let l = i4.decode(e.slice(r, r + n3));
    r = r + n3;
    let u2 = i4.decode(e.slice(r, r + o4));
    r = r + o4;
    let g3 = i4.decode(e.slice(r, r + h3));
    r = r + h3;
    let d = e.slice(r, e.byteLength), p4 = {
      status: g3,
      response: d
    };
    return {
      join_ref: a,
      ref: l,
      topic: u2,
      event: T2.reply,
      payload: p4
    };
  },
  decodeBroadcast(e, t2, i4) {
    let s = t2.getUint8(1), n3 = t2.getUint8(2), o4 = this.HEADER_LENGTH + 2, h3 = i4.decode(e.slice(o4, o4 + s));
    o4 = o4 + s;
    let r = i4.decode(e.slice(o4, o4 + n3));
    o4 = o4 + n3;
    let a = e.slice(o4, e.byteLength);
    return {
      join_ref: null,
      ref: null,
      topic: h3,
      event: r,
      payload: a
    };
  }
};
var U2 = class {
  constructor(e, t2 = {}) {
    this.stateChangeCallbacks = {
      open: [],
      close: [],
      error: [],
      message: []
    }, this.channels = [], this.sendBuffer = [], this.ref = 0, this.fallbackRef = null, this.timeout = t2.timeout || O3, this.transport = t2.transport || m2.WebSocket || y2, this.conn = void 0, this.primaryPassedHealthCheck = false, this.longPollFallbackMs = t2.longPollFallbackMs, this.fallbackTimer = null;
    let i4 = null;
    try {
      i4 = m2 && m2.sessionStorage;
    } catch {
    }
    this.sessionStore = t2.sessionStorage || i4, this.establishedConnections = 0, this.defaultEncoder = R2.encode.bind(R2), this.defaultDecoder = R2.decode.bind(R2), this.closeWasClean = true, this.disconnecting = false, this.binaryType = t2.binaryType || "arraybuffer", this.connectClock = 1, this.pageHidden = false, this.encode = void 0, this.decode = void 0, this.transport !== y2 ? (this.encode = t2.encode || this.defaultEncoder, this.decode = t2.decode || this.defaultDecoder) : (this.encode = this.defaultEncoder, this.decode = this.defaultDecoder);
    let s = null;
    C3 && C3.addEventListener && (C3.addEventListener("pagehide", (n3) => {
      this.conn && (this.disconnect(), s = this.connectClock);
    }), C3.addEventListener("pageshow", (n3) => {
      s === this.connectClock && (s = null, this.connect());
    }), C3.addEventListener("visibilitychange", () => {
      document.visibilityState === "hidden" ? this.pageHidden = true : (this.pageHidden = false, !this.isConnected() && !this.closeWasClean && this.teardown(() => this.connect()));
    })), this.heartbeatIntervalMs = t2.heartbeatIntervalMs || 3e4, this.autoSendHeartbeat = t2.autoSendHeartbeat ?? true, this.heartbeatCallback = t2.heartbeatCallback ?? (() => {
    }), this.rejoinAfterMs = (n3) => t2.rejoinAfterMs ? t2.rejoinAfterMs(n3) : [
      1e3,
      2e3,
      5e3
    ][n3 - 1] || 1e4, this.reconnectAfterMs = (n3) => t2.reconnectAfterMs ? t2.reconnectAfterMs(n3) : [
      10,
      50,
      100,
      150,
      200,
      250,
      500,
      1e3,
      2e3
    ][n3 - 1] || 5e3, this.logger = t2.logger || null, !this.logger && t2.debug && (this.logger = (n3, o4, h3) => {
      console.log(`${n3}: ${o4}`, h3);
    }), this.longpollerTimeout = t2.longpollerTimeout || 2e4, this.params = k(t2.params || {}), this.endPoint = `${e}/${w.websocket}`, this.vsn = t2.vsn || B2, this.heartbeatTimeoutTimer = null, this.heartbeatTimer = null, this.heartbeatSentAt = null, this.pendingHeartbeatRef = null, this.reconnectTimer = new H3(() => {
      if (this.pageHidden) {
        this.log("Not reconnecting as page is hidden!"), this.teardown();
        return;
      }
      this.teardown(async () => {
        t2.beforeReconnect && await t2.beforeReconnect(), this.connect();
      });
    }, this.reconnectAfterMs), this.authToken = t2.authToken && k(t2.authToken);
  }
  getLongPollTransport() {
    return y2;
  }
  replaceTransport(e) {
    this.connectClock++, this.closeWasClean = true, clearTimeout(this.fallbackTimer), this.reconnectTimer.reset(), this.conn && (this.conn.close(), this.conn = null), this.transport = e;
  }
  protocol() {
    return location.protocol.match(/^https/) ? "wss" : "ws";
  }
  endPointURL() {
    let e = j3.appendParams(j3.appendParams(this.endPoint, this.params()), {
      vsn: this.vsn
    });
    return e.charAt(0) !== "/" ? e : e.charAt(1) === "/" ? `${this.protocol()}:${e}` : `${this.protocol()}://${location.host}${e}`;
  }
  disconnect(e, t2, i4) {
    this.connectClock++, this.disconnecting = true, this.closeWasClean = true, clearTimeout(this.fallbackTimer), this.reconnectTimer.reset(), this.teardown(() => {
      this.disconnecting = false, e && e();
    }, t2, i4);
  }
  connect(e) {
    e && (console && console.log("passing params to connect is deprecated. Instead pass :params to the Socket constructor"), this.params = k(e)), !(this.conn && !this.disconnecting) && (this.longPollFallbackMs && this.transport !== y2 ? this.connectWithFallback(y2, this.longPollFallbackMs) : this.transportConnect());
  }
  log(e, t2, i4) {
    this.logger && this.logger(e, t2, i4);
  }
  hasLogger() {
    return this.logger !== null;
  }
  onOpen(e) {
    let t2 = this.makeRef();
    return this.stateChangeCallbacks.open.push([
      t2,
      e
    ]), t2;
  }
  onClose(e) {
    let t2 = this.makeRef();
    return this.stateChangeCallbacks.close.push([
      t2,
      e
    ]), t2;
  }
  onError(e) {
    let t2 = this.makeRef();
    return this.stateChangeCallbacks.error.push([
      t2,
      e
    ]), t2;
  }
  onMessage(e) {
    let t2 = this.makeRef();
    return this.stateChangeCallbacks.message.push([
      t2,
      e
    ]), t2;
  }
  onHeartbeat(e) {
    this.heartbeatCallback = e;
  }
  ping(e) {
    if (!this.isConnected()) return false;
    let t2 = this.makeRef(), i4 = Date.now();
    this.push({
      topic: "phoenix",
      event: "heartbeat",
      payload: {},
      ref: t2
    });
    let s = this.onMessage((n3) => {
      n3.ref === t2 && (this.off([
        s
      ]), e(Date.now() - i4));
    });
    return true;
  }
  transportName(e) {
    return e === y2 ? "LongPoll" : e.name;
  }
  transportConnect() {
    this.connectClock++, this.closeWasClean = false;
    let e;
    this.authToken && (e = [
      "phoenix",
      `${A3}${btoa(this.authToken()).replace(/=/g, "")}`
    ]), this.conn = new this.transport(this.endPointURL(), e), this.conn.binaryType = this.binaryType, this.conn.timeout = this.longpollerTimeout, this.conn.onopen = () => this.onConnOpen(), this.conn.onerror = (t2) => this.onConnError(t2), this.conn.onmessage = (t2) => this.onConnMessage(t2), this.conn.onclose = (t2) => this.onConnClose(t2);
  }
  getSession(e) {
    return this.sessionStore && this.sessionStore.getItem(e);
  }
  storeSession(e, t2) {
    this.sessionStore && this.sessionStore.setItem(e, t2);
  }
  connectWithFallback(e, t2 = 2500) {
    clearTimeout(this.fallbackTimer);
    let i4 = false, s = true, n3, o4, h3 = this.transportName(e), r = (a) => {
      this.log("transport", `falling back to ${h3}...`, a), this.off([
        n3,
        o4
      ]), s = false, this.replaceTransport(e), this.transportConnect();
    };
    if (this.getSession(`phx:fallback:${h3}`)) return r("memorized");
    this.fallbackTimer = setTimeout(r, t2), o4 = this.onError((a) => {
      this.log("transport", "error", a), s && !i4 && (clearTimeout(this.fallbackTimer), r(a));
    }), this.fallbackRef && this.off([
      this.fallbackRef
    ]), this.fallbackRef = this.onOpen(() => {
      if (i4 = true, !s) {
        let a = this.transportName(e);
        return this.primaryPassedHealthCheck || this.storeSession(`phx:fallback:${a}`, "true"), this.log("transport", `established ${a} fallback`);
      }
      clearTimeout(this.fallbackTimer), this.fallbackTimer = setTimeout(r, t2), this.ping((a) => {
        this.log("transport", "connected to primary after", a), this.primaryPassedHealthCheck = true, clearTimeout(this.fallbackTimer);
      });
    }), this.transportConnect();
  }
  clearHeartbeats() {
    clearTimeout(this.heartbeatTimer), clearTimeout(this.heartbeatTimeoutTimer);
  }
  onConnOpen() {
    this.hasLogger() && this.log("transport", `connected to ${this.endPointURL()}`), this.closeWasClean = false, this.disconnecting = false, this.establishedConnections++, this.flushSendBuffer(), this.reconnectTimer.reset(), this.autoSendHeartbeat && this.resetHeartbeat(), this.triggerStateCallbacks("open");
  }
  heartbeatTimeout() {
    if (this.pendingHeartbeatRef) {
      this.pendingHeartbeatRef = null, this.heartbeatSentAt = null, this.hasLogger() && this.log("transport", "heartbeat timeout. Attempting to re-establish connection");
      try {
        this.heartbeatCallback("timeout");
      } catch (e) {
        this.log("error", "error in heartbeat callback", e);
      }
      this.triggerChanError(new Error("heartbeat timeout")), this.closeWasClean = false, this.teardown(() => this.reconnectTimer.scheduleTimeout(), P3, "heartbeat timeout");
    }
  }
  resetHeartbeat() {
    this.conn && this.conn.skipHeartbeat || (this.pendingHeartbeatRef = null, this.clearHeartbeats(), this.heartbeatTimer = setTimeout(() => this.sendHeartbeat(), this.heartbeatIntervalMs));
  }
  teardown(e, t2, i4) {
    if (!this.conn) return e && e();
    let s = this.conn;
    this.waitForBufferDone(s, () => {
      t2 ? s.close(t2, i4 || "") : s.close(), this.waitForSocketClosed(s, () => {
        this.conn === s && (this.conn.onopen = function() {
        }, this.conn.onerror = function() {
        }, this.conn.onmessage = function() {
        }, this.conn.onclose = function() {
        }, this.conn = null), e && e();
      });
    });
  }
  waitForBufferDone(e, t2, i4 = 1) {
    if (i4 === 5 || !e.bufferedAmount) {
      t2();
      return;
    }
    setTimeout(() => {
      this.waitForBufferDone(e, t2, i4 + 1);
    }, 150 * i4);
  }
  waitForSocketClosed(e, t2, i4 = 1) {
    if (i4 === 5 || e.readyState === b.closed) {
      t2();
      return;
    }
    setTimeout(() => {
      this.waitForSocketClosed(e, t2, i4 + 1);
    }, 150 * i4);
  }
  onConnClose(e) {
    this.conn && (this.conn.onclose = () => {
    }), this.hasLogger() && this.log("transport", "close", e), this.triggerChanError(e), this.clearHeartbeats(), this.closeWasClean || this.reconnectTimer.scheduleTimeout(), this.triggerStateCallbacks("close", e);
  }
  onConnError(e) {
    this.hasLogger() && this.log("transport", "error", e);
    let t2 = this.transport, i4 = this.establishedConnections;
    this.triggerStateCallbacks("error", e, t2, i4), (t2 === this.transport || i4 > 0) && this.triggerChanError(e);
  }
  triggerChanError(e) {
    this.channels.forEach((t2) => {
      t2.isErrored() || t2.isLeaving() || t2.isClosed() || t2.trigger(T2.error, e);
    });
  }
  connectionState() {
    switch (this.conn && this.conn.readyState) {
      case b.connecting:
        return "connecting";
      case b.open:
        return "open";
      case b.closing:
        return "closing";
      default:
        return "closed";
    }
  }
  isConnected() {
    return this.connectionState() === "open";
  }
  remove(e) {
    this.off(e.stateChangeRefs), this.channels = this.channels.filter((t2) => t2 !== e);
  }
  off(e) {
    for (let t2 in this.stateChangeCallbacks) this.stateChangeCallbacks[t2] = this.stateChangeCallbacks[t2].filter(([i4]) => e.indexOf(i4) === -1);
  }
  channel(e, t2 = {}) {
    let i4 = new $3(e, t2, this);
    return this.channels.push(i4), i4;
  }
  push(e) {
    if (this.hasLogger()) {
      let { topic: t2, event: i4, payload: s, ref: n3, join_ref: o4 } = e;
      this.log("push", `${t2} ${i4} (${o4}, ${n3})`, s);
    }
    this.isConnected() ? this.encode(e, (t2) => this.conn.send(t2)) : this.sendBuffer.push(() => this.encode(e, (t2) => this.conn.send(t2)));
  }
  makeRef() {
    let e = this.ref + 1;
    return e === this.ref ? this.ref = 0 : this.ref = e, this.ref.toString();
  }
  sendHeartbeat() {
    if (!this.isConnected()) {
      try {
        this.heartbeatCallback("disconnected");
      } catch (e) {
        this.log("error", "error in heartbeat callback", e);
      }
      return;
    }
    if (this.pendingHeartbeatRef) {
      this.heartbeatTimeout();
      return;
    }
    this.pendingHeartbeatRef = this.makeRef(), this.heartbeatSentAt = Date.now(), this.push({
      topic: "phoenix",
      event: "heartbeat",
      payload: {},
      ref: this.pendingHeartbeatRef
    });
    try {
      this.heartbeatCallback("sent");
    } catch (e) {
      this.log("error", "error in heartbeat callback", e);
    }
    this.heartbeatTimeoutTimer = setTimeout(() => this.heartbeatTimeout(), this.heartbeatIntervalMs);
  }
  flushSendBuffer() {
    this.isConnected() && this.sendBuffer.length > 0 && (this.sendBuffer.forEach((e) => e()), this.sendBuffer = []);
  }
  onConnMessage(e) {
    this.decode(e.data, (t2) => {
      let { topic: i4, event: s, payload: n3, ref: o4, join_ref: h3 } = t2;
      if (o4 && o4 === this.pendingHeartbeatRef) {
        let r = this.heartbeatSentAt ? Date.now() - this.heartbeatSentAt : void 0;
        this.clearHeartbeats();
        try {
          this.heartbeatCallback(n3.status === "ok" ? "ok" : "error", r);
        } catch (a) {
          this.log("error", "error in heartbeat callback", a);
        }
        this.pendingHeartbeatRef = null, this.heartbeatSentAt = null, this.autoSendHeartbeat && (this.heartbeatTimer = setTimeout(() => this.sendHeartbeat(), this.heartbeatIntervalMs));
      }
      this.hasLogger() && this.log("receive", `${n3.status || ""} ${i4} ${s} ${o4 && "(" + o4 + ")" || ""}`.trim(), n3);
      for (let r = 0; r < this.channels.length; r++) {
        let a = this.channels[r];
        a.isMember(i4, s, n3, h3) && a.trigger(s, n3, o4, h3);
      }
      this.triggerStateCallbacks("message", t2);
    });
  }
  triggerStateCallbacks(e, ...t2) {
    try {
      this.stateChangeCallbacks[e].forEach(([i4, s]) => {
        try {
          s(...t2);
        } catch (n3) {
          this.log("error", `error in ${e} callback`, n3);
        }
      });
    } catch (i4) {
      this.log("error", `error triggering ${e} callbacks`, i4);
    }
  }
  leaveOpenTopic(e) {
    let t2 = this.channels.find((i4) => i4.topic === e && (i4.isJoined() || i4.isJoining()));
    t2 && (this.hasLogger() && this.log("transport", `leaving duplicate topic "${e}"`), t2.leave());
  }
};

// deno:https://esm.sh/@supabase/realtime-js@2.112.3/denonext/realtime-js.mjs
var B3 = class {
  constructor() {
  }
  static detectEnvironment() {
    var e;
    if (typeof WebSocket < "u") return {
      type: "native",
      wsConstructor: WebSocket
    };
    let t2 = globalThis;
    if (typeof globalThis < "u" && typeof t2.WebSocket < "u") return {
      type: "native",
      wsConstructor: t2.WebSocket
    };
    let r = typeof globalThis < "u" ? globalThis : void 0;
    if (r && typeof r.WebSocket < "u") return {
      type: "native",
      wsConstructor: r.WebSocket
    };
    if (typeof globalThis < "u" && typeof t2.WebSocketPair < "u" && typeof globalThis.WebSocket > "u") return {
      type: "cloudflare",
      error: "Cloudflare Workers detected. WebSocket clients are not supported in Cloudflare Workers.",
      workaround: "Use Cloudflare Workers WebSocket API for server-side WebSocket handling, or deploy to a different runtime."
    };
    if (typeof globalThis < "u" && t2.EdgeRuntime || typeof navigator < "u" && (!((e = navigator.userAgent) === null || e === void 0) && e.includes("Vercel-Edge"))) return {
      type: "unsupported",
      error: "Edge runtime detected (Vercel Edge/Netlify Edge). WebSockets are not supported in edge functions.",
      workaround: "Use serverless functions or a different deployment target for WebSocket functionality."
    };
    let s = __Process$;
    if (s) {
      let i4 = s.versions;
      if (i4 && i4.node) return {
        type: "unsupported",
        error: "Node.js detected but native WebSocket not found.",
        workaround: "Ensure you are running Node.js 22+ or provide a WebSocket implementation via the transport option."
      };
    }
    return {
      type: "unsupported",
      error: "Unknown JavaScript runtime without WebSocket support.",
      workaround: "Ensure you're running in a supported environment (browser, Node.js, Deno) or provide a custom WebSocket implementation."
    };
  }
  static getWebSocketConstructor() {
    let e = this.detectEnvironment();
    if (e.wsConstructor) return e.wsConstructor;
    let t2 = e.error || "WebSocket not supported in this environment.";
    throw e.workaround && (t2 += `

Suggested solution: ${e.workaround}`), new Error(t2);
  }
  static isWebSocketSupported() {
    try {
      return this.detectEnvironment().type === "native";
    } catch {
      return false;
    }
  }
};
var D4 = B3;
var $4 = "2.112.3";
var F3 = `realtime-js/${$4}`;
var J2 = "1.0.0";
var I2 = "2.0.0";
var z2 = I2;
var G2 = 1e4;
var q3 = 100;
var _3 = {
  closed: "closed",
  errored: "errored",
  joined: "joined",
  joining: "joining",
  leaving: "leaving"
};
var P4 = {
  close: "phx_close",
  error: "phx_error",
  join: "phx_join",
  reply: "phx_reply",
  leave: "phx_leave",
  access_token: "access_token"
};
var T3 = {
  connecting: "connecting",
  open: "open",
  closing: "closing",
  closed: "closed"
};
var C4 = class {
  constructor(e) {
    this.HEADER_LENGTH = 1, this.USER_BROADCAST_PUSH_META_LENGTH = 6, this.KINDS = {
      userBroadcastPush: 3,
      userBroadcast: 4
    }, this.BINARY_ENCODING = 0, this.JSON_ENCODING = 1, this.BROADCAST_EVENT = "broadcast", this.allowedMetadataKeys = [], this.allowedMetadataKeys = e ?? [];
  }
  encode(e, t2) {
    if (e.event === this.BROADCAST_EVENT && !(e.payload instanceof ArrayBuffer) && typeof e.payload.event == "string") return t2(this._binaryEncodeUserBroadcastPush(e));
    let r = [
      e.join_ref,
      e.ref,
      e.topic,
      e.event,
      e.payload
    ];
    return t2(JSON.stringify(r));
  }
  _binaryEncodeUserBroadcastPush(e) {
    var t2;
    return this._isArrayBuffer((t2 = e.payload) === null || t2 === void 0 ? void 0 : t2.payload) ? this._encodeBinaryUserBroadcastPush(e) : this._encodeJsonUserBroadcastPush(e);
  }
  _encodeBinaryUserBroadcastPush(e) {
    var t2, r;
    let s = (r = (t2 = e.payload) === null || t2 === void 0 ? void 0 : t2.payload) !== null && r !== void 0 ? r : new ArrayBuffer(0);
    return this._encodeUserBroadcastPush(e, this.BINARY_ENCODING, s);
  }
  _encodeJsonUserBroadcastPush(e) {
    var t2, r;
    let s = (r = (t2 = e.payload) === null || t2 === void 0 ? void 0 : t2.payload) !== null && r !== void 0 ? r : {}, o4 = new TextEncoder().encode(JSON.stringify(s)).buffer;
    return this._encodeUserBroadcastPush(e, this.JSON_ENCODING, o4);
  }
  _encodeUserBroadcastPush(e, t2, r) {
    var s, i4;
    let o4 = new TextEncoder(), a = o4.encode(e.topic), c3 = o4.encode((s = e.ref) !== null && s !== void 0 ? s : ""), l = o4.encode((i4 = e.join_ref) !== null && i4 !== void 0 ? i4 : ""), u2 = o4.encode(e.payload.event), g3 = this.allowedMetadataKeys ? this._pick(e.payload, this.allowedMetadataKeys) : {}, f5 = o4.encode(Object.keys(g3).length === 0 ? "" : JSON.stringify(g3));
    if (l.length > 255) throw new Error(`joinRef length ${l.length} exceeds maximum of 255`);
    if (c3.length > 255) throw new Error(`ref length ${c3.length} exceeds maximum of 255`);
    if (a.length > 255) throw new Error(`topic length ${a.length} exceeds maximum of 255`);
    if (u2.length > 255) throw new Error(`userEvent length ${u2.length} exceeds maximum of 255`);
    if (f5.length > 255) throw new Error(`metadata length ${f5.length} exceeds maximum of 255`);
    let h3 = this.USER_BROADCAST_PUSH_META_LENGTH + l.length + c3.length + a.length + u2.length + f5.length, d = new ArrayBuffer(this.HEADER_LENGTH + h3), v2 = new DataView(d), b3 = new Uint8Array(d), m4 = 0;
    v2.setUint8(m4++, this.KINDS.userBroadcastPush), v2.setUint8(m4++, l.length), v2.setUint8(m4++, c3.length), v2.setUint8(m4++, a.length), v2.setUint8(m4++, u2.length), v2.setUint8(m4++, f5.length), v2.setUint8(m4++, t2), b3.set(l, m4), m4 += l.length, b3.set(c3, m4), m4 += c3.length, b3.set(a, m4), m4 += a.length, b3.set(u2, m4), m4 += u2.length, b3.set(f5, m4), m4 += f5.length;
    var E7 = new Uint8Array(d.byteLength + r.byteLength);
    return E7.set(new Uint8Array(d), 0), E7.set(new Uint8Array(r), d.byteLength), E7.buffer;
  }
  decode(e, t2) {
    if (this._isArrayBuffer(e)) {
      let r = this._binaryDecode(e);
      return t2(r);
    }
    if (typeof e == "string") {
      let r = JSON.parse(e), [s, i4, o4, a, c3] = r;
      return t2({
        join_ref: s,
        ref: i4,
        topic: o4,
        event: a,
        payload: c3
      });
    }
    return t2({});
  }
  _binaryDecode(e) {
    let t2 = new DataView(e), r = t2.getUint8(0), s = new TextDecoder();
    if (r === this.KINDS.userBroadcast) return this._decodeUserBroadcast(e, t2, s);
  }
  _decodeUserBroadcast(e, t2, r) {
    let s = t2.getUint8(1), i4 = t2.getUint8(2), o4 = t2.getUint8(3), a = t2.getUint8(4), c3 = this.HEADER_LENGTH + 4, l = r.decode(e.slice(c3, c3 + s));
    c3 = c3 + s;
    let u2 = r.decode(e.slice(c3, c3 + i4));
    c3 = c3 + i4;
    let g3 = r.decode(e.slice(c3, c3 + o4));
    c3 = c3 + o4;
    let f5 = e.slice(c3, e.byteLength), h3 = a === this.JSON_ENCODING ? JSON.parse(r.decode(f5)) : f5, d = {
      type: this.BROADCAST_EVENT,
      event: u2,
      payload: h3
    };
    return o4 > 0 && (d.meta = JSON.parse(g3)), {
      join_ref: null,
      ref: null,
      topic: l,
      event: this.BROADCAST_EVENT,
      payload: d
    };
  }
  _isArrayBuffer(e) {
    var t2;
    return e instanceof ArrayBuffer || ((t2 = e?.constructor) === null || t2 === void 0 ? void 0 : t2.name) === "ArrayBuffer";
  }
  _pick(e, t2) {
    return !e || typeof e != "object" ? {} : Object.fromEntries(Object.entries(e).filter(([r]) => t2.includes(r)));
  }
};
var p;
(function(n3) {
  n3.abstime = "abstime", n3.bool = "bool", n3.date = "date", n3.daterange = "daterange", n3.float4 = "float4", n3.float8 = "float8", n3.int2 = "int2", n3.int4 = "int4", n3.int4range = "int4range", n3.int8 = "int8", n3.int8range = "int8range", n3.json = "json", n3.jsonb = "jsonb", n3.money = "money", n3.numeric = "numeric", n3.oid = "oid", n3.reltime = "reltime", n3.text = "text", n3.time = "time", n3.timestamp = "timestamp", n3.timestamptz = "timestamptz", n3.timetz = "timetz", n3.tsrange = "tsrange", n3.tstzrange = "tstzrange";
})(p || (p = {}));
var M2 = (n3, e, t2 = {}) => {
  var r;
  let s = (r = t2.skipTypes) !== null && r !== void 0 ? r : [];
  return e ? Object.keys(e).reduce((i4, o4) => (i4[o4] = te2(o4, n3, e, s), i4), {}) : {};
};
var te2 = (n3, e, t2, r) => {
  let s = e.find((a) => a.name === n3), i4 = s?.type, o4 = t2[n3];
  return i4 && !r.includes(i4) ? K2(i4, o4) : H4(o4);
};
var K2 = (n3, e) => {
  if (n3.charAt(0) === "_") {
    let t2 = n3.slice(1, n3.length);
    return ie2(e, t2);
  }
  switch (n3) {
    case p.bool:
      return ne2(e);
    case p.float4:
    case p.float8:
    case p.int2:
    case p.int4:
    case p.int8:
    case p.numeric:
    case p.oid:
      return re2(e);
    case p.json:
    case p.jsonb:
      return se2(e);
    case p.timestamp:
      return oe2(e);
    case p.abstime:
    case p.date:
    case p.daterange:
    case p.int4range:
    case p.int8range:
    case p.money:
    case p.reltime:
    case p.text:
    case p.time:
    case p.timestamptz:
    case p.timetz:
    case p.tsrange:
    case p.tstzrange:
      return H4(e);
    default:
      return H4(e);
  }
};
var H4 = (n3) => n3;
var ne2 = (n3) => {
  switch (n3) {
    case "t":
      return true;
    case "f":
      return false;
    default:
      return n3;
  }
};
var re2 = (n3) => {
  if (typeof n3 == "string") {
    let e = parseFloat(n3);
    if (!Number.isNaN(e)) return e;
  }
  return n3;
};
var se2 = (n3) => {
  if (typeof n3 == "string") try {
    return JSON.parse(n3);
  } catch {
    return n3;
  }
  return n3;
};
var ie2 = (n3, e) => {
  if (typeof n3 != "string") return n3;
  let t2 = n3.length - 1, r = n3[t2];
  if (n3[0] === "{" && r === "}") {
    let i4, o4 = n3.slice(1, t2);
    try {
      i4 = JSON.parse("[" + o4 + "]");
    } catch {
      i4 = o4 ? o4.split(",") : [];
    }
    return i4.map((a) => K2(e, a));
  }
  return n3;
};
var oe2 = (n3) => typeof n3 == "string" ? n3.replace(" ", "T") : n3;
var j4 = (n3) => {
  let e = new URL(n3);
  return e.protocol = e.protocol.replace(/^ws/i, "http"), e.pathname = e.pathname.replace(/\/+$/, "").replace(/\/socket\/websocket$/i, "").replace(/\/socket$/i, "").replace(/\/websocket$/i, ""), e.pathname === "" || e.pathname === "/" ? e.pathname = "/api/broadcast" : e.pathname = e.pathname + "/api/broadcast", e.href;
};
var N4 = class n {
  constructor(e, t2) {
    let r = de2(t2);
    this.presence = new D3(e.getChannel(), r), this.presence.onJoin((s, i4, o4) => {
      let a = n.onJoinPayload(s, i4, o4);
      e.getChannel().trigger("presence", a);
    }), this.presence.onLeave((s, i4, o4) => {
      let a = n.onLeavePayload(s, i4, o4);
      e.getChannel().trigger("presence", a);
    }), this.presence.onSync(() => {
      e.getChannel().trigger("presence", {
        event: "sync"
      });
    });
  }
  get state() {
    return n.transformState(this.presence.state);
  }
  static transformState(e) {
    return e = le2(e), Object.getOwnPropertyNames(e).reduce((t2, r) => {
      let s = e[r];
      return t2[r] = L2(s), t2;
    }, {});
  }
  static onJoinPayload(e, t2, r) {
    let s = Y2(t2), i4 = L2(r);
    return {
      event: "join",
      key: e,
      currentPresences: s,
      newPresences: i4
    };
  }
  static onLeavePayload(e, t2, r) {
    let s = Y2(t2), i4 = L2(r);
    return {
      event: "leave",
      key: e,
      currentPresences: s,
      leftPresences: i4
    };
  }
};
function L2(n3) {
  return n3.metas.map((e) => {
    let t2 = Object.getOwnPropertyDescriptors(e), r = Object.defineProperties({}, t2);
    return r.presence_ref = r.phx_ref, delete r.phx_ref, delete r.phx_ref_prev, r;
  });
}
function le2(n3) {
  return JSON.parse(JSON.stringify(n3));
}
function de2(n3) {
  return n3?.events && {
    events: n3.events
  };
}
function Y2(n3) {
  return n3?.metas ? L2(n3) : [];
}
var W2;
(function(n3) {
  n3.SYNC = "sync", n3.JOIN = "join", n3.LEAVE = "leave";
})(W2 || (W2 = {}));
var w2 = class {
  get state() {
    return this.presenceAdapter.state;
  }
  constructor(e, t2) {
    this.channel = e, this.presenceAdapter = new N4(this.channel.channelAdapter, t2);
  }
};
function X2(n3) {
  if (n3 instanceof Error) return n3;
  if (typeof n3 == "string") return new Error(n3);
  if (n3 && typeof n3 == "object") {
    let e = n3;
    if (typeof e.code == "number") {
      let t2 = typeof e.reason == "string" && e.reason ? ` (${e.reason})` : "";
      return new Error(`socket closed: ${e.code}${t2}`, {
        cause: n3
      });
    }
    return new Error("channel error: transport failure", {
      cause: n3
    });
  }
  return new Error("channel error: connection lost");
}
var R3 = class {
  constructor(e, t2, r) {
    let s = he2(r);
    this.channel = e.getSocket().channel(t2, s), this.socket = e;
  }
  get state() {
    return this.channel.state;
  }
  set state(e) {
    this.channel.state = e;
  }
  get joinedOnce() {
    return this.channel.joinedOnce;
  }
  get joinPush() {
    return this.channel.joinPush;
  }
  get rejoinTimer() {
    return this.channel.rejoinTimer;
  }
  on(e, t2) {
    return this.channel.on(e, t2);
  }
  off(e, t2) {
    this.channel.off(e, t2);
  }
  subscribe(e) {
    return this.channel.join(e);
  }
  unsubscribe(e) {
    return this.channel.leave(e);
  }
  teardown() {
    this.channel.teardown();
  }
  onClose(e) {
    this.channel.onClose(e);
  }
  onError(e) {
    return this.channel.onError(e);
  }
  push(e, t2, r) {
    let s;
    try {
      s = this.channel.push(e, t2, r);
    } catch {
      throw new Error(`tried to push '${e}' to '${this.channel.topic}' before joining. Use channel.subscribe() before pushing events`);
    }
    if (this.channel.pushBuffer.length > q3) {
      let i4 = this.channel.pushBuffer.shift();
      i4.cancelTimeout(), this.socket.log("channel", `discarded push due to buffer overflow: ${i4.event}`, i4.payload());
    }
    return s;
  }
  updateJoinPayload(e) {
    let t2 = this.channel.joinPush.payload();
    this.channel.joinPush.payload = () => Object.assign(Object.assign({}, t2), e);
  }
  canPush() {
    return this.socket.isConnected() && this.state === _3.joined;
  }
  isJoined() {
    return this.state === _3.joined;
  }
  isJoining() {
    return this.state === _3.joining;
  }
  isClosed() {
    return this.state === _3.closed;
  }
  isLeaving() {
    return this.state === _3.leaving;
  }
  updateFilterBindings(e) {
    this.channel.filterBindings = e;
  }
  updatePayloadTransform(e) {
    this.channel.onMessage = e;
  }
  getChannel() {
    return this.channel;
  }
};
function he2(n3) {
  return {
    config: Object.assign({
      broadcast: {
        ack: false,
        self: false
      },
      presence: {
        key: "",
        enabled: false
      },
      private: false
    }, n3.config)
  };
}
var ue2 = /[,()"\\]/;
var fe2 = (n3) => ue2.test(n3) || n3 !== n3.trim();
var pe2 = (n3) => `"${n3.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
var Z2 = (n3) => {
  let e = n3 === null ? "null" : String(n3);
  return fe2(e) ? pe2(e) : e;
};
var ge2 = (n3) => n3 === null ? "null" : String(n3);
var me2 = (n3, e) => {
  if (n3 === "in") {
    let t2 = Array.isArray(e) ? e : [
      e
    ];
    if (t2.length === 0) throw new Error("Realtime `in` filter requires at least one value.");
    return `in.(${Array.from(new Set(t2)).map((s) => Z2(s)).join(",")})`;
  }
  return n3 === "is" ? `is.${ge2(e)}` : `${n3}.${Z2(e)}`;
};
var y3 = class {
  constructor() {
    this.filters = [];
  }
  add(e, t2, r, s = false) {
    let i4 = s ? "not." : "";
    return this.filters.push(`${e}=${i4}${me2(t2, r)}`), this;
  }
  eq(e, t2) {
    return this.add(e, "eq", t2);
  }
  neq(e, t2) {
    return this.add(e, "neq", t2);
  }
  gt(e, t2) {
    return this.add(e, "gt", t2);
  }
  gte(e, t2) {
    return this.add(e, "gte", t2);
  }
  lt(e, t2) {
    return this.add(e, "lt", t2);
  }
  lte(e, t2) {
    return this.add(e, "lte", t2);
  }
  in(e, t2) {
    return this.add(e, "in", t2);
  }
  like(e, t2) {
    return this.add(e, "like", t2);
  }
  ilike(e, t2) {
    return this.add(e, "ilike", t2);
  }
  match(e, t2) {
    return this.add(e, "match", t2);
  }
  imatch(e, t2) {
    return this.add(e, "imatch", t2);
  }
  is(e, t2) {
    return this.add(e, "is", t2);
  }
  isDistinct(e, t2) {
    return this.add(e, "isdistinct", t2);
  }
  not(e, t2, r) {
    return this.add(e, t2, r, true);
  }
  build() {
    return this.filters.join(",");
  }
  toString() {
    return this.build();
  }
};
var Q2 = () => new y3();
var V2;
(function(n3) {
  n3.ALL = "*", n3.INSERT = "INSERT", n3.UPDATE = "UPDATE", n3.DELETE = "DELETE";
})(V2 || (V2 = {}));
var A4;
(function(n3) {
  n3.BROADCAST = "broadcast", n3.PRESENCE = "presence", n3.POSTGRES_CHANGES = "postgres_changes", n3.SYSTEM = "system";
})(A4 || (A4 = {}));
var k2;
(function(n3) {
  n3.SUBSCRIBED = "SUBSCRIBED", n3.TIMED_OUT = "TIMED_OUT", n3.CLOSED = "CLOSED", n3.CHANNEL_ERROR = "CHANNEL_ERROR";
})(k2 || (k2 = {}));
var ve2 = _3;
var S6 = class n2 {
  get state() {
    return this.channelAdapter.state;
  }
  set state(e) {
    this.channelAdapter.state = e;
  }
  get joinedOnce() {
    return this.channelAdapter.joinedOnce;
  }
  get timeout() {
    return this.socket.timeout;
  }
  get joinPush() {
    return this.channelAdapter.joinPush;
  }
  get rejoinTimer() {
    return this.channelAdapter.rejoinTimer;
  }
  constructor(e, t2 = {
    config: {}
  }, r) {
    var s, i4;
    if (this.topic = e, this.params = t2, this.socket = r, this.bindings = {}, this.subTopic = e.replace(/^realtime:/i, ""), this.params.config = Object.assign({
      broadcast: {
        ack: false,
        self: false
      },
      presence: {
        key: "",
        enabled: false
      },
      private: false
    }, t2.config), this.channelAdapter = new R3(this.socket.socketAdapter, e, this.params), this.presence = new w2(this), this._onClose(() => {
      this.socket._remove(this);
    }), this._updateFilterTransform(), this.broadcastEndpointURL = j4(this.socket.socketAdapter.endPointURL()), this.private = this.params.config.private || false, !this.private && (!((i4 = (s = this.params.config) === null || s === void 0 ? void 0 : s.broadcast) === null || i4 === void 0) && i4.replay)) throw new Error(`tried to use replay on public channel '${this.topic}'. It must be a private channel.`);
  }
  subscribe(e, t2 = this.timeout) {
    var r, s, i4;
    if (this.socket.isConnected() || this.socket.connect(), this.channelAdapter.isClosed()) {
      let { config: { broadcast: o4, presence: a, private: c3 } } = this.params, l = (s = (r = this.bindings.postgres_changes) === null || r === void 0 ? void 0 : r.map((h3) => h3.filter)) !== null && s !== void 0 ? s : [], u2 = !!this.bindings[A4.PRESENCE] && this.bindings[A4.PRESENCE].length > 0 || ((i4 = this.params.config.presence) === null || i4 === void 0 ? void 0 : i4.enabled) === true, g3 = {}, f5 = {
        broadcast: o4,
        presence: Object.assign(Object.assign({}, a), {
          enabled: u2
        }),
        postgres_changes: l,
        private: c3
      };
      this.socket.accessTokenValue && (g3.access_token = this.socket.accessTokenValue), this._onError((h3) => {
        e?.(k2.CHANNEL_ERROR, X2(h3));
      }), this._onClose(() => e?.(k2.CLOSED)), this.updateJoinPayload(Object.assign({
        config: f5
      }, g3)), this._updateFilterMessage(), this.channelAdapter.subscribe(t2).receive("ok", async ({ postgres_changes: h3 }) => {
        if (this.socket._isManualToken() || this.socket.setAuth(), h3 === void 0) {
          e?.(k2.SUBSCRIBED);
          return;
        }
        this._updatePostgresBindings(h3, e);
      }).receive("error", (h3) => {
        this.state = _3.errored;
        let d = Object.values(h3).join(", ") || "error";
        e?.(k2.CHANNEL_ERROR, new Error(d, {
          cause: h3
        }));
      }).receive("timeout", () => {
        e?.(k2.TIMED_OUT);
      });
    }
    return this;
  }
  _updatePostgresBindings(e, t2) {
    var r;
    let s = this.bindings.postgres_changes, i4 = (r = s?.length) !== null && r !== void 0 ? r : 0, o4 = [];
    for (let a = 0; a < i4; a++) {
      let c3 = s[a], { filter: { event: l, schema: u2, table: g3, filter: f5 } } = c3, h3 = e && e[a];
      if (h3 && h3.event === l && n2.isFilterValueEqual(h3.schema, u2) && n2.isFilterValueEqual(h3.table, g3) && n2.isFilterValueEqual(h3.filter, f5)) o4.push(Object.assign(Object.assign({}, c3), {
        id: h3.id
      }));
      else {
        this.unsubscribe(), this.state = _3.errored, t2?.(k2.CHANNEL_ERROR, new Error("mismatch between server and client bindings for postgres changes"));
        return;
      }
    }
    this.bindings.postgres_changes = o4, this.state != _3.errored && t2 && t2(k2.SUBSCRIBED);
  }
  presenceState() {
    return this.presence.state;
  }
  async track(e, t2 = {}) {
    return await this.send({
      type: "presence",
      event: "track",
      payload: e
    }, t2);
  }
  async untrack(e = {}) {
    return await this.send({
      type: "presence",
      event: "untrack"
    }, e);
  }
  on(e, t2, r) {
    let s = this.channelAdapter.isJoined() || this.channelAdapter.isJoining(), i4 = e === A4.PRESENCE || e === A4.POSTGRES_CHANGES;
    if (s && i4) throw this.socket.log("channel", `cannot add \`${e}\` callbacks for ${this.topic} after \`subscribe()\`.`), new Error(`cannot add \`${e}\` callbacks for ${this.topic} after \`subscribe()\`.`);
    return this._on(e, t2, r);
  }
  async httpSend(e, t2, r = {}) {
    var s;
    if (t2 == null) return Promise.reject(new Error("Payload is required for httpSend()"));
    let i4 = t2 instanceof ArrayBuffer || ArrayBuffer.isView(t2), o4 = {
      apikey: this.socket.apiKey ? this.socket.apiKey : "",
      "Content-Type": i4 ? "application/octet-stream" : "application/json"
    };
    this.socket.accessTokenValue && (o4.Authorization = `Bearer ${this.socket.accessTokenValue}`);
    let a = new URL(this.broadcastEndpointURL);
    a.pathname += `/${encodeURIComponent(this.subTopic)}/events/${encodeURIComponent(e)}`, this.private && a.searchParams.set("private", "true");
    let c3 = {
      method: "POST",
      headers: o4,
      body: i4 ? t2 : JSON.stringify(t2)
    }, l = await this._fetchWithTimeout(a.toString(), c3, (s = r.timeout) !== null && s !== void 0 ? s : this.timeout);
    if (l.status === 202) return {
      success: true
    };
    if (l.status === 404) return Promise.reject(new Error("httpSend() requires Realtime server v2.97.0 or newer; the endpoint returned 404. Update your Supabase CLI to a recent version, or upgrade the Realtime server in your self-hosted setup. See https://github.com/supabase/supabase-js/blob/master/packages/core/realtime-js/migrations/httpsend-server-version.md"));
    let u2 = l.statusText;
    try {
      let g3 = await l.json();
      u2 = g3.error || g3.message || u2;
    } catch {
    }
    return Promise.reject(new Error(u2));
  }
  async send(e, t2 = {}) {
    var r, s;
    if (!this.channelAdapter.canPush() && e.type === "broadcast") {
      console.warn("Realtime send() is automatically falling back to REST API. This behavior will be deprecated in the future. Please use httpSend() explicitly for REST delivery.");
      let { event: i4, payload: o4 } = e, a = {
        apikey: this.socket.apiKey ? this.socket.apiKey : "",
        "Content-Type": "application/json"
      };
      this.socket.accessTokenValue && (a.Authorization = `Bearer ${this.socket.accessTokenValue}`);
      let c3 = {
        method: "POST",
        headers: a,
        body: JSON.stringify({
          messages: [
            {
              topic: this.subTopic,
              event: i4,
              payload: o4,
              private: this.private
            }
          ]
        })
      };
      try {
        let l = await this._fetchWithTimeout(this.broadcastEndpointURL, c3, (r = t2.timeout) !== null && r !== void 0 ? r : this.timeout);
        return await ((s = l.body) === null || s === void 0 ? void 0 : s.cancel()), l.ok ? "ok" : "error";
      } catch (l) {
        return l instanceof Error && l.name === "AbortError" ? "timed out" : "error";
      }
    } else return new Promise((i4) => {
      var o4, a, c3;
      let l = this.channelAdapter.push(e.type, e, t2.timeout || this.timeout);
      e.type === "broadcast" && !(!((c3 = (a = (o4 = this.params) === null || o4 === void 0 ? void 0 : o4.config) === null || a === void 0 ? void 0 : a.broadcast) === null || c3 === void 0) && c3.ack) && i4("ok"), l.receive("ok", () => i4("ok")), l.receive("error", () => i4("error")), l.receive("timeout", () => i4("timed out"));
    });
  }
  updateJoinPayload(e) {
    this.channelAdapter.updateJoinPayload(e);
  }
  async unsubscribe(e = this.timeout) {
    return new Promise((t2) => {
      this.channelAdapter.unsubscribe(e).receive("ok", () => t2("ok")).receive("timeout", () => t2("timed out")).receive("error", () => t2("error"));
    });
  }
  teardown() {
    this.channelAdapter.teardown();
  }
  async _fetchWithTimeout(e, t2, r) {
    let s = new AbortController(), i4 = setTimeout(() => s.abort(), r), o4 = await this.socket.fetch(e, Object.assign(Object.assign({}, t2), {
      signal: s.signal
    }));
    return clearTimeout(i4), o4;
  }
  _on(e, t2, r) {
    var s;
    let i4 = e.toLocaleLowerCase(), o4 = t2?.filter;
    if ((o4 instanceof y3 || typeof o4 == "object" && o4 !== null && typeof o4.build == "function") && (t2 = Object.assign(Object.assign({}, t2), {
      filter: o4.build()
    })), i4 === A4.POSTGRES_CHANGES && ((s = this.bindings[i4]) === null || s === void 0 ? void 0 : s.find((u2) => n2.isSamePostgresFilter(u2.filter, t2)))) return this.socket.log("error", `duplicate \`postgres_changes\` binding for ${this.topic} ignored`, t2), this;
    let a = this.channelAdapter.on(e, r), c3 = {
      type: i4,
      filter: t2,
      callback: r,
      ref: a
    };
    return this.bindings[i4] ? this.bindings[i4].push(c3) : this.bindings[i4] = [
      c3
    ], this._updateFilterMessage(), this;
  }
  _onClose(e) {
    this.channelAdapter.onClose(e);
  }
  _onError(e) {
    this.channelAdapter.onError(e);
  }
  _updateFilterMessage() {
    this.channelAdapter.updateFilterBindings((e, t2, r) => {
      var s, i4, o4, a, c3, l, u2;
      let g3 = e.event.toLocaleLowerCase();
      if (this._notThisChannelEvent(g3, r)) return false;
      let f5 = (s = this.bindings[g3]) === null || s === void 0 ? void 0 : s.find((h3) => h3.ref === e.ref);
      if (!f5) return true;
      if ([
        "broadcast",
        "presence",
        "postgres_changes"
      ].includes(g3)) if ("id" in f5) {
        let h3 = f5.id, d = (i4 = f5.filter) === null || i4 === void 0 ? void 0 : i4.event;
        return h3 && ((o4 = t2.ids) === null || o4 === void 0 ? void 0 : o4.includes(h3)) && (d === "*" || d?.toLocaleLowerCase() === ((a = t2.data) === null || a === void 0 ? void 0 : a.type.toLocaleLowerCase()));
      } else {
        let h3 = (l = (c3 = f5?.filter) === null || c3 === void 0 ? void 0 : c3.event) === null || l === void 0 ? void 0 : l.toLocaleLowerCase();
        return h3 === "*" || h3 === ((u2 = t2?.event) === null || u2 === void 0 ? void 0 : u2.toLocaleLowerCase());
      }
      else return f5.type.toLocaleLowerCase() === g3;
    });
  }
  _notThisChannelEvent(e, t2) {
    let { close: r, error: s, leave: i4, join: o4 } = P4;
    return t2 && [
      r,
      s,
      i4,
      o4
    ].includes(e) && t2 !== this.joinPush.ref;
  }
  _updateFilterTransform() {
    this.channelAdapter.updatePayloadTransform((e, t2, r) => {
      if (typeof t2 == "object" && "ids" in t2) {
        let s = t2.data, { schema: i4, table: o4, commit_timestamp: a, type: c3, errors: l } = s;
        return Object.assign(Object.assign({}, {
          schema: i4,
          table: o4,
          commit_timestamp: a,
          eventType: c3,
          new: {},
          old: {},
          errors: l
        }), this._getPayloadRecords(s));
      }
      return t2;
    });
  }
  copyBindings(e) {
    if (this.joinedOnce) throw new Error("cannot copy bindings into joined channel");
    for (let t2 in e.bindings) for (let r of e.bindings[t2]) this._on(r.type, r.filter, r.callback);
  }
  static isFilterValueEqual(e, t2) {
    return (e ?? void 0) === (t2 ?? void 0);
  }
  static isSamePostgresFilter(e, t2) {
    var r, s, i4, o4;
    let a = (s = (r = e?.select) === null || r === void 0 ? void 0 : r.join()) !== null && s !== void 0 ? s : void 0, c3 = (o4 = (i4 = t2?.select) === null || i4 === void 0 ? void 0 : i4.join()) !== null && o4 !== void 0 ? o4 : void 0;
    return e?.event === t2?.event && n2.isFilterValueEqual(e?.schema, t2?.schema) && n2.isFilterValueEqual(e?.table, t2?.table) && n2.isFilterValueEqual(e?.filter, t2?.filter) && a === c3;
  }
  _getPayloadRecords(e) {
    let t2 = {
      new: {},
      old: {}
    };
    return (e.type === "INSERT" || e.type === "UPDATE") && (t2.new = M2(e.columns, e.record)), (e.type === "UPDATE" || e.type === "DELETE") && (t2.old = M2(e.columns, e.old_record)), t2;
  }
};
var O4 = class {
  constructor(e, t2) {
    this.socket = new U2(e, t2);
  }
  get timeout() {
    return this.socket.timeout;
  }
  get endPoint() {
    return this.socket.endPoint;
  }
  get transport() {
    return this.socket.transport;
  }
  get heartbeatIntervalMs() {
    return this.socket.heartbeatIntervalMs;
  }
  get heartbeatCallback() {
    return this.socket.heartbeatCallback;
  }
  set heartbeatCallback(e) {
    this.socket.heartbeatCallback = e;
  }
  get heartbeatTimer() {
    return this.socket.heartbeatTimer;
  }
  get pendingHeartbeatRef() {
    return this.socket.pendingHeartbeatRef;
  }
  get reconnectTimer() {
    return this.socket.reconnectTimer;
  }
  get vsn() {
    return this.socket.vsn;
  }
  get encode() {
    return this.socket.encode;
  }
  get decode() {
    return this.socket.decode;
  }
  get reconnectAfterMs() {
    return this.socket.reconnectAfterMs;
  }
  get sendBuffer() {
    return this.socket.sendBuffer;
  }
  get stateChangeCallbacks() {
    return this.socket.stateChangeCallbacks;
  }
  connect() {
    this.socket.connect();
  }
  disconnect(e, t2, r, s = 1e4) {
    return new Promise((i4) => {
      setTimeout(() => i4("timeout"), s), this.socket.disconnect(() => {
        e(), i4("ok");
      }, t2, r);
    });
  }
  push(e) {
    this.socket.push(e);
  }
  log(e, t2, r) {
    this.socket.log(e, t2, r);
  }
  makeRef() {
    return this.socket.makeRef();
  }
  onOpen(e) {
    this.socket.onOpen(e);
  }
  onClose(e) {
    this.socket.onClose(e);
  }
  onError(e) {
    this.socket.onError(e);
  }
  onMessage(e) {
    this.socket.onMessage(e);
  }
  isConnected() {
    return this.socket.isConnected();
  }
  isConnecting() {
    return this.socket.connectionState() == T3.connecting;
  }
  isDisconnecting() {
    return this.socket.connectionState() == T3.closing;
  }
  connectionState() {
    return this.socket.connectionState();
  }
  endPointURL() {
    return this.socket.endPointURL();
  }
  sendHeartbeat() {
    this.socket.sendHeartbeat();
  }
  getSocket() {
    return this.socket;
  }
};
var ee2 = {
  HEARTBEAT_INTERVAL: 25e3,
  RECONNECT_DELAY: 10,
  HEARTBEAT_TIMEOUT_FALLBACK: 100
};
var ke2 = [
  1e3,
  2e3,
  5e3,
  1e4
];
var be2 = 1e4;
function Ee2() {
  let n3 = /* @__PURE__ */ new Map();
  return {
    get length() {
      return n3.size;
    },
    clear() {
      n3.clear();
    },
    getItem(e) {
      return n3.has(e) ? n3.get(e) : null;
    },
    key(e) {
      var t2;
      return (t2 = Array.from(n3.keys())[e]) !== null && t2 !== void 0 ? t2 : null;
    },
    removeItem(e) {
      n3.delete(e);
    },
    setItem(e, t2) {
      n3.set(e, String(t2));
    }
  };
}
function Ae2() {
  try {
    if (typeof globalThis < "u" && globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch {
  }
  return Ee2();
}
var ye2 = `
  addEventListener("message", (e) => {
    if (e.data.event === "start") {
      setInterval(() => postMessage({ event: "keepAlive" }), e.data.interval);
    }
  });`;
var U3 = class {
  get endPoint() {
    return this.socketAdapter.endPoint;
  }
  get timeout() {
    return this.socketAdapter.timeout;
  }
  get transport() {
    return this.socketAdapter.transport;
  }
  get heartbeatCallback() {
    return this.socketAdapter.heartbeatCallback;
  }
  get heartbeatIntervalMs() {
    return this.socketAdapter.heartbeatIntervalMs;
  }
  get heartbeatTimer() {
    return this.worker ? this._workerHeartbeatTimer : this.socketAdapter.heartbeatTimer;
  }
  get pendingHeartbeatRef() {
    return this.worker ? this._pendingWorkerHeartbeatRef : this.socketAdapter.pendingHeartbeatRef;
  }
  get reconnectTimer() {
    return this.socketAdapter.reconnectTimer;
  }
  get vsn() {
    return this.socketAdapter.vsn;
  }
  get encode() {
    return this.socketAdapter.encode;
  }
  get decode() {
    return this.socketAdapter.decode;
  }
  get reconnectAfterMs() {
    return this.socketAdapter.reconnectAfterMs;
  }
  get sendBuffer() {
    return this.socketAdapter.sendBuffer;
  }
  get stateChangeCallbacks() {
    return this.socketAdapter.stateChangeCallbacks;
  }
  constructor(e, t2) {
    var r;
    if (this.channels = new Array(), this.accessTokenValue = null, this.accessToken = null, this.apiKey = null, this.httpEndpoint = "", this.headers = {}, this.params = {}, this.ref = 0, this.serializer = new C4(), this._manuallySetToken = false, this._authPromise = null, this._authGeneration = 0, this._workerHeartbeatTimer = void 0, this._pendingWorkerHeartbeatRef = null, this._pendingDisconnectTimer = null, this._disconnectOnEmptyChannelsAfterMs = 0, this._resolveFetch = (i4) => i4 ? (...o4) => i4(...o4) : (...o4) => fetch(...o4), !(!((r = t2?.params) === null || r === void 0) && r.apikey)) throw new Error("API key is required to connect to Realtime");
    this.apiKey = t2.params.apikey;
    let s = this._initializeOptions(t2);
    this.socketAdapter = new O4(e, s), this.httpEndpoint = j4(e), this.fetch = this._resolveFetch(t2?.fetch);
  }
  connect() {
    if (!(this.isConnecting() || this.isDisconnecting() || this.isConnected())) {
      this.accessToken && !this._authPromise && this._setAuthSafely("connect"), this._setupConnectionHandlers();
      try {
        this.socketAdapter.connect();
      } catch (e) {
        let t2 = e.message;
        throw new Error(`WebSocket not available: ${t2}`);
      }
      this._handleNodeJsRaceCondition();
    }
  }
  endpointURL() {
    return this.socketAdapter.endPointURL();
  }
  async disconnect(e, t2) {
    return this._cancelPendingDisconnect(), this.isDisconnecting() ? "ok" : await this.socketAdapter.disconnect(() => {
      clearInterval(this._workerHeartbeatTimer), this._terminateWorker();
    }, e, t2);
  }
  getChannels() {
    return this.channels;
  }
  async removeChannel(e) {
    let t2 = await e.unsubscribe();
    return t2 === "ok" && e.teardown(), t2;
  }
  async removeAllChannels() {
    let e = this.channels.map(async (r) => {
      let s = await r.unsubscribe();
      return r.teardown(), s;
    }), t2 = await Promise.all(e);
    return await this.disconnect(), t2;
  }
  log(e, t2, r) {
    this.socketAdapter.log(e, t2, r);
  }
  connectionState() {
    return this.socketAdapter.connectionState() || T3.closed;
  }
  isConnected() {
    return this.socketAdapter.isConnected();
  }
  isConnecting() {
    return this.socketAdapter.isConnecting();
  }
  isDisconnecting() {
    return this.socketAdapter.isDisconnecting();
  }
  channel(e, t2 = {
    config: {}
  }) {
    let r = `realtime:${e}`, s = this.getChannels().find((i4) => i4.topic === r);
    if (s) return s;
    {
      let i4 = new S6(`realtime:${e}`, t2, this);
      return this._cancelPendingDisconnect(), this.channels.push(i4), i4;
    }
  }
  push(e) {
    this.socketAdapter.push(e);
  }
  async setAuth(e = null) {
    let t2 = ++this._authGeneration, r = this._performAuth(e, t2);
    t2 === this._authGeneration && (this._authPromise = r);
    try {
      await r;
    } finally {
      this._authPromise === r && (this._authPromise = null);
    }
  }
  _isManualToken() {
    return this._manuallySetToken;
  }
  async sendHeartbeat() {
    this.socketAdapter.sendHeartbeat();
  }
  onHeartbeat(e) {
    this.socketAdapter.heartbeatCallback = this._wrapHeartbeatCallback(e);
  }
  _makeRef() {
    return this.socketAdapter.makeRef();
  }
  _remove(e) {
    this.channels = this.channels.filter((t2) => t2.topic !== e.topic), this.channels.length === 0 && (this.log("transport", "no channels remaining, scheduling disconnect"), this._schedulePendingDisconnect());
  }
  _schedulePendingDisconnect() {
    if (this._cancelPendingDisconnect(), this._disconnectOnEmptyChannelsAfterMs === 0) {
      this.log("transport", "disconnecting immediately - no channels"), this.disconnect();
      return;
    }
    this._pendingDisconnectTimer = setTimeout(() => {
      this._pendingDisconnectTimer = null, this.channels.length === 0 && (this.log("transport", "deferred disconnect fired - no channels, disconnecting"), this.disconnect());
    }, this._disconnectOnEmptyChannelsAfterMs), this.log("transport", `deferred disconnect scheduled in ${this._disconnectOnEmptyChannelsAfterMs}ms`);
  }
  _cancelPendingDisconnect() {
    this._pendingDisconnectTimer !== null && (this.log("transport", "pending disconnect cancelled - channel activity detected"), clearTimeout(this._pendingDisconnectTimer), this._pendingDisconnectTimer = null);
  }
  async _performAuth(e, t2) {
    let r, s = false;
    if (e) r = e, s = true;
    else if (this.accessToken) try {
      r = await this.accessToken();
    } catch (i4) {
      this.log("error", "Error fetching access token from callback", i4), r = this.accessTokenValue;
    }
    else r = this.accessTokenValue;
    t2 === this._authGeneration && (this.accessToken ? this._manuallySetToken = false : s && (this._manuallySetToken = true), this.accessTokenValue != r && (this.accessTokenValue = r, this.channels.forEach((i4) => {
      let o4 = {
        access_token: r,
        version: F3
      };
      i4.updateJoinPayload(o4), i4.joinedOnce && i4.channelAdapter.isJoined() && i4.channelAdapter.push(P4.access_token, {
        access_token: r
      });
    })));
  }
  async _waitForAuthIfNeeded() {
    this._authPromise && await this._authPromise;
  }
  _setAuthSafely(e = "general") {
    this._isManualToken() || this.setAuth().catch((t2) => {
      this.log("error", `Error setting auth in ${e}`, t2);
    });
  }
  _setupConnectionHandlers() {
    this.socketAdapter.onOpen(() => {
      (this._authPromise || (this.accessToken && !this.accessTokenValue ? this.setAuth() : Promise.resolve())).catch((t2) => {
        this.log("error", "error waiting for auth on connect", t2);
      }), this.worker && !this.workerRef && this._startWorkerHeartbeat();
    }), this.socketAdapter.onClose(() => {
      this.worker && this.workerRef && this._terminateWorker();
    }), this.socketAdapter.onMessage((e) => {
      e.ref && e.ref === this._pendingWorkerHeartbeatRef && (this._pendingWorkerHeartbeatRef = null);
    });
  }
  _handleNodeJsRaceCondition() {
    this.socketAdapter.isConnected() && this.socketAdapter.getSocket().onConnOpen();
  }
  _wrapHeartbeatCallback(e) {
    return (t2, r) => {
      t2 !== "disconnected" && (t2 == "sent" && this._setAuthSafely(), e && e(t2, r));
    };
  }
  _startWorkerHeartbeat() {
    this.workerUrl ? this.log("worker", `starting worker for from ${this.workerUrl}`) : this.log("worker", "starting default worker");
    let e = this._workerObjectUrl(this.workerUrl);
    this.workerRef = new Worker(e), this.workerRef.onerror = (t2) => {
      this.log("worker", "worker error", t2.message), this._terminateWorker(), this.disconnect();
    }, this.workerRef.onmessage = (t2) => {
      t2.data.event === "keepAlive" && this.sendHeartbeat();
    }, this.workerRef.postMessage({
      event: "start",
      interval: this.heartbeatIntervalMs
    });
  }
  _terminateWorker() {
    this.workerRef && (this.log("worker", "terminating worker"), this.workerRef.terminate(), this.workerRef = void 0);
  }
  _workerObjectUrl(e) {
    let t2;
    if (e) t2 = e;
    else {
      let r = new Blob([
        ye2
      ], {
        type: "application/javascript"
      });
      t2 = URL.createObjectURL(r);
    }
    return t2;
  }
  _initializeOptions(e) {
    var t2, r, s, i4, o4, a, c3, l, u2, g3, f5, h3;
    this.worker = (t2 = e?.worker) !== null && t2 !== void 0 ? t2 : false, this.accessToken = (r = e?.accessToken) !== null && r !== void 0 ? r : null;
    let d = {};
    d.timeout = (s = e?.timeout) !== null && s !== void 0 ? s : G2, d.heartbeatIntervalMs = (i4 = e?.heartbeatIntervalMs) !== null && i4 !== void 0 ? i4 : ee2.HEARTBEAT_INTERVAL, this._disconnectOnEmptyChannelsAfterMs = (o4 = e?.disconnectOnEmptyChannelsAfterMs) !== null && o4 !== void 0 ? o4 : 2 * ((a = e?.heartbeatIntervalMs) !== null && a !== void 0 ? a : ee2.HEARTBEAT_INTERVAL), d.transport = (c3 = e?.transport) !== null && c3 !== void 0 ? c3 : D4.getWebSocketConstructor(), d.params = e?.params, d.logger = e?.logger, d.heartbeatCallback = this._wrapHeartbeatCallback(e?.heartbeatCallback), d.sessionStorage = (l = e?.sessionStorage) !== null && l !== void 0 ? l : Ae2(), d.reconnectAfterMs = (u2 = e?.reconnectAfterMs) !== null && u2 !== void 0 ? u2 : (E7) => ke2[E7 - 1] || be2;
    let v2, b3, m4 = (g3 = e?.vsn) !== null && g3 !== void 0 ? g3 : z2;
    switch (m4) {
      case J2:
        v2 = (E7, x6) => x6(JSON.stringify(E7)), b3 = (E7, x6) => x6(JSON.parse(E7));
        break;
      case I2:
        v2 = this.serializer.encode.bind(this.serializer), b3 = this.serializer.decode.bind(this.serializer);
        break;
      default:
        throw new Error(`Unsupported serializer version: ${d.vsn}`);
    }
    if (d.vsn = m4, d.encode = (f5 = e?.encode) !== null && f5 !== void 0 ? f5 : v2, d.decode = (h3 = e?.decode) !== null && h3 !== void 0 ? h3 : b3, d.beforeReconnect = this._reconnectAuth.bind(this), (e?.logLevel || e?.log_level) && (this.logLevel = e.logLevel || e.log_level, d.params = Object.assign(Object.assign({}, d.params), {
      log_level: this.logLevel
    })), this.worker) {
      if (typeof globalThis < "u" && !globalThis.Worker) throw new Error("Web Worker is not supported");
      this.workerUrl = e?.workerUrl, d.autoSendHeartbeat = !this.worker;
    }
    return d;
  }
  async _reconnectAuth() {
    await this._waitForAuthIfNeeded(), this.isConnected() || this.connect();
  }
};

// deno:https://esm.sh/@supabase/storage-js@2.112.3/denonext/storage-js.mjs
import { Buffer as __Buffer$ } from "node:buffer";

// deno:https://esm.sh/iceberg-js@0.8.1/denonext/iceberg-js.mjs
var o = class extends Error {
  constructor(e, t2) {
    super(e), this.name = "IcebergError", this.status = t2.status, this.icebergType = t2.icebergType, this.icebergCode = t2.icebergCode, this.details = t2.details, this.isCommitStateUnknown = t2.icebergType === "CommitStateUnknownException" || [
      500,
      502,
      504
    ].includes(t2.status) && t2.icebergType?.includes("CommitState") === true;
  }
  isNotFound() {
    return this.status === 404;
  }
  isConflict() {
    return this.status === 409;
  }
  isAuthenticationTimeout() {
    return this.status === 419;
  }
};
function w3(e, t2, a) {
  let s = new URL(t2, e);
  if (a) for (let [c3, r] of Object.entries(a)) r !== void 0 && s.searchParams.set(c3, r);
  return s.toString();
}
async function $5(e) {
  return !e || e.type === "none" ? {} : e.type === "bearer" ? {
    Authorization: `Bearer ${e.token}`
  } : e.type === "header" ? {
    [e.name]: e.value
  } : e.type === "custom" ? await e.getHeaders() : {};
}
function N5(e) {
  let t2 = e.fetchImpl ?? globalThis.fetch;
  return {
    async request({ method: a, path: s, query: c3, body: r, headers: g3 }) {
      let x6 = w3(e.baseUrl, s, c3), E7 = await $5(e.auth), n3 = await t2(x6, {
        method: a,
        headers: {
          ...r ? {
            "Content-Type": "application/json"
          } : {},
          ...E7,
          ...g3
        },
        body: r ? JSON.stringify(r) : void 0
      }), l = await n3.text(), u2 = (n3.headers.get("content-type") || "").includes("application/json"), m4 = u2 && l ? JSON.parse(l) : l;
      if (!n3.ok) {
        let d = u2 ? m4 : void 0, h3 = d?.error;
        throw new o(h3?.message ?? `Request failed with status ${n3.status}`, {
          status: n3.status,
          icebergType: h3?.type,
          icebergCode: h3?.code,
          details: d
        });
      }
      return {
        status: n3.status,
        headers: n3.headers,
        data: m4
      };
    }
  };
}
function p2(e) {
  return e.join("");
}
var O5 = class {
  constructor(e, t2 = "") {
    this.client = e, this.prefix = t2;
  }
  async listNamespaces(e) {
    let t2 = e ? {
      parent: p2(e.namespace)
    } : void 0;
    return (await this.client.request({
      method: "GET",
      path: `${this.prefix}/namespaces`,
      query: t2
    })).data.namespaces.map((s) => ({
      namespace: s
    }));
  }
  async createNamespace(e, t2) {
    let a = {
      namespace: e.namespace,
      properties: t2?.properties
    };
    return (await this.client.request({
      method: "POST",
      path: `${this.prefix}/namespaces`,
      body: a
    })).data;
  }
  async dropNamespace(e) {
    await this.client.request({
      method: "DELETE",
      path: `${this.prefix}/namespaces/${p2(e.namespace)}`
    });
  }
  async loadNamespaceMetadata(e) {
    return {
      properties: (await this.client.request({
        method: "GET",
        path: `${this.prefix}/namespaces/${p2(e.namespace)}`
      })).data.properties
    };
  }
  async namespaceExists(e) {
    try {
      return await this.client.request({
        method: "HEAD",
        path: `${this.prefix}/namespaces/${p2(e.namespace)}`
      }), true;
    } catch (t2) {
      if (t2 instanceof o && t2.status === 404) return false;
      throw t2;
    }
  }
  async createNamespaceIfNotExists(e, t2) {
    try {
      return await this.createNamespace(e, t2);
    } catch (a) {
      if (a instanceof o && a.status === 409) return;
      throw a;
    }
  }
};
function i3(e) {
  return e.join("");
}
var D5 = class {
  constructor(e, t2 = "", a) {
    this.client = e, this.prefix = t2, this.accessDelegation = a;
  }
  async listTables(e) {
    return (await this.client.request({
      method: "GET",
      path: `${this.prefix}/namespaces/${i3(e.namespace)}/tables`
    })).data.identifiers;
  }
  async createTable(e, t2) {
    let a = {};
    return this.accessDelegation && (a["X-Iceberg-Access-Delegation"] = this.accessDelegation), (await this.client.request({
      method: "POST",
      path: `${this.prefix}/namespaces/${i3(e.namespace)}/tables`,
      body: t2,
      headers: a
    })).data.metadata;
  }
  async updateTable(e, t2) {
    let a = await this.client.request({
      method: "POST",
      path: `${this.prefix}/namespaces/${i3(e.namespace)}/tables/${e.name}`,
      body: t2
    });
    return {
      "metadata-location": a.data["metadata-location"],
      metadata: a.data.metadata
    };
  }
  async dropTable(e, t2) {
    await this.client.request({
      method: "DELETE",
      path: `${this.prefix}/namespaces/${i3(e.namespace)}/tables/${e.name}`,
      query: {
        purgeRequested: String(t2?.purge ?? false)
      }
    });
  }
  async loadTable(e) {
    let t2 = {};
    return this.accessDelegation && (t2["X-Iceberg-Access-Delegation"] = this.accessDelegation), (await this.client.request({
      method: "GET",
      path: `${this.prefix}/namespaces/${i3(e.namespace)}/tables/${e.name}`,
      headers: t2
    })).data.metadata;
  }
  async tableExists(e) {
    let t2 = {};
    this.accessDelegation && (t2["X-Iceberg-Access-Delegation"] = this.accessDelegation);
    try {
      return await this.client.request({
        method: "HEAD",
        path: `${this.prefix}/namespaces/${i3(e.namespace)}/tables/${e.name}`,
        headers: t2
      }), true;
    } catch (a) {
      if (a instanceof o && a.status === 404) return false;
      throw a;
    }
  }
  async createTableIfNotExists(e, t2) {
    try {
      return await this.createTable(e, t2);
    } catch (a) {
      if (a instanceof o && a.status === 409) return await this.loadTable({
        namespace: e.namespace,
        name: t2.name
      });
      throw a;
    }
  }
};
var I3 = class {
  constructor(e) {
    let t2 = "v1";
    e.catalogName && (t2 += `/${e.catalogName}`);
    let a = e.baseUrl.endsWith("/") ? e.baseUrl : `${e.baseUrl}/`;
    this.client = N5({
      baseUrl: a,
      auth: e.auth,
      fetchImpl: e.fetch
    }), this.accessDelegation = e.accessDelegation?.join(","), this.namespaceOps = new O5(this.client, t2), this.tableOps = new D5(this.client, t2, this.accessDelegation);
  }
  async listNamespaces(e) {
    return this.namespaceOps.listNamespaces(e);
  }
  async createNamespace(e, t2) {
    return this.namespaceOps.createNamespace(e, t2);
  }
  async dropNamespace(e) {
    await this.namespaceOps.dropNamespace(e);
  }
  async loadNamespaceMetadata(e) {
    return this.namespaceOps.loadNamespaceMetadata(e);
  }
  async listTables(e) {
    return this.tableOps.listTables(e);
  }
  async createTable(e, t2) {
    return this.tableOps.createTable(e, t2);
  }
  async updateTable(e, t2) {
    return this.tableOps.updateTable(e, t2);
  }
  async dropTable(e, t2) {
    await this.tableOps.dropTable(e, t2);
  }
  async loadTable(e) {
    return this.tableOps.loadTable(e);
  }
  async namespaceExists(e) {
    return this.namespaceOps.namespaceExists(e);
  }
  async tableExists(e) {
    return this.tableOps.tableExists(e);
  }
  async createNamespaceIfNotExists(e, t2) {
    return this.namespaceOps.createNamespaceIfNotExists(e, t2);
  }
  async createTableIfNotExists(e, t2) {
    return this.tableOps.createTableIfNotExists(e, t2);
  }
};

// deno:https://esm.sh/@supabase/storage-js@2.112.3/denonext/storage-js.mjs
function g2(t2) {
  "@babel/helpers - typeof";
  return g2 = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
    return typeof e;
  } : function(e) {
    return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
  }, g2(t2);
}
function R4(t2, e) {
  if (g2(t2) != "object" || !t2) return t2;
  var r = t2[Symbol.toPrimitive];
  if (r !== void 0) {
    var a = r.call(t2, e || "default");
    if (g2(a) != "object") return a;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (e === "string" ? String : Number)(t2);
}
function D6(t2) {
  var e = R4(t2, "string");
  return g2(e) == "symbol" ? e : e + "";
}
function A5(t2, e, r) {
  return (e = D6(e)) in t2 ? Object.defineProperty(t2, e, {
    value: r,
    enumerable: true,
    configurable: true,
    writable: true
  }) : t2[e] = r, t2;
}
function T4(t2, e) {
  var r = Object.keys(t2);
  if (Object.getOwnPropertySymbols) {
    var a = Object.getOwnPropertySymbols(t2);
    e && (a = a.filter(function(n3) {
      return Object.getOwnPropertyDescriptor(t2, n3).enumerable;
    })), r.push.apply(r, a);
  }
  return r;
}
function c2(t2) {
  for (var e = 1; e < arguments.length; e++) {
    var r = arguments[e] != null ? arguments[e] : {};
    e % 2 ? T4(Object(r), true).forEach(function(a) {
      A5(t2, a, r[a]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(t2, Object.getOwnPropertyDescriptors(r)) : T4(Object(r)).forEach(function(a) {
      Object.defineProperty(t2, a, Object.getOwnPropertyDescriptor(r, a));
    });
  }
  return t2;
}
var b2 = class extends Error {
  constructor(t2, e = "storage", r, a) {
    super(t2), this.__isStorageError = true, this.namespace = e, this.name = e === "vectors" ? "StorageVectorsError" : "StorageError", this.status = r, this.statusCode = a;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusCode: this.statusCode
    };
  }
};
function _4(t2) {
  return typeof t2 == "object" && t2 !== null && "__isStorageError" in t2;
}
var O6 = class extends b2 {
  constructor(t2, e, r, a = "storage", n3) {
    super(t2, a, e, r), this.name = a === "vectors" ? "StorageVectorsApiError" : "StorageApiError", this.status = e, this.statusCode = r, this.code = n3;
  }
  toJSON() {
    return c2(c2({}, super.toJSON()), {}, {
      code: this.code
    });
  }
};
var j5 = class extends b2 {
  constructor(t2, e, r = "storage") {
    super(t2, r), this.name = r === "vectors" ? "StorageVectorsUnknownError" : "StorageUnknownError", this.originalError = e;
  }
};
var fe3 = function(t2) {
  return t2.InternalError = "InternalError", t2.S3VectorConflictException = "S3VectorConflictException", t2.S3VectorNotFoundException = "S3VectorNotFoundException", t2.S3VectorBucketNotEmpty = "S3VectorBucketNotEmpty", t2.S3VectorMaxBucketsExceeded = "S3VectorMaxBucketsExceeded", t2.S3VectorMaxIndexesExceeded = "S3VectorMaxIndexesExceeded", t2;
}({});
function k3(t2, e, r) {
  let a = c2({}, t2), n3 = e.toLowerCase();
  for (let s of Object.keys(a)) s.toLowerCase() === n3 && delete a[s];
  return a[n3] = r, a;
}
function q4(t2) {
  let e = {};
  for (let [r, a] of Object.entries(t2)) e[r.toLowerCase()] = a;
  return e;
}
var H5 = (t2) => t2 ? (...e) => t2(...e) : (...e) => fetch(...e);
var M3 = (t2) => {
  if (typeof t2 != "object" || t2 === null) return false;
  let e = Object.getPrototypeOf(t2);
  return (e === null || e === Object.prototype || Object.getPrototypeOf(e) === null) && !(Symbol.toStringTag in t2) && !(Symbol.iterator in t2);
};
var P5 = (t2) => {
  if (Array.isArray(t2)) return t2.map((r) => P5(r));
  if (typeof t2 == "function" || t2 !== Object(t2)) return t2;
  let e = {};
  return Object.entries(t2).forEach(([r, a]) => {
    let n3 = r.replace(/([-_][a-z])/gi, (s) => s.toUpperCase().replace(/[-_]/g, ""));
    e[n3] = P5(a);
  }), e;
};
var z3 = (t2) => !t2 || typeof t2 != "string" || t2.length === 0 || t2.length > 100 || t2.trim() !== t2 || t2.includes("/") || t2.includes("\\") ? false : /^[\w!.\*'() &$@=;:+,?-]+$/.test(t2);
var N6 = (t2) => t2.split("/").map(encodeURIComponent).join("/");
var I4 = (t2) => {
  if (typeof t2 == "object" && t2 !== null) {
    let e = t2;
    if (typeof e.msg == "string") return e.msg;
    if (typeof e.message == "string") return e.message;
    if (typeof e.error_description == "string") return e.error_description;
    if (typeof e.error == "string") return e.error;
    if (typeof e.error == "object" && e.error !== null) {
      let r = e.error;
      if (typeof r.message == "string") return r.message;
    }
  }
  return JSON.stringify(t2);
};
var K3 = async (t2, e, r, a) => {
  if (t2 !== null && typeof t2 == "object" && "json" in t2 && typeof t2.json == "function") {
    let n3 = t2, s = parseInt(String(n3.status), 10);
    Number.isFinite(s) || (s = 500), n3.json().then((o4) => {
      let u2 = o4?.statusCode || o4?.code || s + "";
      e(new O6(I4(o4), s, u2, a, o4?.code));
    }).catch(() => {
      let o4 = s + "";
      e(new O6(n3.statusText || `HTTP ${s} error`, s, o4, a));
    });
  } else e(new j5(I4(t2), t2, a));
};
var J3 = (t2, e, r, a) => {
  let n3 = {
    method: t2,
    headers: e?.headers || {}
  };
  if (t2 === "GET" || t2 === "HEAD" || !a) return c2(c2({}, n3), r);
  if (M3(a)) {
    var s;
    let o4 = e?.headers || {}, u2;
    for (let [i4, l] of Object.entries(o4)) i4.toLowerCase() === "content-type" && (u2 = l);
    n3.headers = k3(o4, "Content-Type", (s = u2) !== null && s !== void 0 ? s : "application/json"), n3.body = JSON.stringify(a);
  } else n3.body = a;
  return e?.duplex && (n3.duplex = e.duplex), c2(c2({}, n3), r);
};
async function v(t2, e, r, a, n3, s, o4) {
  return new Promise((u2, i4) => {
    t2(r, J3(e, a, n3, s)).then((l) => {
      if (!l.ok) throw l;
      if (a?.noResolveJson) return l;
      if (o4 === "vectors") {
        let d = l.headers.get("content-type");
        if (l.headers.get("content-length") === "0" || l.status === 204) return {};
        if (!d || !d.includes("application/json")) return {};
      }
      return l.json();
    }).then((l) => u2(l)).catch((l) => K3(l, i4, a, o4));
  });
}
function U4(t2 = "storage") {
  return {
    get: async (e, r, a, n3) => v(e, "GET", r, a, n3, void 0, t2),
    post: async (e, r, a, n3, s) => v(e, "POST", r, n3, s, a, t2),
    put: async (e, r, a, n3, s) => v(e, "PUT", r, n3, s, a, t2),
    head: async (e, r, a, n3) => v(e, "HEAD", r, c2(c2({}, a), {}, {
      noResolveJson: true
    }), n3, void 0, t2),
    remove: async (e, r, a, n3, s) => v(e, "DELETE", r, n3, s, a, t2)
  };
}
var G3 = U4("storage");
var { get: m3, post: f4, put: E5, head: Q3, remove: w4 } = G3;
var h2 = U4("vectors");
var p3 = class {
  constructor(t2, e = {}, r, a = "storage") {
    this.shouldThrowOnError = false, this.url = t2, this.headers = q4(e), this.fetch = H5(r), this.namespace = a;
  }
  throwOnError() {
    return this.shouldThrowOnError = true, this;
  }
  setHeader(t2, e) {
    return this.headers = k3(this.headers, t2, e), this;
  }
  async handleOperation(t2) {
    var e = this;
    try {
      return {
        data: await t2(),
        error: null
      };
    } catch (r) {
      if (e.shouldThrowOnError) throw r;
      if (_4(r)) return {
        data: null,
        error: r
      };
      throw r;
    }
  }
};
var V3;
V3 = Symbol.toStringTag;
var W3 = class {
  constructor(t2, e) {
    this.downloadFn = t2, this.shouldThrowOnError = e, this[V3] = "StreamDownloadBuilder", this.promise = null;
  }
  then(t2, e) {
    return this.getPromise().then(t2, e);
  }
  catch(t2) {
    return this.getPromise().catch(t2);
  }
  finally(t2) {
    return this.getPromise().finally(t2);
  }
  getPromise() {
    return this.promise || (this.promise = this.execute()), this.promise;
  }
  async execute() {
    var t2 = this;
    try {
      return {
        data: (await t2.downloadFn()).body,
        error: null
      };
    } catch (e) {
      if (t2.shouldThrowOnError) throw e;
      if (_4(e)) return {
        data: null,
        error: e
      };
      throw e;
    }
  }
};
var F4;
F4 = Symbol.toStringTag;
var X3 = class {
  constructor(t2, e) {
    this.downloadFn = t2, this.shouldThrowOnError = e, this[F4] = "BlobDownloadBuilder", this.promise = null;
  }
  asStream() {
    return new W3(this.downloadFn, this.shouldThrowOnError);
  }
  then(t2, e) {
    return this.getPromise().then(t2, e);
  }
  catch(t2) {
    return this.getPromise().catch(t2);
  }
  finally(t2) {
    return this.getPromise().finally(t2);
  }
  getPromise() {
    return this.promise || (this.promise = this.execute()), this.promise;
  }
  async execute() {
    var t2 = this;
    try {
      return {
        data: await (await t2.downloadFn()).blob(),
        error: null
      };
    } catch (e) {
      if (t2.shouldThrowOnError) throw e;
      if (_4(e)) return {
        data: null,
        error: e
      };
      throw e;
    }
  }
};
var B4 = {
  limit: 100,
  offset: 0,
  sortBy: {
    column: "name",
    order: "asc"
  }
};
var C5 = {
  cacheControl: "3600",
  contentType: "text/plain;charset=UTF-8",
  upsert: false
};
var Y3 = class extends p3 {
  constructor(t2, e = {}, r, a) {
    super(t2, e, a, "storage"), this.bucketId = r;
  }
  async uploadOrUpdate(t2, e, r, a) {
    var n3 = this;
    return n3.handleOperation(async () => {
      let s, o4 = c2(c2({}, C5), a), u2 = c2(c2({}, n3.headers), t2 === "POST" && {
        "x-upsert": String(o4.upsert)
      }), i4 = o4.metadata;
      if (typeof Blob < "u" && r instanceof Blob ? (s = new FormData(), s.append("cacheControl", o4.cacheControl), i4 && s.append("metadata", n3.encodeMetadata(i4)), s.append("", r)) : typeof FormData < "u" && r instanceof FormData ? (s = r, s.has("cacheControl") || s.append("cacheControl", o4.cacheControl), i4 && !s.has("metadata") && s.append("metadata", n3.encodeMetadata(i4))) : (s = r, u2["cache-control"] = `max-age=${o4.cacheControl}`, u2["content-type"] = o4.contentType, i4 && (u2["x-metadata"] = n3.toBase64(n3.encodeMetadata(i4))), (typeof ReadableStream < "u" && s instanceof ReadableStream || s && typeof s == "object" && "pipe" in s && typeof s.pipe == "function") && !o4.duplex && (o4.duplex = "half")), a?.headers) for (let [x6, $7] of Object.entries(a.headers)) u2 = k3(u2, x6, $7);
      let l = n3._removeEmptyFolders(e), d = n3._getFinalPath(l), y5 = await (t2 == "PUT" ? E5 : f4)(n3.fetch, `${n3.url}/object/${d}`, s, c2({
        headers: u2
      }, o4?.duplex ? {
        duplex: o4.duplex
      } : {}));
      return {
        path: l,
        id: y5.Id,
        fullPath: y5.Key
      };
    });
  }
  async upload(t2, e, r) {
    return this.uploadOrUpdate("POST", t2, e, r);
  }
  async uploadToSignedUrl(t2, e, r, a) {
    var n3 = this;
    let s = n3._removeEmptyFolders(t2), o4 = n3._getFinalPath(s), u2 = new URL(n3.url + `/object/upload/sign/${o4}`);
    return u2.searchParams.set("token", e), n3.handleOperation(async () => {
      let i4, l = c2(c2({}, C5), a), d = c2(c2({}, n3.headers), {
        "x-upsert": String(l.upsert)
      }), y5 = l.metadata;
      if (typeof Blob < "u" && r instanceof Blob ? (i4 = new FormData(), i4.append("cacheControl", l.cacheControl), y5 && i4.append("metadata", n3.encodeMetadata(y5)), i4.append("", r)) : typeof FormData < "u" && r instanceof FormData ? (i4 = r, i4.has("cacheControl") || i4.append("cacheControl", l.cacheControl), y5 && !i4.has("metadata") && i4.append("metadata", n3.encodeMetadata(y5))) : (i4 = r, d["cache-control"] = `max-age=${l.cacheControl}`, d["content-type"] = l.contentType, y5 && (d["x-metadata"] = n3.toBase64(n3.encodeMetadata(y5))), (typeof ReadableStream < "u" && i4 instanceof ReadableStream || i4 && typeof i4 == "object" && "pipe" in i4 && typeof i4.pipe == "function") && !l.duplex && (l.duplex = "half")), a?.headers) for (let [x6, $7] of Object.entries(a.headers)) d = k3(d, x6, $7);
      return {
        path: s,
        fullPath: (await E5(n3.fetch, u2.toString(), i4, c2({
          headers: d
        }, l?.duplex ? {
          duplex: l.duplex
        } : {}))).Key
      };
    });
  }
  async createSignedUploadUrl(t2, e) {
    var r = this;
    return r.handleOperation(async () => {
      let a = r._getFinalPath(t2), n3 = c2({}, r.headers);
      e?.upsert && (n3["x-upsert"] = "true");
      let s = await f4(r.fetch, `${r.url}/object/upload/sign/${a}`, {}, {
        headers: n3
      }), o4 = new URL(r.url + s.url), u2 = o4.searchParams.get("token");
      if (!u2) throw new b2("No token returned by API");
      return {
        signedUrl: o4.toString(),
        path: t2,
        token: u2
      };
    });
  }
  async update(t2, e, r) {
    return this.uploadOrUpdate("PUT", t2, e, r);
  }
  async move(t2, e, r) {
    var a = this;
    return a.handleOperation(async () => await f4(a.fetch, `${a.url}/object/move`, {
      bucketId: a.bucketId,
      sourceKey: t2,
      destinationKey: e,
      destinationBucket: r?.destinationBucket
    }, {
      headers: a.headers
    }));
  }
  async copy(t2, e, r) {
    var a = this;
    return a.handleOperation(async () => ({
      path: (await f4(a.fetch, `${a.url}/object/copy`, {
        bucketId: a.bucketId,
        sourceKey: t2,
        destinationKey: e,
        destinationBucket: r?.destinationBucket
      }, {
        headers: a.headers
      })).Key
    }));
  }
  async createSignedUrl(t2, e, r) {
    var a = this;
    return a.handleOperation(async () => {
      let n3 = a._getFinalPath(t2), s = typeof r?.transform == "object" && r.transform !== null && Object.keys(r.transform).length > 0, o4 = await f4(a.fetch, `${a.url}/object/sign/${n3}`, c2({
        expiresIn: e
      }, s ? {
        transform: r.transform
      } : {}), {
        headers: a.headers
      }), u2 = new URLSearchParams();
      r?.download && u2.set("download", r.download === true ? "" : r.download), r?.cacheNonce != null && u2.set("cacheNonce", String(r.cacheNonce));
      let i4 = u2.toString();
      return {
        signedUrl: encodeURI(`${a.url}${o4.signedURL}${i4 ? `&${i4}` : ""}`)
      };
    });
  }
  async createSignedUrls(t2, e, r) {
    var a = this;
    return a.handleOperation(async () => {
      let n3 = await f4(a.fetch, `${a.url}/object/sign/${a.bucketId}`, {
        expiresIn: e,
        paths: t2
      }, {
        headers: a.headers
      }), s = new URLSearchParams();
      r?.download && s.set("download", r.download === true ? "" : r.download), r?.cacheNonce != null && s.set("cacheNonce", String(r.cacheNonce));
      let o4 = s.toString();
      return n3.map((u2) => c2(c2({}, u2), {}, {
        signedUrl: u2.signedURL ? encodeURI(`${a.url}${u2.signedURL}${o4 ? `&${o4}` : ""}`) : null
      }));
    });
  }
  download(t2, e, r) {
    let a = typeof e?.transform == "object" && e.transform !== null && Object.keys(e.transform).length > 0 ? "render/image/authenticated" : "object", n3 = new URLSearchParams();
    e?.transform && this.applyTransformOptsToQuery(n3, e.transform), e?.cacheNonce != null && n3.set("cacheNonce", String(e.cacheNonce));
    let s = n3.toString(), o4 = this._getFinalPath(t2), u2 = () => m3(this.fetch, `${this.url}/${a}/${o4}${s ? `?${s}` : ""}`, {
      headers: this.headers,
      noResolveJson: true
    }, r);
    return new X3(u2, this.shouldThrowOnError);
  }
  async info(t2) {
    var e = this;
    let r = e._getFinalPath(t2);
    return e.handleOperation(async () => P5(await m3(e.fetch, `${e.url}/object/info/${r}`, {
      headers: e.headers
    })));
  }
  async exists(t2) {
    var e = this;
    let r = e._getFinalPath(t2);
    try {
      return await Q3(e.fetch, `${e.url}/object/${r}`, {
        headers: e.headers
      }), {
        data: true,
        error: null
      };
    } catch (n3) {
      if (e.shouldThrowOnError) throw n3;
      if (_4(n3)) {
        var a;
        let s = n3 instanceof O6 ? n3.status : n3 instanceof j5 ? (a = n3.originalError) === null || a === void 0 ? void 0 : a.status : void 0;
        if (s !== void 0 && [
          400,
          404
        ].includes(s)) return {
          data: false,
          error: n3
        };
      }
      throw n3;
    }
  }
  getPublicUrl(t2, e) {
    let r = this._getFinalPath(t2), a = new URLSearchParams();
    e?.download && a.set("download", e.download === true ? "" : e.download), e?.transform && this.applyTransformOptsToQuery(a, e.transform), e?.cacheNonce != null && a.set("cacheNonce", String(e.cacheNonce));
    let n3 = a.toString(), s = typeof e?.transform == "object" && e.transform !== null && Object.keys(e.transform).length > 0 ? "render/image" : "object";
    return {
      data: {
        publicUrl: encodeURI(`${this.url}/${s}/public/${r}`) + (n3 ? `?${n3}` : "")
      }
    };
  }
  async remove(t2) {
    var e = this;
    return e.handleOperation(async () => await w4(e.fetch, `${e.url}/object/${e.bucketId}`, {
      prefixes: t2
    }, {
      headers: e.headers
    }));
  }
  async purgeCache(t2, e, r) {
    var a = this;
    return a.handleOperation(async () => {
      let n3 = N6(a._getFinalPath(t2)), s = new URLSearchParams();
      e?.transformations && s.set("transformations", "true");
      let o4 = s.toString();
      return await w4(a.fetch, `${a.url}/cdn/${n3}${o4 ? `?${o4}` : ""}`, {}, {
        headers: a.headers
      }, r);
    });
  }
  async list(t2, e, r) {
    var a = this;
    return a.handleOperation(async () => {
      let n3 = e?.sortBy ? c2(c2({}, B4.sortBy), e.sortBy) : B4.sortBy, s = c2(c2(c2({}, B4), e), {}, {
        sortBy: n3,
        prefix: t2 || ""
      });
      return await f4(a.fetch, `${a.url}/object/list/${a.bucketId}`, s, {
        headers: a.headers
      }, r);
    });
  }
  async listV2(t2, e) {
    var r = this;
    return r.handleOperation(async () => {
      let a = c2({}, t2);
      return await f4(r.fetch, `${r.url}/object/list-v2/${r.bucketId}`, a, {
        headers: r.headers
      }, e);
    });
  }
  encodeMetadata(t2) {
    return JSON.stringify(t2);
  }
  toBase64(t2) {
    return typeof __Buffer$ < "u" ? __Buffer$.from(t2).toString("base64") : btoa(t2);
  }
  _getFinalPath(t2) {
    return `${this.bucketId}/${t2.replace(/^\/+/, "")}`;
  }
  _removeEmptyFolders(t2) {
    return t2.replace(/^\/|\/$/g, "").replace(/\/+/g, "/");
  }
  applyTransformOptsToQuery(t2, e) {
    return e.width && t2.set("width", e.width.toString()), e.height && t2.set("height", e.height.toString()), e.resize && t2.set("resize", e.resize), e.format && t2.set("format", e.format), e.quality && t2.set("quality", e.quality.toString()), t2;
  }
};
var Z3 = "2.112.3";
var S7 = {
  "X-Client-Info": `storage-js/${Z3}`
};
var ee3 = class extends p3 {
  constructor(t2, e = {}, r, a) {
    let n3 = new URL(t2);
    a?.useNewHostname && /supabase\.(co|in|red)$/.test(n3.hostname) && !n3.hostname.includes("storage.supabase.") && (n3.hostname = n3.hostname.replace("supabase.", "storage.supabase."));
    let s = n3.href.replace(/\/$/, ""), o4 = c2(c2({}, S7), e);
    super(s, o4, r, "storage");
  }
  async listBuckets(t2) {
    var e = this;
    return e.handleOperation(async () => {
      let r = e.listBucketOptionsToQueryString(t2);
      return await m3(e.fetch, `${e.url}/bucket${r}`, {
        headers: e.headers
      });
    });
  }
  async getBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await m3(e.fetch, `${e.url}/bucket/${t2}`, {
      headers: e.headers
    }));
  }
  async createBucket(t2, e = {
    public: false
  }) {
    var r = this;
    return r.handleOperation(async () => await f4(r.fetch, `${r.url}/bucket`, {
      id: t2,
      name: t2,
      type: e.type,
      public: e.public,
      file_size_limit: e.fileSizeLimit,
      allowed_mime_types: e.allowedMimeTypes
    }, {
      headers: r.headers
    }));
  }
  async updateBucket(t2, e) {
    var r = this;
    return r.handleOperation(async () => await E5(r.fetch, `${r.url}/bucket/${t2}`, {
      id: t2,
      name: t2,
      public: e.public,
      file_size_limit: e.fileSizeLimit,
      allowed_mime_types: e.allowedMimeTypes
    }, {
      headers: r.headers
    }));
  }
  async emptyBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await f4(e.fetch, `${e.url}/bucket/${t2}/empty`, {}, {
      headers: e.headers
    }));
  }
  async deleteBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await w4(e.fetch, `${e.url}/bucket/${t2}`, {}, {
      headers: e.headers
    }));
  }
  async purgeBucketCache(t2, e, r) {
    var a = this;
    return a.handleOperation(async () => {
      let n3 = new URLSearchParams();
      e?.transformations && n3.set("transformations", "true");
      let s = n3.toString();
      return await w4(a.fetch, `${a.url}/cdn/${N6(t2)}${s ? `?${s}` : ""}`, {}, {
        headers: a.headers
      }, r);
    });
  }
  listBucketOptionsToQueryString(t2) {
    let e = {};
    return t2 && ("limit" in t2 && (e.limit = String(t2.limit)), "offset" in t2 && (e.offset = String(t2.offset)), t2.search && (e.search = t2.search), t2.sortColumn && (e.sortColumn = t2.sortColumn), t2.sortOrder && (e.sortOrder = t2.sortOrder)), Object.keys(e).length > 0 ? "?" + new URLSearchParams(e).toString() : "";
  }
};
var te3 = class extends p3 {
  constructor(t2, e = {}, r) {
    let a = t2.replace(/\/$/, ""), n3 = c2(c2({}, S7), e);
    super(a, n3, r, "storage");
  }
  async createBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await f4(e.fetch, `${e.url}/bucket`, {
      name: t2
    }, {
      headers: e.headers
    }));
  }
  async listBuckets(t2) {
    var e = this;
    return e.handleOperation(async () => {
      let r = new URLSearchParams();
      t2?.limit !== void 0 && r.set("limit", t2.limit.toString()), t2?.offset !== void 0 && r.set("offset", t2.offset.toString()), t2?.sortColumn && r.set("sortColumn", t2.sortColumn), t2?.sortOrder && r.set("sortOrder", t2.sortOrder), t2?.search && r.set("search", t2.search);
      let a = r.toString(), n3 = a ? `${e.url}/bucket?${a}` : `${e.url}/bucket`;
      return await m3(e.fetch, n3, {
        headers: e.headers
      });
    });
  }
  async deleteBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await w4(e.fetch, `${e.url}/bucket/${t2}`, {}, {
      headers: e.headers
    }));
  }
  from(t2) {
    var e = this;
    if (!z3(t2)) throw new b2("Invalid bucket name: File, folder, and bucket names must follow AWS object key naming guidelines and should avoid the use of any other characters.");
    let r = new I3({
      baseUrl: this.url,
      catalogName: t2,
      auth: {
        type: "custom",
        getHeaders: async () => e.headers
      },
      fetch: this.fetch
    }), a = this.shouldThrowOnError;
    return new Proxy(r, {
      get(n3, s) {
        let o4 = n3[s];
        return typeof o4 != "function" ? o4 : async (...u2) => {
          try {
            return {
              data: await o4.apply(n3, u2),
              error: null
            };
          } catch (i4) {
            if (a) throw i4;
            return {
              data: null,
              error: i4
            };
          }
        };
      }
    });
  }
};
var re3 = class extends p3 {
  constructor(t2, e = {}, r) {
    let a = t2.replace(/\/$/, ""), n3 = c2(c2({}, S7), {}, {
      "Content-Type": "application/json"
    }, e);
    super(a, n3, r, "vectors");
  }
  async createIndex(t2) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/CreateIndex`, t2, {
      headers: e.headers
    }) || {});
  }
  async getIndex(t2, e) {
    var r = this;
    return r.handleOperation(async () => await h2.post(r.fetch, `${r.url}/GetIndex`, {
      vectorBucketName: t2,
      indexName: e
    }, {
      headers: r.headers
    }));
  }
  async listIndexes(t2) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/ListIndexes`, t2, {
      headers: e.headers
    }));
  }
  async deleteIndex(t2, e) {
    var r = this;
    return r.handleOperation(async () => await h2.post(r.fetch, `${r.url}/DeleteIndex`, {
      vectorBucketName: t2,
      indexName: e
    }, {
      headers: r.headers
    }) || {});
  }
};
var ae2 = class extends p3 {
  constructor(t2, e = {}, r) {
    let a = t2.replace(/\/$/, ""), n3 = c2(c2({}, S7), {}, {
      "Content-Type": "application/json"
    }, e);
    super(a, n3, r, "vectors");
  }
  async putVectors(t2) {
    var e = this;
    if (t2.vectors.length < 1 || t2.vectors.length > 500) throw new Error("Vector batch size must be between 1 and 500 items");
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/PutVectors`, t2, {
      headers: e.headers
    }) || {});
  }
  async getVectors(t2) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/GetVectors`, t2, {
      headers: e.headers
    }));
  }
  async listVectors(t2) {
    var e = this;
    if (t2.segmentCount !== void 0) {
      if (t2.segmentCount < 1 || t2.segmentCount > 16) throw new Error("segmentCount must be between 1 and 16");
      if (t2.segmentIndex !== void 0 && (t2.segmentIndex < 0 || t2.segmentIndex >= t2.segmentCount)) throw new Error(`segmentIndex must be between 0 and ${t2.segmentCount - 1}`);
    }
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/ListVectors`, t2, {
      headers: e.headers
    }));
  }
  async queryVectors(t2) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/QueryVectors`, t2, {
      headers: e.headers
    }));
  }
  async deleteVectors(t2) {
    var e = this;
    if (t2.keys.length < 1 || t2.keys.length > 500) throw new Error("Keys batch size must be between 1 and 500 items");
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/DeleteVectors`, t2, {
      headers: e.headers
    }) || {});
  }
};
var ne3 = class extends p3 {
  constructor(t2, e = {}, r) {
    let a = t2.replace(/\/$/, ""), n3 = c2(c2({}, S7), {}, {
      "Content-Type": "application/json"
    }, e);
    super(a, n3, r, "vectors");
  }
  async createBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/CreateVectorBucket`, {
      vectorBucketName: t2
    }, {
      headers: e.headers
    }) || {});
  }
  async getBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/GetVectorBucket`, {
      vectorBucketName: t2
    }, {
      headers: e.headers
    }));
  }
  async listBuckets(t2 = {}) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/ListVectorBuckets`, t2, {
      headers: e.headers
    }));
  }
  async deleteBucket(t2) {
    var e = this;
    return e.handleOperation(async () => await h2.post(e.fetch, `${e.url}/DeleteVectorBucket`, {
      vectorBucketName: t2
    }, {
      headers: e.headers
    }) || {});
  }
};
var se3 = class extends ne3 {
  constructor(t2, e = {}) {
    super(t2, e.headers || {}, e.fetch);
  }
  from(t2) {
    return new ce2(this.url, this.headers, t2, this.fetch);
  }
  async createBucket(t2) {
    var e = () => super.createBucket, r = this;
    return e().call(r, t2);
  }
  async getBucket(t2) {
    var e = () => super.getBucket, r = this;
    return e().call(r, t2);
  }
  async listBuckets(t2 = {}) {
    var e = () => super.listBuckets, r = this;
    return e().call(r, t2);
  }
  async deleteBucket(t2) {
    var e = () => super.deleteBucket, r = this;
    return e().call(r, t2);
  }
};
var ce2 = class extends re3 {
  constructor(t2, e, r, a) {
    super(t2, e, a), this.vectorBucketName = r;
  }
  async createIndex(t2) {
    var e = () => super.createIndex, r = this;
    return e().call(r, c2(c2({}, t2), {}, {
      vectorBucketName: r.vectorBucketName
    }));
  }
  async listIndexes(t2 = {}) {
    var e = () => super.listIndexes, r = this;
    return e().call(r, c2(c2({}, t2), {}, {
      vectorBucketName: r.vectorBucketName
    }));
  }
  async getIndex(t2) {
    var e = () => super.getIndex, r = this;
    return e().call(r, r.vectorBucketName, t2);
  }
  async deleteIndex(t2) {
    var e = () => super.deleteIndex, r = this;
    return e().call(r, r.vectorBucketName, t2);
  }
  index(t2) {
    return new oe3(this.url, this.headers, this.vectorBucketName, t2, this.fetch);
  }
};
var oe3 = class extends ae2 {
  constructor(t2, e, r, a, n3) {
    super(t2, e, n3), this.vectorBucketName = r, this.indexName = a;
  }
  async putVectors(t2) {
    var e = () => super.putVectors, r = this;
    return e().call(r, c2(c2({}, t2), {}, {
      vectorBucketName: r.vectorBucketName,
      indexName: r.indexName
    }));
  }
  async getVectors(t2) {
    var e = () => super.getVectors, r = this;
    return e().call(r, c2(c2({}, t2), {}, {
      vectorBucketName: r.vectorBucketName,
      indexName: r.indexName
    }));
  }
  async listVectors(t2 = {}) {
    var e = () => super.listVectors, r = this;
    return e().call(r, c2(c2({}, t2), {}, {
      vectorBucketName: r.vectorBucketName,
      indexName: r.indexName
    }));
  }
  async queryVectors(t2) {
    var e = () => super.queryVectors, r = this;
    return e().call(r, c2(c2({}, t2), {}, {
      vectorBucketName: r.vectorBucketName,
      indexName: r.indexName
    }));
  }
  async deleteVectors(t2) {
    var e = () => super.deleteVectors, r = this;
    return e().call(r, c2(c2({}, t2), {}, {
      vectorBucketName: r.vectorBucketName,
      indexName: r.indexName
    }));
  }
};
var ye3 = class extends ee3 {
  constructor(t2, e = {}, r, a) {
    super(t2, e, r, a);
  }
  from(t2) {
    return new Y3(this.url, this.headers, t2, this.fetch);
  }
  get vectors() {
    return new se3(this.url + "/vector", {
      headers: this.headers,
      fetch: this.fetch
    });
  }
  get analytics() {
    return new te3(this.url + "/iceberg", this.headers, this.fetch);
  }
};

// deno:https://esm.sh/@supabase/supabase-js@2.112.3/denonext/dist/tracingRegistry.mjs
var t = Symbol.for("@supabase/supabase-js.traceContextExtractor");
function o2() {
  return globalThis[t];
}

// deno:https://esm.sh/@supabase/supabase-js@2.112.3/denonext/supabase-js.mjs
import __Process$2 from "node:process";
var H6 = "2.112.3";
var T5 = "";
var w5;
if (typeof Deno < "u") T5 = "deno", w5 = (_5 = Deno.version) === null || _5 === void 0 ? void 0 : _5.deno;
else if (typeof document < "u") T5 = "web";
else if (typeof navigator < "u" && navigator.product === "ReactNative") T5 = "react-native";
else {
  T5 = "node";
  let e = __Process$2;
  w5 = e == null || (S8 = e.version) === null || S8 === void 0 ? void 0 : S8.replace(/^v/, "");
}
var _5;
var S8;
var C6 = [
  `runtime=${T5}`
];
w5 && C6.push(`runtime-version=${w5}`);
var $6 = {
  "X-Client-Info": `supabase-js/${H6}; ${C6.join("; ")}`
};
var W4 = {
  headers: $6
};
var x5 = {
  schema: "public"
};
var B5 = {
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: "implicit"
};
var z4 = {};
var M4 = {
  enabled: false,
  respectSamplingDecision: true
};
function G4(e) {
  if (!e || typeof e != "string") return null;
  let t2 = e.split("-");
  if (t2.length !== 4) return null;
  let [r, n3, s, a] = t2;
  if (r.length !== 2 || n3.length !== 32 || s.length !== 16 || a.length !== 2) return null;
  let l = /^[0-9a-f]+$/i;
  return !l.test(r) || !l.test(n3) || !l.test(s) || !l.test(a) || n3 === "00000000000000000000000000000000" || s === "0000000000000000" ? null : {
    version: r,
    traceId: n3,
    parentId: s,
    traceFlags: a,
    isSampled: (parseInt(a, 16) & 1) === 1
  };
}
function q5(e, t2) {
  if (!e || !t2 || t2.length === 0) return false;
  let r;
  if (e instanceof URL) r = e;
  else try {
    r = new URL(e);
  } catch {
    return false;
  }
  for (let n3 of t2) try {
    if (typeof n3 == "string") {
      if (V4(r.hostname, n3)) return true;
    } else if (n3 instanceof RegExp) {
      if (n3.test(r.hostname)) return true;
    } else if (typeof n3 == "function" && n3(r)) return true;
  } catch {
    continue;
  }
  return false;
}
function V4(e, t2) {
  if (t2 === e) return true;
  if (t2.startsWith("*.")) {
    let r = t2.slice(2);
    if (e.endsWith(r) && (e === r || e.endsWith("." + r))) return true;
  }
  return false;
}
function J4(e) {
  let t2 = [];
  try {
    let r = new URL(e);
    t2.push(r.hostname);
  } catch {
  }
  return t2.push("*.supabase.co", "*.supabase.in"), t2.push("localhost", "127.0.0.1", "[::1]"), t2;
}
function y4(e) {
  "@babel/helpers - typeof";
  return y4 = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(t2) {
    return typeof t2;
  } : function(t2) {
    return t2 && typeof Symbol == "function" && t2.constructor === Symbol && t2 !== Symbol.prototype ? "symbol" : typeof t2;
  }, y4(e);
}
function X4(e, t2) {
  if (y4(e) != "object" || !e) return e;
  var r = e[Symbol.toPrimitive];
  if (r !== void 0) {
    var n3 = r.call(e, t2 || "default");
    if (y4(n3) != "object") return n3;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (t2 === "string" ? String : Number)(e);
}
function Y4(e) {
  var t2 = X4(e, "string");
  return y4(t2) == "symbol" ? t2 : t2 + "";
}
function Z4(e, t2, r) {
  return (t2 = Y4(t2)) in e ? Object.defineProperty(e, t2, {
    value: r,
    enumerable: true,
    configurable: true,
    writable: true
  }) : e[t2] = r, e;
}
function O7(e, t2) {
  var r = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var n3 = Object.getOwnPropertySymbols(e);
    t2 && (n3 = n3.filter(function(s) {
      return Object.getOwnPropertyDescriptor(e, s).enumerable;
    })), r.push.apply(r, n3);
  }
  return r;
}
function o3(e) {
  for (var t2 = 1; t2 < arguments.length; t2++) {
    var r = arguments[t2] != null ? arguments[t2] : {};
    t2 % 2 ? O7(Object(r), true).forEach(function(n3) {
      Z4(e, n3, r[n3]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(r)) : O7(Object(r)).forEach(function(n3) {
      Object.defineProperty(e, n3, Object.getOwnPropertyDescriptor(r, n3));
    });
  }
  return e;
}
var Q4 = (e) => e ? (...t2) => e(...t2) : (...t2) => fetch(...t2);
var ee4 = () => Headers;
var I5 = (e) => e.startsWith("sb_publishable_") || e.startsWith("sb_secret_");
var te4 = "sb_temp_";
var E6 = /* @__PURE__ */ new Set();
var re4 = (e) => {
  var t2, r;
  if (!e.startsWith("sb_") || I5(e) || e.startsWith(te4)) return;
  let n3 = (t2 = (r = e.match(/^sb_[a-zA-Z0-9]+_/)) === null || r === void 0 ? void 0 : r[0]) !== null && t2 !== void 0 ? t2 : "unknown";
  E6.has(n3) || (E6.add(n3), console.warn("@supabase/supabase-js: Unrecognized Supabase API key format. The client will proceed and send this key as-is; if you see authentication errors you may need to upgrade @supabase/supabase-js to a version that recognizes this key type."));
};
var P6 = (e, t2, r, n3, s, a) => {
  let l = Q4(n3), f5 = ee4(), i4 = s?.enabled === true, p4 = s?.respectSamplingDecision !== false, h3 = i4 ? J4(t2) : null, d = !(a?.omitApiKeyAsBearer && I5(e));
  return async (m4, g3) => {
    let b3 = await r(), u2 = new f5(g3?.headers);
    if (u2.has("apikey") || u2.set("apikey", e), !u2.has("Authorization")) {
      let c3 = b3 ?? (d ? e : null);
      c3 && u2.set("Authorization", `Bearer ${c3}`);
    }
    if (h3) {
      let c3 = ne4(m4, h3, p4);
      c3 && (c3.traceparent && !u2.has("traceparent") && u2.set("traceparent", c3.traceparent), c3.tracestate && !u2.has("tracestate") && u2.set("tracestate", c3.tracestate), c3.baggage && !u2.has("baggage") && u2.set("baggage", c3.baggage));
    }
    return l(m4, o3(o3({}, g3), {}, {
      headers: u2
    }));
  };
};
var U5 = false;
var k4 = false;
function ne4(e, t2, r) {
  let n3 = o2();
  if (!n3) return U5 || (U5 = true, console.warn("@supabase/supabase-js: tracePropagation is enabled but the tracing runtime is not loaded, so trace headers will not be attached. Add `import '@supabase/supabase-js/tracing'` at your application entry point (requires the OpenTelemetry API package to be installed). The CDN/UMD build does not support trace propagation.")), null;
  if (!q5(typeof e == "string" || e instanceof URL ? e : e.url, t2)) return null;
  let s = n3();
  if (!s || !s.traceparent) {
    var a;
    if (!(s == null || (a = s.carrierKeys) === null || a === void 0) && a.length && !k4) {
      k4 = true;
      let l = s.carrierKeys.includes("sentry-trace") ? " Sentry detected: set `propagateTraceparent: true` in Sentry.init() to emit it." : " Configure your tracing SDK to emit W3C trace context on outgoing requests.";
      console.warn(`@supabase/supabase-js: tracePropagation is enabled and a tracing SDK is active, but its propagator wrote [${s.carrierKeys.join(", ")}] and no W3C traceparent header, so trace headers will not be attached.` + l);
    }
    return null;
  }
  if (r) {
    let l = G4(s.traceparent);
    if (l && !l.isSampled) return {
      traceparent: s.traceparent
    };
  }
  return s;
}
function L3(e) {
  return typeof e == "boolean" ? {
    enabled: e
  } : e;
}
function se4(e) {
  return e.endsWith("/") ? e : e + "/";
}
function ae3(e, t2) {
  var r, n3, s, a, l, f5;
  let { db: i4, auth: p4, realtime: h3, global: d } = e, { db: m4, auth: g3, realtime: b3, global: u2 } = t2, c3 = L3(e.tracePropagation), v2 = L3(t2.tracePropagation), A6 = {
    db: o3(o3({}, m4), i4),
    auth: o3(o3({}, g3), p4),
    realtime: o3(o3({}, b3), h3),
    storage: {},
    global: o3(o3(o3({}, u2), d), {}, {
      headers: o3(o3({}, (r = u2?.headers) !== null && r !== void 0 ? r : {}), (n3 = d?.headers) !== null && n3 !== void 0 ? n3 : {})
    }),
    tracePropagation: {
      enabled: (s = (a = c3?.enabled) !== null && a !== void 0 ? a : v2?.enabled) !== null && s !== void 0 ? s : false,
      respectSamplingDecision: (l = (f5 = c3?.respectSamplingDecision) !== null && f5 !== void 0 ? f5 : v2?.respectSamplingDecision) !== null && l !== void 0 ? l : true
    },
    accessToken: async () => ""
  };
  return e.accessToken ? A6.accessToken = e.accessToken : delete A6.accessToken, A6;
}
function ie3(e) {
  let t2 = e?.trim();
  if (!t2) throw new Error("supabaseUrl is required.");
  if (!t2.match(/^https?:\/\//i)) throw new Error("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.");
  try {
    return new URL(se4(t2));
  } catch {
    throw Error("Invalid supabaseUrl: Provided URL is malformed.");
  }
}
var oe4 = class extends ur {
  constructor(e) {
    super(e);
  }
};
var le3 = class {
  constructor(e, t2, r) {
    var n3, s;
    this.supabaseUrl = e, this.supabaseKey = t2;
    let a = ie3(e);
    if (!t2) throw new Error("supabaseKey is required.");
    re4(t2), this.realtimeUrl = new URL("realtime/v1", a), this.realtimeUrl.protocol = this.realtimeUrl.protocol.replace("http", "ws"), this.authUrl = new URL("auth/v1", a), this.storageUrl = new URL("storage/v1", a), this.functionsUrl = new URL("functions/v1", a);
    let l = `sb-${a.hostname.split(".")[0]}-auth-token`, f5 = {
      db: x5,
      realtime: z4,
      auth: o3(o3({}, B5), {}, {
        storageKey: l
      }),
      global: W4,
      tracePropagation: M4
    }, i4 = ae3(r ?? {}, f5);
    if (this.settings = i4, this.storageKey = (n3 = i4.auth.storageKey) !== null && n3 !== void 0 ? n3 : "", this.headers = (s = i4.global.headers) !== null && s !== void 0 ? s : {}, i4.accessToken) this.accessToken = i4.accessToken, this.auth = new Proxy({}, {
      get: (h3, d) => {
        throw new Error(`@supabase/supabase-js: Supabase Client is configured with the accessToken option, accessing supabase.auth.${String(d)} is not possible`);
      }
    });
    else {
      var p4;
      this.auth = this._initSupabaseAuthClient((p4 = i4.auth) !== null && p4 !== void 0 ? p4 : {}, this.headers, i4.global.fetch);
    }
    this.fetch = P6(t2, e, this._getSessionToken.bind(this), i4.global.fetch, i4.tracePropagation), this.functionsFetch = P6(t2, e, this._getSessionToken.bind(this), i4.global.fetch, i4.tracePropagation, {
      omitApiKeyAsBearer: true
    }), this.realtime = this._initRealtimeClient(o3({
      headers: this.headers,
      accessToken: this._getAccessToken.bind(this),
      fetch: this.fetch
    }, i4.realtime)), this.accessToken && Promise.resolve(this.accessToken()).then((h3) => this.realtime.setAuth(h3)).catch((h3) => console.warn("Failed to set initial Realtime auth token:", h3)), this.rest = new _(new URL("rest/v1", a).href, {
      headers: this.headers,
      schema: i4.db.schema,
      fetch: this.fetch,
      timeout: i4.db.timeout,
      urlLengthLimit: i4.db.urlLengthLimit,
      retry: i4.db.retry
    }), this.storage = new ye3(this.storageUrl.href, this.headers, this.fetch, r?.storage), i4.accessToken || this._listenForAuthEvents();
  }
  get functions() {
    return new S3(this.functionsUrl.href, {
      headers: this.headers,
      customFetch: this.functionsFetch
    });
  }
  from(e) {
    return this.rest.from(e);
  }
  schema(e) {
    return this.rest.schema(e);
  }
  rpc(e, t2 = {}, r = {
    head: false,
    get: false,
    count: void 0
  }) {
    return this.rest.rpc(e, t2, r);
  }
  channel(e, t2 = {
    config: {}
  }) {
    return this.realtime.channel(e, t2);
  }
  getChannels() {
    return this.realtime.getChannels();
  }
  removeChannel(e) {
    return this.realtime.removeChannel(e);
  }
  removeAllChannels() {
    return this.realtime.removeAllChannels();
  }
  async _getSessionToken() {
    var e = this, t2, r;
    if (e.accessToken) return await e.accessToken();
    let { data: n3 } = await e.auth.getSession();
    return (t2 = (r = n3.session) === null || r === void 0 ? void 0 : r.access_token) !== null && t2 !== void 0 ? t2 : null;
  }
  async _getAccessToken() {
    var e = this, t2;
    return (t2 = await e._getSessionToken()) !== null && t2 !== void 0 ? t2 : e.supabaseKey;
  }
  _initSupabaseAuthClient({ autoRefreshToken: e, persistSession: t2, detectSessionInUrl: r, storage: n3, userStorage: s, storageKey: a, flowType: l, lock: f5, debug: i4, throwOnError: p4, experimental: h3, lockAcquireTimeout: d, skipAutoInitialize: m4 }, g3, b3) {
    let u2 = {
      Authorization: `Bearer ${this.supabaseKey}`,
      apikey: `${this.supabaseKey}`
    };
    return new oe4({
      url: this.authUrl.href,
      headers: o3(o3({}, u2), g3),
      storageKey: a,
      autoRefreshToken: e,
      persistSession: t2,
      detectSessionInUrl: r,
      storage: n3,
      userStorage: s,
      flowType: l,
      lock: f5,
      debug: i4,
      throwOnError: p4,
      experimental: h3,
      fetch: b3,
      lockAcquireTimeout: d,
      skipAutoInitialize: m4,
      hasCustomAuthorizationHeader: Object.keys(this.headers).some((c3) => c3.toLowerCase() === "authorization")
    });
  }
  _initRealtimeClient(e) {
    return new U3(this.realtimeUrl.href, o3(o3({}, e), {}, {
      params: o3(o3({}, {
        apikey: this.supabaseKey
      }), e?.params)
    }));
  }
  _listenForAuthEvents() {
    return this.auth.onAuthStateChange((e, t2) => {
      this._handleTokenChanged(e, "CLIENT", t2?.access_token);
    });
  }
  _handleTokenChanged(e, t2, r) {
    (e === "TOKEN_REFRESHED" || e === "SIGNED_IN" || e === "INITIAL_SESSION") && this.changedAccessToken !== r ? (this.changedAccessToken = r, this.realtime.setAuth(r)) : e === "SIGNED_OUT" && (this.realtime.setAuth(), t2 == "STORAGE" && this.auth.signOut(), this.changedAccessToken = void 0);
  }
};
var we2 = (e, t2, r) => new le3(e, t2, r);
function ce3() {
  if (typeof globalThis < "u" || globalThis.Deno !== void 0) return false;
  let e = __Process$2;
  if (!e) return false;
  let t2 = e.version;
  if (t2 == null) return false;
  let r = t2.match(/^v(\d+)\./);
  return r ? parseInt(r[1], 10) <= 20 : false;
}
ce3() && console.warn("\u26A0\uFE0F  Node.js 20 and below are deprecated and will no longer be supported in future versions of @supabase/supabase-js. Please upgrade to Node.js 22 or later. For more information, visit: https://github.com/orgs/supabase/discussions/45715");
export {
  ar as AuthAdminApi,
  ve as AuthApiError,
  ur as AuthClient,
  B as AuthError,
  X as AuthImplicitGrantRedirectError,
  Y as AuthInvalidCredentialsError,
  V as AuthInvalidJwtError,
  W as AuthInvalidTokenResponseError,
  be as AuthPKCECodeVerifierMissingError,
  oe as AuthPKCEGrantCodeExchangeError,
  ae as AuthRefreshDiscardedError,
  Z as AuthRetryableFetchError,
  E as AuthSessionMissingError,
  x as AuthUnknownError,
  le as AuthWeakPasswordError,
  U as CustomAuthError,
  E2 as FunctionRegion,
  c as FunctionsError,
  x2 as FunctionsFetchError,
  u as FunctionsHttpError,
  f2 as FunctionsRelayError,
  J as GoTrueAdminApi,
  He as GoTrueClient,
  we as NavigatorLockAcquireTimeoutError,
  P2 as PostgrestError,
  ve2 as REALTIME_CHANNEL_STATES,
  A4 as REALTIME_LISTEN_TYPES,
  V2 as REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  W2 as REALTIME_PRESENCE_LISTEN_EVENTS,
  k2 as REALTIME_SUBSCRIBE_STATES,
  S6 as RealtimeChannel,
  U3 as RealtimeClient,
  y3 as RealtimePostgresFilterBuilder,
  w2 as RealtimePresence,
  Ee as SIGN_OUT_SCOPES,
  O6 as StorageApiError,
  le3 as SupabaseClient,
  D4 as WebSocketFactory,
  we2 as createClient,
  Ce as isAuthApiError,
  h as isAuthError,
  st as isAuthImplicitGrantRedirectError,
  fr as isAuthPKCECodeVerifierMissingError,
  it as isAuthRefreshDiscardedError,
  ce as isAuthRetryableFetchError,
  ue as isAuthSessionMissingError,
  _r as isAuthWeakPasswordError,
  N as lockInternals,
  Qt as navigatorLock,
  Q2 as postgresChangesFilter,
  er as processLock
};
