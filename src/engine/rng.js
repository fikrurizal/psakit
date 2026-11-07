// Random number generators. Each factory takes a 32-bit seed and returns u(), uniform on (0,1) exclusive.
// The first five follow the published algorithms named in the Ersatz guide. Ersatz does not document which
// Marsaglia generators it used, so "fast" and "top" use Marsaglia's MWC256 and CMWC4096, which meet its
// documented period of more than 1e356. Streams are not bit-identical to Ersatz.
(function (Sg) {
  const SCALE = 1 / 4294967296;
  const toU = (x) => (x + 0.5) * SCALE;

  function splitmix(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
  }

  function quick(seed) {
    let x = splitmix(seed)();
    return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return toU(x); };
  }

  const IM = 2147483647, IA = 16807, IQ = 127773, IR = 2836, AM = 1 / IM;
  const pmStep = (x) => { const k = Math.floor(x / IQ); const v = IA * (x - k * IQ) - IR * k; return v < 0 ? v + IM : v; };
  const pmSeed = (seed) => (splitmix(seed)() % (IM - 1)) + 1;

  function parkMiller(seed) {
    let x = pmSeed(seed);
    return () => { x = pmStep(x); return x * AM; };
  }

  function parkMillerShuffle(seed) {
    const NTAB = 32, NDIV = 1 + Math.floor((IM - 1) / NTAB), tab = new Array(NTAB);
    let x = pmSeed(seed);
    for (let j = NTAB + 7; j >= 0; j--) { x = pmStep(x); if (j < NTAB) tab[j] = x; }
    let y = tab[0];
    return () => {
      x = pmStep(x);
      const j = Math.floor(y / NDIV);
      y = tab[j]; tab[j] = x;
      return y * AM;
    };
  }

  function lecuyer(seed) {
    const IM1 = 2147483563, IM2 = 2147483399, IA1 = 40014, IA2 = 40692, IQ1 = 53668, IQ2 = 52774, IR1 = 12211, IR2 = 3791;
    const AM1 = 1 / IM1, IMM1 = IM1 - 1, NTAB = 32, NDIV = 1 + Math.floor(IMM1 / NTAB), tab = new Array(NTAB);
    let a = (splitmix(seed)() % (IM1 - 1)) + 1, b = a;
    const s1 = (x) => { const k = Math.floor(x / IQ1); const v = IA1 * (x - k * IQ1) - k * IR1; return v < 0 ? v + IM1 : v; };
    const s2 = (x) => { const k = Math.floor(x / IQ2); const v = IA2 * (x - k * IQ2) - k * IR2; return v < 0 ? v + IM2 : v; };
    for (let j = NTAB + 7; j >= 0; j--) { a = s1(a); if (j < NTAB) tab[j] = a; }
    let y = tab[0];
    return () => {
      a = s1(a); b = s2(b);
      const j = Math.floor(y / NDIV);
      y = tab[j] - b; tab[j] = a;
      if (y < 1) y += IMM1;
      return Math.min(y * AM1, 1 - 1.2e-7);
    };
  }

  function mersenne(seed) {
    const N = 624, M = 397, mt = new Uint32Array(N);
    mt[0] = seed >>> 0;
    for (let i = 1; i < N; i++) { const s = mt[i - 1] ^ (mt[i - 1] >>> 30); mt[i] = (Math.imul(s, 1812433253) + i) >>> 0; }
    let k = N;
    return () => {
      if (k >= N) {
        let i = 0, y;
        for (; i < N - M; i++) { y = (mt[i] & 0x80000000) | (mt[i + 1] & 0x7fffffff); mt[i] = mt[i + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
        for (; i < N - 1; i++) { y = (mt[i] & 0x80000000) | (mt[i + 1] & 0x7fffffff); mt[i] = mt[i + M - N] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); }
        y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
        mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
        k = 0;
      }
      let y = mt[k++];
      y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
      return toU(y >>> 0);
    };
  }

  function mwc256(seed) { // period about 2^8222
    const Q = new Uint32Array(256), sm = splitmix(seed), A = 809430660;
    for (let i = 0; i < 256; i++) Q[i] = sm();
    let c = sm() % A, i = 255;
    return () => {
      i = (i + 1) & 255;
      const x = Q[i], L = A * (x & 0xffff) + c, H = A * (x >>> 16) + Math.floor(L / 65536);
      c = Math.floor(H / 65536);
      const v = (H % 65536) * 65536 + (L % 65536);
      Q[i] = v;
      return toU(v);
    };
  }

  function cmwc4096(seed) { // period about 2^131086
    const Q = new Uint32Array(4096), sm = splitmix(seed), A = 18782, B = 4294967296;
    for (let i = 0; i < 4096; i++) Q[i] = sm();
    let c = sm() % 18781, i = 4095;
    return () => {
      i = (i + 1) & 4095;
      const t = A * Q[i] + c;
      c = Math.floor(t / B);
      let x = t % B + c;
      if (x >= B) { x = x - B + 1; c++; }
      const v = (0xfffffffe - x) >>> 0;
      Q[i] = v;
      return toU(v);
    };
  }

  Sg.RNGS = {
    quick: { label: 'Quick and dirty', make: quick },
    parkMiller: { label: 'Park & Miller minimal standard', make: parkMiller },
    parkMillerShuffle: { label: 'Park & Miller with Bays-Durham shuffle', make: parkMillerShuffle },
    lecuyer: { label: "L'Ecuyer combined with shuffle", make: lecuyer },
    mersenne: { label: 'Mersenne Twister', make: mersenne },
    fast: { label: 'Fast Marsaglia (MWC256, default)', make: mwc256 },
    top: { label: 'Top-quality Marsaglia (CMWC4096)', make: cmwc4096 },
  };

  // FNV-1a over a string, mixed with the master seed, so a cell's stream depends only on seed and cell.
  Sg.hashSeed = function (seed, key) {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };
})(globalThis.Sg = globalThis.Sg || {});
